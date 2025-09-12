import { connect } from 'cloudflare:sockets';

// --- Helper: Performs a TCP connection test to a given proxy ---
async function checkProxy(proxy, timeout) {
  const [hostname, portStr] = proxy.split(":");
  if (!hostname || !portStr) return { proxy, status: "dead", latency: null };
  const port = parseInt(portStr, 10);
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout));
  const connectPromise = (async () => {
    const startTime = Date.now();
    try {
        const socket = connect({ hostname, port });
        await socket.close();
        return { proxy, status: "alive", latency: Date.now() - startTime };
    } catch (e) { throw e; }
  })();
  try {
    return await Promise.race([connectPromise, timeoutPromise]);
  } catch (error) {
    return { proxy, status: "dead", latency: null };
  }
}

// --- Helper: Gets enrichment data for an IP, using a permanent cache ---
async function getEnrichmentData(ip, env) {
  if (!env.GEOIP_CACHE) return { country: "N/A", isp: "N/A" };
  const cached = await env.GEOIP_CACHE.get(ip, 'json');
  if (cached) return cached;
  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode,isp`);
    if (!response.ok) return { country: "N/A", isp: "N/A" };
    const data = await response.json();
    const enrichmentData = { country: data.countryCode || "N/A", isp: data.isp || "N/A" };
    await env.GEOIP_CACHE.put(ip, JSON.stringify(enrichmentData));
    return enrichmentData;
  } catch (e) {
    console.error(`GeoIP lookup failed for ${ip}:`, e);
    return { country: "N/A", isp: "N/A" };
  }
}

// --- Helper: Fetches the list of proxies from the source URL ---
async function getProxyList(env) {
  const response = await fetch(env.PROXY_LIST_URL);
  if (!response.ok) throw new Error(`Failed to fetch proxy list: ${response.status} ${response.statusText}`);
  const textData = await response.text();
  return textData.split('\n')
    .map(line => {
      const parts = line.split(',');
      const ip = parts[0]?.trim();
      const port = parts[1]?.trim();
      if (ip && port) return `${ip}:${port}`;
      return null;
    })
    .filter(Boolean);
}

// --- Durable Object Class as a Queue Manager ---
export class HealthCheckerDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/start-cycle": {
        const isRunning = await this.state.storage.get("isRunning");
        if (isRunning) return new Response("Cycle already running.", { status: 409 });

        const proxies = await request.json();
        await this.state.storage.put("proxies", proxies);
        await this.state.storage.put("current_index", 0);
        await this.state.storage.put("isRunning", true);
        console.log(`DO: New cycle started with ${proxies.length} proxies.`);
        return new Response("Cycle started.", { status: 200 });
      }
      case "/get-next-task": {
        return this.state.blockConcurrencyWhile(async () => {
          const proxies = await this.state.storage.get("proxies") || [];
          let currentIndex = await this.state.storage.get("current_index") || 0;
          if (currentIndex >= proxies.length) {
            await this.state.storage.delete("isRunning");
            return new Response(null, { status: 204 }); // No more tasks
          }
          const task = proxies[currentIndex];
          await this.state.storage.put("current_index", currentIndex + 1);
          return new Response(task, { status: 200 });
        });
      }
      default:
        return new Response("Not found", { status: 404 });
    }
  }
}

// --- Main Worker Logic ---
export default {
  async scheduled(event, env, ctx) {
    const id = env.HEALTH_CHECKER.idFromName("singleton-queue-manager");
    const stub = env.HEALTH_CHECKER.get(id);
    const workerId = parseInt(env.WORKER_ID || "0");

    // Worker #0 is responsible for starting a new cycle if one isn't running
    if (workerId === 0) {
      const proxies = await getProxyList(env);
      ctx.waitUntil(stub.fetch(new Request("https://do/start-cycle", {
        method: "POST",
        body: JSON.stringify(proxies)
      })));
    }

    // All workers will try to process tasks from the queue
    ctx.waitUntil((async () => {
        const startTime = Date.now();
        // Loop for a maximum of 25 seconds to stay within limits
        while (Date.now() - startTime < 25000) {
            const taskResponse = await stub.fetch(new Request("https://do/get-next-task", { method: "POST" }));
            if (taskResponse.status === 204) {
                console.log(`Worker ${workerId}: No more tasks.`);
                break; // Exit loop if queue is empty
            }
            const proxyAddress = await taskResponse.text();
            console.log(`Worker ${workerId}: Processing task ${proxyAddress}`);

            const ip = proxyAddress.split(":")[0];
            const timeout = parseInt(env.HEALTH_CHECK_TIMEOUT || '5000', 10);
            const healthResult = await checkProxy(proxyAddress, timeout);
            const enrichmentData = await getEnrichmentData(ip, env);

            const finalData = { proxy: proxyAddress, ...healthResult, ...enrichmentData };
            delete finalData.status; // status is already in healthResult
            finalData.status = healthResult.status;

            if (finalData.status === 'alive') {
                await env.PROXY_CACHE.put(proxyAddress, JSON.stringify(finalData), { expirationTtl: 3600 });
            } else {
                await env.PROXY_CACHE.delete(proxyAddress);
            }
        }
    })());
  },

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

      if (path === '/health') {
        if (!env.PROXY_CACHE) return new Response("KV Namespace 'PROXY_CACHE' not configured.", { status: 500, headers: corsHeaders });

        const allKeys = [];
        let cursor = undefined;
        let listResult;
        do {
          listResult = await env.PROXY_CACHE.list({ cursor: cursor, limit: 1000 });
          allKeys.push(...listResult.keys);
          cursor = listResult.cursor;
        } while (listResult && !listResult.list_complete);

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
        const proxies = await getProxyList(env);
        return new Response(JSON.stringify(proxies, null, 2), {
          headers: { 'Content-Type': 'application/json;charset=UTF-8', ...corsHeaders },
        });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(error.message, { status: 500, headers: { ...corsHeaders } });
    }
  },
};
