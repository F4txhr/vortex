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

      // Return the list of proxies as a JSON array
      return new Response(JSON.stringify(proxies, null, 2), {
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          ...corsHeaders,
        },
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(error.message, {
        status: 500,
        headers: { ...corsHeaders },
      });
    }
  },
};
