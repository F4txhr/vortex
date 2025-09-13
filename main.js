// --- V2Ray Parser Utilities ---

function b64Encode(str) {
    return btoa(str);
}

function createVmessConfig(proxy, config) {
    const [address, portStr] = proxy.split(":");
    const port = parseInt(portStr, 10);
    const remark = proxy;
    return {
        v: "2", ps: remark, add: address, port: port, id: config.VMESS_UUID,
        aid: 0, scy: "auto", net: "ws", type: "none",
        host: config.VMESS_WEBSOCKET_HOST, path: config.VMESS_WEBSOCKET_PATH,
        tls: "tls", sni: config.VMESS_WEBSOCKET_HOST,
    };
}

function parseVmessSubscription(proxies, config) {
    if (!proxies || proxies.length === 0) return "";
    const vmessLinks = proxies.map(proxy => {
        const vmessConfig = createVmessConfig(proxy, config);
        const jsonStr = JSON.stringify(vmessConfig);
        return `vmess://${b64Encode(jsonStr)}`;
    });
    const subscriptionContent = vmessLinks.join('\n');
    return b64Encode(subscriptionContent);
}

function isVmessConfigured(env) {
    return env.VMESS_UUID && env.VMESS_UUID !== "your-uuid-here";
}

// --- Deno KV and Health Checking Logic ---

const kv = await Deno.openKv();

async function checkProxy(proxyAddress, timeout = 5000) {
    const [hostname, portStr] = proxy.split(":");
    if (!hostname || !portStr) return { proxy: proxyAddress, status: "dead", latency: null };
    const port = parseInt(portStr, 10);

    const startTime = Date.now();
    try {
        const conn = await Deno.connect({ hostname, port, transport: "tcp" });
        conn.close();
        return { proxy: proxyAddress, status: "alive", latency: Date.now() - startTime };
    } catch (e) {
        return { proxy: proxyAddress, status: "dead", latency: null, error: e.message };
    }
}

async function getEnrichmentData(ip) {
    const cacheKey = ["geoip", ip];
    const cached = await kv.get(cacheKey);
    if (cached.value) return cached.value;

    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode,isp`);
        if (!response.ok) return { country: "N/A", isp: "N/A" };
        const data = await response.json();
        const enrichmentData = { country: data.countryCode || "N/A", isp: data.isp || "N/A" };
        await kv.set(cacheKey, enrichmentData);
        return enrichmentData;
    } catch (e) {
        return { country: "N/A", isp: "N/A" };
    }
}

// --- Deno Cron for Background Processing ---

Deno.cron("Health Check Cron", "*/1 * * * *", async () => {
    console.log("Cron job started: Checking proxies...");
    const jobState = await kv.get(["job_state"]);
    if (jobState.value !== "running") {
        console.log("Cron: No job running. Exiting.");
        return;
    }

    const BATCH_SIZE = 20; // Deno KV has higher limits, we can use a larger batch
    for (let i = 0; i < BATCH_SIZE; i++) {
        const res = await kv.get(["proxies_to_check"]);
        if (!res.value || res.value.length === 0) {
            console.log("Cron: No more proxies to check.");
            await kv.set(["job_state"], "completed");
            break;
        }

        let proxies = res.value;
        const proxyAddress = proxies.shift(); // Take the first proxy

        // Atomically update the list
        const updateSuccess = await kv.atomic()
            .check(res)
            .set(["proxies_to_check"], proxies)
            .commit();

        if (!updateSuccess) {
            console.log("Cron: Atomic update failed, another worker might be running. Retrying next time.");
            continue;
        }

        try {
            const ip = proxyAddress.split(":")[0];
            const healthResult = await checkProxy(proxyAddress);
            const enrichmentData = await getEnrichmentData(ip);

            const { value: report } = await kv.get(["health_report"]);
            const newReport = report || { statistics: { total_proxies: 0, total_checked: 0, total_alive: 0, countries: {} }, proxies: [] };

            newReport.statistics.total_checked++;
            const country = enrichmentData.country || "N/A";
            if (!newReport.statistics.countries[country]) {
                newReport.statistics.countries[country] = { checked: 0, alive: 0 };
            }
            newReport.statistics.countries[country].checked++;

            if (healthResult.status === 'alive') {
                newReport.statistics.total_alive++;
                newReport.statistics.countries[country].alive++;
                newReport.proxies.push({ ...healthResult, ...enrichmentData });
            }

            await kv.set(["health_report"], newReport);
        } catch(e) {
            console.error(`Cron: Failed to process proxy ${proxyAddress}:`, e);
        }
    }
    console.log("Cron job batch finished.");
});

// --- Deno HTTP Server ---

Deno.serve(async (req) => {
    const url = new URL(req.url);
    const env = Deno.env.toObject();

    // CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Max-Age': '86400' } });
    }

    const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    try {
        if (req.method === 'POST' && url.pathname === '/force-health') {
            const proxyListUrl = env.PROXY_LIST_URL || "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt";
            const response = await fetch(proxyListUrl);
            const textData = await response.text();
            const proxies = textData.split('\n').map(p => p.trim()).filter(Boolean);

            await kv.delete(["health_report"]); // Clear old report
            await kv.set(["proxies_to_check"], proxies);
            await kv.set(["job_state"], "running");

            // Initialize the report object
            await kv.set(["health_report"], {
                generatedAt: new Date().toISOString(),
                statistics: { total_proxies: proxies.length, total_checked: 0, total_alive: 0, countries: {} },
                proxies: []
            });

            return new Response(JSON.stringify({ message: `Health check cycle started for ${proxies.length} proxies.` }), { headers: corsHeaders });
        }

        if (url.pathname === '/health') {
            const report = (await kv.get(["health_report"])).value;
            if (!report) { return new Response(JSON.stringify({ message: "Report not generated yet." }), { status: 404, headers: corsHeaders }); }
            return new Response(JSON.stringify(report, null, 2), { headers: corsHeaders });
        }

        if (url.pathname === '/sub/v2ray') {
            if (!isVmessConfigured(env)) {
                return new Response("V2Ray configuration is not set on the server.", { status: 501 });
            }
            const report = (await kv.get(["health_report"])).value;
            if (!report || !report.proxies || report.proxies.length === 0) {
                return new Response("No alive proxies found.", { status: 404 });
            }
            const alive_proxy_strings = report.proxies.map(p => p.proxy);
            const subscriptionContent = parseVmessSubscription(alive_proxy_strings, env);
            return new Response(subscriptionContent, { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain;charset=UTF-8' } });
        }

        if (url.pathname === '/') {
            let setupMessage = "API is running on Deno Deploy. ";
            if (!isVmessConfigured(env)) {
                setupMessage += "WARNING: V2Ray subscription link is not configured.";
            } else {
                setupMessage += "V2Ray configuration appears to be set.";
            }
            return new Response(`${setupMessage}\n\nAvailable endpoints:\nPOST /force-health\nGET /health\nGET /sub/v2ray`);
        }

        return new Response("Not found.", { status: 404 });

    } catch (error) {
        console.error('Server error:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
});
