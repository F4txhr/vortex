import { connect } from 'cloudflare:sockets';

// --- V2Ray Parser Utilities ---

function b64Encode(str) {
    return btoa(str);
}

function createVmessConfig(proxy, config) {
    const [address, portStr] = proxy.split(":");
    const port = parseInt(portStr, 10);
    const remark = proxy;

    return {
        v: "2",
        ps: remark,
        add: address,
        port: port,
        id: config.VMESS_UUID,
        aid: 0,
        scy: "auto",
        net: "ws",
        type: "none",
        host: config.VMESS_WEBSOCKET_HOST,
        path: config.VMESS_WEBSOCKET_PATH,
        tls: "tls",
        sni: config.VMESS_WEBSOCKET_HOST,
    };
}

function parseVmessSubscription(proxies, config) {
    if (!proxies || proxies.length === 0) {
        return "";
    }
    const vmessLinks = proxies.map(proxy => {
        const vmessConfig = createVmessConfig(proxy, config);
        const jsonStr = JSON.stringify(vmessConfig);
        return `vmess://${b64Encode(jsonStr)}`;
    });
    const subscriptionContent = vmessLinks.join('\n');
    return b64Encode(subscriptionContent);
}

function isVmessConfigured(env) {
    return env.VMESS_UUID && env.VMESS_UUID !== "your-uuid-here" &&
           env.VMESS_WEBSOCKET_HOST && env.VMESS_WEBSOCKET_HOST !== "your-websocket-host.com";
}

// --- Durable Object Class: The Self-Contained, Alarm-Driven Worker ---
export class HealthCheckerDO {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }

    async checkProxy(proxy, timeout) {
        const [hostname, portStr] = proxy.split(":");
        if (!hostname || !portStr) return { proxy, status: "dead", latency: null };
        const port = parseInt(portStr, 10);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const startTime = Date.now();
        try {
            const socket = connect({ hostname, port }, { signal: controller.signal });
            await socket.close();
            return { proxy, status: "alive", latency: Date.now() - startTime };
        } catch (error) {
            return { proxy, status: "dead", latency: null };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async getEnrichmentData(ip) {
        const cacheKey = `geoip:${ip}`;
        try {
            const cached = await this.env.PROXY_CACHE.get(cacheKey, 'json');
            if (cached) return cached;
            const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode,isp`);
            if (!response.ok) { return { country: "N/A", isp: "N/A" }; }
            const data = await response.json();
            const enrichmentData = { country: data.countryCode || "N/A", isp: data.isp || "N/A" };
            await this.env.PROXY_CACHE.put(cacheKey, JSON.stringify(enrichmentData), { expirationTtl: 604800 });
            return enrichmentData;
        } catch (e) { return { country: "N/A", isp: "N/A" }; }
    }

    async alarm() {
        let stats = await this.state.storage.get("statistics") || {};
        let proxies = await this.state.storage.get("proxies") || [];
        let currentIndex = await this.state.storage.get("currentIndex") || 0;
        let alive_proxies = await this.state.storage.get("alive_proxies") || [];

        const BATCH_SIZE = 10;
        const timeout = parseInt(this.env.HEALTH_CHECK_TIMEOUT || '5000', 10);
        for (let i = 0; i < BATCH_SIZE; i++) {
            if (currentIndex >= proxies.length) break;
            const proxyAddress = proxies[currentIndex];
            try {
                const ip = proxyAddress.split(":")[0];
                const healthResult = await this.checkProxy(proxyAddress, timeout);
                const enrichmentData = await this.getEnrichmentData(ip);

                const newStats = { ...stats };
                newStats.total_checked++;
                const country = enrichmentData.country || "N/A";
                if (!newStats.countries[country]) {
                    newStats.countries[country] = { checked: 0, alive: 0 };
                }
                newStats.countries[country].checked++;

                if (healthResult.status === 'alive') {
                    newStats.total_alive++;
                    newStats.countries[country].alive++;
                    // Create a new array to avoid mutating the object returned from storage.
                    alive_proxies = [...alive_proxies, healthResult.proxy];
                }
                stats = newStats; // Update local reference
            } catch (e) {
                console.error(`Critical error processing proxy ${proxyAddress}:`, e);
                stats = { ...stats, total_checked: stats.total_checked + 1 };
            }
            currentIndex++;
        }

        await this.state.storage.put("currentIndex", currentIndex);
        await this.state.storage.put("statistics", stats);
        await this.state.storage.put("alive_proxies", alive_proxies);

        // ALWAYS generate a report after each batch for near real-time updates.
        await this.generateAndStoreReport(stats, alive_proxies);

        if (currentIndex < proxies.length) {
            await this.state.storage.setAlarm(Date.now() + 1000);
        } else {
             // If we are done, clear the DO state for the next run.
             // This is now safe because the report is already in KV.
            await this.state.storage.deleteAll();
        }
    }

    async generateAndStoreReport(stats, alive_proxies) {
        const summaryReport = { generatedAt: new Date().toISOString(), statistics: stats };
        await this.env.PROXY_CACHE.put("LATEST_HEALTH_REPORT", JSON.stringify(summaryReport));
        await this.env.PROXY_CACHE.put("LATEST_ALIVE_PROXIES", JSON.stringify(alive_proxies));
    }

    async fetch(request) {
        // A new cycle always clears previous state.
        await this.state.storage.deleteAll();

        const response = await fetch(this.env.PROXY_LIST_URL);
        if (!response.ok) { return new Response(`Failed to fetch proxy list: ${response.status}`, { status: 500 }); }
        const textData = await response.text();
        const proxies = textData.split('\n').map(p => p.trim()).filter(Boolean);
        if (proxies.length === 0) { return new Response("Proxy list was empty.", { status: 200 }); }

        await this.state.storage.put("proxies", proxies);
        await this.state.storage.put("currentIndex", 0);
        await this.state.storage.put("alive_proxies", []);
        await this.state.storage.put("statistics", {
            total_proxies: proxies.length,
            total_checked: 0,
            total_alive: 0,
            countries: {}
        });

        // Kick off the first alarm.
        await this.state.storage.setAlarm(Date.now() + 1000);
        return new Response(`Health check cycle started for ${proxies.length} proxies.`, { status: 202 });
    }
}

// --- Main Worker Logic ---
export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Max-Age': '86400',
        };
        if (request.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

        const url = new URL(request.url);
        const id = env.HEALTH_CHECKER.idFromName("singleton-queue-manager");
        const stub = env.HEALTH_CHECKER.get(id);
        try {
            if (request.method === 'POST' && url.pathname === '/force-health') {
                const response = await stub.fetch(request);
                return new Response(await response.text(), { status: response.status, headers: corsHeaders });
            }
            if (url.pathname === '/health') {
                const report = await env.PROXY_CACHE.get("LATEST_HEALTH_REPORT", 'json');
                if (!report) { return new Response(JSON.stringify({ message: "Report not generated yet." }), { status: 404, headers: { 'Content-Type': 'application/json;charset=UTF-8', ...corsHeaders }}); }
                return new Response(JSON.stringify(report, null, 2), { headers: { 'Content-Type': 'application/json;charset=UTF-8', ...corsHeaders }});
            }
            if (url.pathname === '/sub/v2ray') {
                if (!isVmessConfigured(env)) {
                    return new Response("V2Ray configuration is not set on the server. The administrator must set VMESS_UUID and VMESS_WEBSOCKET_HOST in wrangler.toml.", { status: 501, headers: corsHeaders });
                }
                const alive_proxies = await env.PROXY_CACHE.get("LATEST_ALIVE_PROXIES", 'json');
                if (!alive_proxies || alive_proxies.length === 0) {
                    return new Response("No alive proxies found or health check not complete.", { status: 404, headers: corsHeaders });
                }
                const subscriptionContent = parseVmessSubscription(alive_proxies, env);
                return new Response(subscriptionContent, { headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...corsHeaders }});
            }
            if (url.pathname === '/') {
                let setupMessage = "API is running. ";
                if (!isVmessConfigured(env)) {
                    setupMessage += "WARNING: V2Ray subscription link is not configured. The administrator must set VMESS_UUID and VMESS_WEBSOCKET_HOST in wrangler.toml for the /sub/v2ray endpoint to work.";
                } else {
                    setupMessage += "V2Ray configuration appears to be set.";
                }
                return new Response(`${setupMessage}\n\nAvailable endpoints:\nPOST /force-health\nGET /health\nGET /sub/v2ray`, { headers: corsHeaders });
            }
            return new Response("Not found.", { status: 404, headers: corsHeaders });
        } catch (error) {
            console.error('Worker error:', error);
            return new Response(error.message, { status: 500, headers: corsHeaders });
        }
    },
};
