import { addLog, logEvents } from './src/logging.js';
import * as config from './src/config.js';
import {
  getProxyList,
  getAllConfig,
  websocketHandler,
  reverseProxy,
  checkProxyHealth
} from './src/handlers.js';

// The original script used this as a global state variable.
// We keep it here to be passed to the handlers that need it.
let isApiReady = false;

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");

      if (config.apiKey && config.apiEmail && config.accountID && config.zoneID) {
        isApiReady = true;
      }

      // Route WebSocket requests to the WebSocket handler
      if (upgradeHeader === "websocket") {
        return await websocketHandler(request, addLog);
      }

      // Route various HTTP GET pages
      if (url.pathname.startsWith("/sub")) {
        const pageMatch = url.pathname.match(/^\/sub\/(\d+)$/);
        const pageIndex = parseInt(pageMatch ? pageMatch[1] : "0");
        const hostname = request.headers.get("Host");
        const proxyList = await getProxyList(env.PROXY_BANK_URL || config.PROXY_BANK_URL);

        const html = getAllConfig(request, hostname, proxyList, pageIndex, isApiReady);
        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html;charset=utf-8" },
        });
      }

      if (url.pathname.startsWith("/check")) {
        const target = url.searchParams.get("target").split(":");
        const result = await checkProxyHealth(target[0], target[1] || "443");
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json", ...config.CORS_HEADER_OPTIONS },
        });
      }

      if (url.pathname === "/log") {
        return new Response(logEvents.join('\n'), {
          headers: { "Content-Type": "text/plain;charset=utf-8", ...config.CORS_HEADER_OPTIONS },
        });
      }

      // Fallback for other routes is a reverse proxy.
      const targetReverseProxy = env.REVERSE_PROXY_TARGET || "example.com";
      return await reverseProxy(request, targetReverseProxy);

    } catch (err) {
      addLog(`FATAL ERROR in fetch handler: ${err.toString()}`);
      return new Response(`An error occurred: ${err.toString()}`, {
        status: 500,
        headers: { ...config.CORS_HEADER_OPTIONS }
      });
    }
  },
};
