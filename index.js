import { connect } from 'cloudflare:sockets';

async function checkProxy(proxy) {
  const [hostname, portStr] = proxy.split(':');
  const port = parseInt(portStr, 10);

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), 2000) // 2-second timeout
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

export default {
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

      // Fetch the proxy list from the URL specified in the environment variables
      const response = await fetch(env.PROXY_LIST_URL);

      if (!response.ok) {
        const errorText = `Error fetching proxy list: ${response.status} ${response.statusText}`;
        console.error(errorText);
        return new Response(errorText, {
          status: response.status,
          headers: { ...corsHeaders },
        });
      }

      const textData = await response.text();
      const lines = textData.split('\n');

      // Parse each line to extract the IP and port
      const proxies = lines
        .map(line => {
          const parts = line.split(',');
          // Ensure the line has at least an IP and a port
          if (parts.length >= 2) {
            const ip = parts[0].trim();
            const port = parts[1].trim();
            // Basic validation to ensure ip and port are not empty
            if (ip && port) {
              return `${ip}:${port}`;
            }
          }
          return null;
        })
        .filter(Boolean); // Filter out any null entries from invalid or empty lines

      // Routing based on the path
      if (path === '/health') {
        const healthCheckPromises = proxies.map(checkProxy);
        const results = await Promise.allSettled(healthCheckPromises);

        const healthData = results
          .filter(result => result.status === 'fulfilled')
          .map(result => result.value)
          .filter(result => result.status === 'alive') // Keep only alive proxies
          .sort((a, b) => a.latency - b.latency); // Sort by latency, ascending

        return new Response(JSON.stringify(healthData, null, 2), {
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            ...corsHeaders,
          },
        });
      } else {
        // Default behavior for '/' or any other path: return the full, unchecked list
        return new Response(JSON.stringify(proxies, null, 2), {
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            ...corsHeaders,
          },
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
