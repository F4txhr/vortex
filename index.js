import { connect } from 'cloudflare:sockets';

export default {
    async fetch(request, env, ctx) {
        try {
            // We will try to connect to a known, reliable address.
            // 1.1.1.1 is Cloudflare's public DNS resolver, and port 53 is for DNS.
            // This is a good target for a simple TCP connection test.
            const socket = connect({ hostname: '1.1.1.1', port: 53 });

            // If the connection is successful, we just close it.
            await socket.close();

            // If we reach here, it means the `connect` API is available and worked.
            return new Response("Experiment SUCCESS: The 'sockets' API is available in this environment.", {
                status: 200,
            });

        } catch (e) {
            // If we are here, it means the `connect` call failed for some reason.
            // This could be a network error, or because the API is not truly available.
            // The error message `e.message` will be very informative.
            console.error(e);
            return new Response(`Experiment FAILED: The 'sockets' API call failed with the error: ${e.message}`, {
                status: 500,
            });
        }
    },
};
