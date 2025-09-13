/**
 * Checks a proxy's health by attempting an HTTP CONNECT request.
 * @param {string} proxyAddress - The proxy address in "ip:port" format.
 * @param {number} timeout - Timeout in milliseconds.
 * @returns {Promise<object>} - A promise that resolves to a result object.
 */
async function checkProxyHTTP(proxyAddress, timeout = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const startTime = Date.now();
    try {
        // We are attempting to establish a tunnel to a reliable host through the proxy.
        // This is a standard way to check if an HTTP proxy is functional.
        const response = await fetch(`http://${proxyAddress}`, {
            method: 'CONNECT',
            headers: {
                // The Host header specifies the target endpoint we want the proxy to connect to.
                'Host': 'www.cloudflare.com:443'
            },
            signal: controller.signal,
        });

        const latency = Date.now() - startTime;

        // A successful CONNECT request typically returns a 2xx status code.
        if (response.status >= 200 && response.status < 300) {
            return {
                proxy: proxyAddress,
                status: "alive",
                http_status: response.status,
                latency: latency,
                check_method: "HTTP_CONNECT"
            };
        } else {
            return {
                proxy: proxyAddress,
                status: "dead",
                http_status: response.status,
                error: `Received non-2xx status: ${response.statusText}`,
                latency: latency,
                check_method: "HTTP_CONNECT"
            };
        }
    } catch (e) {
        // Errors are often timeouts or connection refusals.
        return {
            proxy: proxyAddress,
            status: "dead",
            http_status: null,
            error: e.message,
            latency: Date.now() - startTime,
            check_method: "HTTP_CONNECT"
        };
    } finally {
        clearTimeout(timeoutId);
    }
}


export default {
    async fetch(request, env, ctx) {
        // The proxy provided by the user for the test.
        const testProxy = "152.32.181.246:44070";

        console.log(`Testing proxy: ${testProxy}`);
        const result = await checkProxyHTTP(testProxy);
        console.log("Test result:", result);

        return new Response(JSON.stringify(result, null, 2), {
            headers: { 'Content-Type': 'application/json' },
        });
    },
};
