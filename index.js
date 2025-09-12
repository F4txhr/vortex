import { connect } from 'cloudflare:sockets';

// --- Helper: Performs a TCP connection test to a given proxy ---
async function checkProxy(proxy, timeout) {
  const [hostname, portStr] = proxy.split(":");
  if (!hostname || !portStr) {
    return { proxy, status: "dead", latency: null };
  }
  const port = parseInt(portStr, 10);

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), timeout)
  );

  const connectPromise = (async () => {
    const startTime = Date.now();
    try {
        const socket = connect({ hostname, port });
        await socket.close();
        const latency = Date.now() - startTime;
        return { proxy, status: "alive", latency };
    } catch (e) {
        throw e;
    }
  })();

  try {
    return await Promise.race([connectPromise, timeoutPromise]);
  } catch (error) {
    return { proxy, status: "dead", latency: null };
  }
}

// --- Helper: Gets enrichment data for an IP, using a permanent cache ---
async function getEnrichmentData(ip, env) {
  if (!env.GEOIP_CACHE) {
    return { country: "N/A", isp: "N/A" };
  }

  // Check cache first
  const cached = await env.GEOIP_CACHE.get(ip, 'json');
  if (cached) {
    return cached;
  }

  // If not in cache, fetch from external API
  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode,isp`);
    if (!response.ok) {
      return { country: "N/A", isp: "N/A" };
    }
    const data = await response.json();
    const enrichmentData = {
      country: data.countryCode || "N/A",
      isp: data.isp || "N/A",
    };

    // Store in cache permanently
    await env.GEOIP_CACHE.put(ip, JSON.stringify(enrichmentData));

    return enrichmentData;
  } catch (e) {
    console.error(`GeoIP lookup failed for ${ip}:`, e);
    return { country: "N/A", isp: "N/A" };
  }
}

// --- Helper: Fetches and parses the list of proxies from the source URL ---
async function getProxyList(env) {
  const response = await fetch(env.PROXY_LIST_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch proxy list: ${response.status} ${response.statusText}`);
  }
  const textData = await response.text();
  return textData.split('\n')
    .map(line => {
      const parts = line.split(',');
      const ip = parts[0]?.trim();
      const port = parts[1]?.trim();
      if (ip && port) {
        // Return a simple ip:port string. Enrichment is handled later.
        return `${ip}:${port}`;
      }
      return null;
    })
    .filter(Boolean);
}

// --- The Durable Object Class for Health Checking ---
export class HealthCheckerDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // The DO's fetch handler acts as a router for commands from the main worker.
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/start-full-check") {
      return this.startFullCheck();
    }
    return new Response("Not found", { status: 404 });
  }

  // The alarm is our main work loop for background processing.
  async alarm() {
    const proxies = await this.state.storage.get("proxies") || [];
    let currentIndex = await this.state.storage.get("current_index") || 0;

    if (currentIndex >= proxies.length) {
      console.log("Health check cycle complete.");
      await this.state.storage.deleteAll();
      return;
    }

    const proxyAddress = proxies[currentIndex];
    const ip = proxyAddress.split(":")[0];
    console.log(`DO Alarm: Checking proxy #${currentIndex}: ${proxyAddress}`);

    // 1. Get enrichment data (from cache or external API)
    const enrichmentData = await getEnrichmentData(ip, this.env);

    // 2. Perform health check
    const timeout = parseInt(this.env.HEALTH_CHECK_TIMEOUT || '5000', 10);
    const healthResult = await checkProxy(proxyAddress, timeout);

    // 3. Combine all data
    const finalData = {
      proxy: proxyAddress,
      status: healthResult.status,
      latency: healthResult.latency,
      ...enrichmentData,
    };

    // 4. Save to health check cache
    if (healthResult.status === 'alive') {
        await this.env.PROXY_CACHE.put(proxyAddress, JSON.stringify(finalData), { expirationTtl: 3600 });
    } else {
        await this.env.PROXY_CACHE.delete(proxyAddress);
    }

    // 5. Increment index and set next alarm
    currentIndex++;
    await this.state.storage.put("current_index", currentIndex);
    this.state.storage.setAlarm(Date.now() + 1000);
  }

  // This method is called via the DO's fetch handler.
  async startFullCheck() {
    const currentAlarm = await this.state.storage.getAlarm();
    if (currentAlarm != null) {
      return new Response("Health check process is already running.", { status: 409 });
    }

    console.log("startFullCheck called. Fetching proxy list...");
    const proxies = await getProxyList(this.env);
    await this.state.storage.put("proxies", proxies);
    await this.state.storage.put("current_index", 0);

    this.state.storage.setAlarm(Date.now() + 1000);
    console.log("Proxy list fetched and first alarm set.");
    return new Response("Health check process initiated.", { status: 202 });
  }
}

// Helper function for the /seed endpoint to process a proxy in real-time
async function processProxyRealtime(proxyAddress, env) {
  const ip = proxyAddress.split(":")[0];
  const timeout = parseInt(env.HEALTH_CHECK_TIMEOUT || '5000', 10);

  // Perform both checks concurrently
  const healthPromise = checkProxy(proxyAddress, timeout);
  const enrichmentPromise = getEnrichmentData(ip, env);

  const [healthResult, enrichmentData] = await Promise.all([healthPromise, enrichmentPromise]);

  const finalData = {
    proxy: proxyAddress,
    status: healthResult.status,
    latency: healthResult.latency,
    ...enrichmentData,
  };

  // Update the cache in the background
  if (healthResult.status === 'alive' && env.PROXY_CACHE) {
    // We can't use ctx.waitUntil here, so this is a fire-and-forget write.
    // For a seeder, this is acceptable.
    env.PROXY_CACHE.put(proxyAddress, JSON.stringify(finalData), { expirationTtl: 3600 });
  }

  return finalData;
}

// --- Main Worker Logic ---
export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === 'POST' && path === '/seed') {
        const proxies = await getProxyList(env);
        const batch = proxies.slice(0, 40); // Take the first 40

        const promises = batch.map(proxy => processProxyRealtime(proxy, env));
        const results = await Promise.allSettled(promises);

        const responseData = results
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value)
            .filter(p => p.status === 'alive')
            .sort((a,b) => a.latency - b.latency);

        return new Response(JSON.stringify(responseData, null, 2), {
          headers: { 'Content-Type': 'application/json;charset=UTF-8', ...corsHeaders },
        });

      } else if (request.method === 'POST' && path === '/force-health') {
        const id = env.HEALTH_CHECKER.idFromName("singleton-health-checker");
        const stub = env.HEALTH_CHECKER.get(id);
        // Send a request to the DO's fetch handler to trigger the process.
        return stub.fetch(new Request("https://do/start-full-check", { method: "POST" }));

      } else if (path === '/health') {
        if (!env.PROXY_CACHE) {
          return new Response("KV Namespace 'PROXY_CACHE' is not configured.", { status: 500, headers: corsHeaders });
        }

        const allKeys = [];
        let cursor = undefined;
        let listResult;
        do {
          listResult = await env.PROXY_CACHE.list({ cursor: cursor, limit: 1000 });
          allKeys.push(...listResult.keys);
          cursor = listResult.cursor;
        } while (listResult && !listResult.list_complete);

        // Filter out any internal state keys before fetching values
        const proxyKeys = allKeys.filter(key => !key.name.startsWith('_'));
        const promises = proxyKeys.map(key => env.PROXY_CACHE.get(key.name, 'json'));
        let results = await Promise.all(promises);

        results = results
          .filter(result => result && result.status === 'alive')
          .sort((a, b) => a.latency - b.latency);

        return new Response(JSON.stringify(results, null, 2), {
          headers: { 'Content-Type': 'application/json;charset=UTF-8', ...corsHeaders },
        });
      } else {
        // Default behavior: return the raw, unchecked list.
        const proxies = await getProxyList(env);
        return new Response(JSON.stringify(proxies, null, 2), {
          headers: { 'Content-Type': 'application/json;charset=UTF-8', ...corsHeaders },
        });
      }

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(error.message, {
        status: 500,
        headers: { ...corsHeaders },
      });
    }
  },
};
