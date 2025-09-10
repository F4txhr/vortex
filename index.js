import { connect } from 'cloudflare:sockets';

async function checkProxy(proxy, timeout) {
  const [hostname, portStr] = proxy.split(':');
  const port = parseInt(portStr, 10);

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), timeout)
  );

  const connectPromise = (async () => {
    const startTime = Date.now();
    try {
      // Attempt to connect to the proxy
      const socket = connect({ hostname, port });
      // The connection is established, and then we immediately close it.
      await socket.close();
      const latency = Date.now() - startTime;
      return { proxy, status: 'alive', latency };
    } catch (error) {
      // Propagate the error to be caught by Promise.race
      throw error;
    }
  })();

  try {
    const result = await Promise.race([connectPromise, timeoutPromise]);
    return result;
  } catch (error) {
    return { proxy, status: 'dead', latency: null };
  }
}

async function updateProxyData(proxyData, env) {
  const { ip, port, country, isp } = proxyData;
  const proxyAddress = `${ip}:${port}`;
  const timeout = parseInt(env.HEALTH_CHECK_TIMEOUT || '5000', 10);

  // 1. Perform live health check to get fresh status and latency
  const healthResult = await checkProxy(proxyAddress, timeout);

  // 2. Combine with enrichment data from the source file
  const finalData = {
    proxy: proxyAddress,
    status: healthResult.status,
    latency: healthResult.latency,
    country: country,
    isp: isp,
  };

  // 3. Save the combined, fresh data to KV with a 1-hour TTL
  if (env.PROXY_CACHE) {
    await env.PROXY_CACHE.put(proxyAddress, JSON.stringify(finalData), { expirationTtl: 3600 });
  }
}

// Helper function to fetch and parse the proxy list
async function getProxyList(env) {
  const response = await fetch(env.PROXY_LIST_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch proxy list: ${response.status} ${response.statusText}`);
  }
  const textData = await response.text();
  return textData.split('\n')
    .map(line => {
      const parts = line.split(',');
      if (parts.length >= 4) { // Ensure we have all parts: ip, port, country, isp
        const ip = parts[0].trim();
        const port = parts[1].trim();
        const country = parts[2].trim();
        const isp = parts[3].trim();
        if (ip && port && country && isp) {
          return { ip, port, country, isp };
        }
      }
      return null;
    })
    .filter(Boolean);
}

// This function contains the core logic for the scheduled/forced health check.
async function runHealthChecks(env) {
  try {
    const proxies = await getProxyList(env);
    console.log(`Found ${proxies.length} proxies to check.`);

    const checkPromises = proxies.map(proxyData => updateProxyData(proxyData, env));
    await Promise.allSettled(checkPromises);

    console.log("Health checks complete.");
  } catch (error) {
    console.error("Error during health check run:", error);
  }
}

export default {
  async scheduled(controller, env, ctx) {
    console.log("Cron trigger running...");
    ctx.waitUntil(runHealthChecks(env));
  },

  async fetch(request, env, ctx) {
    // Define CORS headers for cross-origin requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === 'POST' && path === '/force-health') {
        ctx.waitUntil(runHealthChecks(env));
        return new Response(JSON.stringify({ message: "Forced health check initiated." }), {
          headers: { 'Content-Type': 'application/json;charset=UTF-8', ...corsHeaders },
        });
      } else if (path === '/health') {
        if (!env.PROXY_CACHE) {
          return new Response("KV Namespace not configured.", { status: 500, headers: corsHeaders });
        }
        const kvList = await env.PROXY_CACHE.list();
        const promises = kvList.keys.map(key => env.PROXY_CACHE.get(key.name, 'json'));
        let results = await Promise.all(promises);

        results = results
          .filter(result => result && result.status === 'alive') // Filter out nulls and dead proxies
          .sort((a, b) => a.latency - b.latency); // Sort by latency, ascending

        return new Response(JSON.stringify(results, null, 2), {
          headers: { 'Content-Type': 'application/json;charset=UTF-8', ...corsHeaders },
        });
      } else {
        // Default behavior for '/' or any other path: return the full, unchecked list
        const proxies = await getProxyList(env);
        const proxyStrings = proxies.map(p => `${p.ip}:${p.port}`);
        return new Response(JSON.stringify(proxyStrings, null, 2), {
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
