// --- Helper: Performs a TCP connection test to a given proxy ---
async function checkProxy(proxy, timeout) {
    const [hostname, portStr] = proxy.split(":");
    if (!hostname || !portStr) return { proxy, status: "dead", latency: null };
    const port = parseInt(portStr, 10);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const startTime = Date.now();
    try {
        // @ts-ignore: The `connect` global is not recognized in all TS environments.
        const socket = connect({ hostname, port }, { signal: controller.signal });
        await socket.close();
        return { proxy, status: "alive", latency: Date.now() - startTime };
    } catch (error) {
        return { proxy, status: "dead", latency: null };
    } finally {
        clearTimeout(timeoutId);
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

// --- Durable Object Class: The Central Coordinator and State Machine ---
export class HealthCheckerDO {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }

    async generateAndStoreReport() {
        console.log("DO: All jobs complete. Generating final report.");
        const results = await this.state.storage.get("results") || [];

        const aliveProxies = results
            .filter(result => result && result.status === 'alive')
            .sort((a, b) => a.latency - b.latency);

        const report = {
            generatedAt: new Date().toISOString(),
            proxyCount: aliveProxies.length,
            proxies: aliveProxies,
        };

        await this.env.PROXY_CACHE.put("LATEST_HEALTH_REPORT", JSON.stringify(report));
        console.log("DO: Final report generated and stored in KV.");
        await this.state.storage.deleteAll();
        console.log("DO: State cleared. Ready for next cycle.");
    }

    async startCycle() {
        const isRunning = await this.state.storage.get("isRunning");
        if (isRunning) {
            return new Response("Health check cycle is already running.", { status: 409 });
        }

        console.log("DO: Starting new health check cycle.");
        await this.state.storage.put("isRunning", true);

        const response = await fetch(this.env.PROXY_LIST_URL);
        if (!response.ok) {
            console.error(`DO: Failed to fetch proxy list: ${response.status}`);
            await this.state.storage.deleteAll();
            return new Response(`Failed to fetch proxy list: ${response.status}`, { status: 500 });
        }

        const textData = await response.text();
        const proxies = textData.split('\n').map(p => p.trim()).filter(Boolean);

        if (proxies.length === 0) {
            console.log("DO: Proxy list was empty. Cleaning up.");
            await this.state.storage.deleteAll();
            return new Response("Proxy list was empty.", { status: 200 });
        }

        console.log(`DO: Loaded ${proxies.length} proxies.`);
        await this.state.storage.put("proxies", proxies);
        await this.state.storage.put("results", []);
        await this.state.storage.put("jobs_remaining", proxies.length);
        await this.state.storage.put("currentIndex", 0);

        return new Response(`Health check cycle started for ${proxies.length} proxies.`, { status: 202 });
    }

    async getJob() {
        const isRunning = await this.state.storage.get("isRunning");
        if (!isRunning) return null;

        let currentIndex = await this.state.storage.get("currentIndex") || 0;
        const proxies = await this.state.storage.get("proxies") || [];

        if (!proxies || currentIndex >= proxies.length) {
            return null; // No jobs ready or no more jobs
        }

        const job = proxies[currentIndex];
        await this.state.storage.put("currentIndex", currentIndex + 1);
        return job;
    }

    async recordResult(result) {
        await this.state.blockConcurrencyWhile(async () => {
            const isRunning = await this.state.storage.get("isRunning");
            if (!isRunning) return;

            let results = await this.state.storage.get("results") || [];
            results.push(result);
            await this.state.storage.put("results", results);

            let remaining = await this.state.storage.get("jobs_remaining");
            if (typeof remaining !== 'number') return;

            remaining--;
            await this.state.storage.put("jobs_remaining", remaining);

            if (remaining <= 0) {
                await this.generateAndStoreReport();
            }
        });
    }
}

// --- Main Worker Logic ---
export default {
    async scheduled(event, env, ctx) {
        const id = env.HEALTH_CHECKER.idFromName("singleton-queue-manager");
        const stub = env.HEALTH_CHECKER.get(id);

        // Process a small, fixed-size batch of jobs to stay under subrequest limits.
        const BATCH_SIZE = 10;
        for (let i = 0; i < BATCH_SIZE; i++) {
            // Get a job directly from the DO coordinator.
            const proxyAddress = await stub.getJob();

            if (!proxyAddress) {
                break; // No more jobs in the queue.
            }

            const ip = proxyAddress.split(":")[0];
            const timeout = parseInt(env.HEALTH_CHECK_TIMEOUT || '5000', 10);

            const healthResult = await checkProxy(proxyAddress, timeout);

            let finalData = healthResult;
            if (healthResult.status === 'alive') {
                const enrichmentData = await getEnrichmentData(ip, env);
                finalData = { ...healthResult, ...enrichmentData };
            }

            ctx.waitUntil(stub.recordResult(finalData));
        }
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

        const url = new URL(request.url);
        const id = env.HEALTH_CHECKER.idFromName("singleton-queue-manager");
        const stub = env.HEALTH_CHECKER.get(id);

        try {
            if (request.method === 'POST' && url.pathname === '/force-health') {
                const response = await stub.startCycle();
                return new Response(await response.text(), { status: response.status, headers: corsHeaders });
            }

            if (url.pathname === '/health') {
                const report = await env.PROXY_CACHE.get("LATEST_HEALTH_REPORT", 'json');
                if (!report) {
                    return new Response(JSON.stringify({ message: "Report not generated yet. Trigger a health check via POST /force-health and wait for it to complete." }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json;charset=UTF-8', ...corsHeaders },
                    });
                }
                return new Response(JSON.stringify(report, null, 2), {
                    headers: { 'Content-Type': 'application/json;charset=UTF-8', ...corsHeaders },
                });
            }

            return new Response("API is running. Use POST /force-health to start a check, and GET /health to view the report.", {
                headers: corsHeaders,
            });

        } catch (error) {
            console.error('Worker error:', error);
            return new Response(error.message, { status: 500, headers: corsHeaders });
        }
    },
};
