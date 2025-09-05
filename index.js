/*
  🌪️ VortexVpn — Dynamic Proxy Bank
  - Ambil proxy list dari GitHub (proxyList.txt)
  - Cache 5 menit di memory Worker
  - Generate Link & Subscription
  - Health check untuk cek proxy hidup/mati
  - /raw untuk ambil list mentah
*/

const SOURCE_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt";

// cache in-memory (bertahan selama Worker instance hidup ± beberapa menit)
let CACHE = {
  proxies: [],
  updatedAt: 0
};

export default {
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") return landing();
    if (url.pathname === "/sub") return subscription();
    if (url.pathname === "/link") return links(url);
    if (url.pathname === "/health") return healthCheck();
    if (url.pathname === "/raw") return rawList();

    return new Response("Not Found", { status: 404 });
  }
};

// 🔹 Ambil daftar proxy dari GitHub (dengan cache 5 menit)
async function fetchProxyList() {
  const now = Date.now();
  if (CACHE.proxies.length && now - CACHE.updatedAt < 5 * 60 * 1000) {
    return CACHE.proxies;
  }

  const resp = await fetch(SOURCE_URL, { cf: { cacheTtl: 0 } });
  const text = await resp.text();
  const list = text.split("\n").map(l => l.trim()).filter(Boolean);

  CACHE.proxies = list;
  CACHE.updatedAt = now;
  return list;
}

// 🔹 Landing page HTML
async function landing() {
  const list = await fetchProxyList();
  const rows = list.map((line, i) => `<tr><td>${i+1}</td><td><code>${line}</code></td></tr>`).join("");

  const html = `<!doctype html>
  <html lang="id">
  <head>
    <meta charset="utf-8" />
    <title>🌪️ VortexVpn</title>
    <style>
      body{font-family:system-ui;background:#0b1020;color:#e7e9ee;padding:20px}
      table{width:100%;border-collapse:collapse;margin-top:20px}
      th,td{padding:8px 12px;border:1px solid #333;text-align:left}
      code{font-size:0.85em;color:#cde3ff}
      a.btn{display:inline-block;padding:8px 12px;margin-top:10px;border:1px solid #39507f;border-radius:8px;color:#e7e9ee;text-decoration:none}
    </style>
  </head>
  <body>
    <h1>🌪️ VortexVpn</h1>
    <p>Proxy list otomatis dari GitHub — optimized for Indonesia.</p>
    <a class="btn" href="/sub">Subscription API</a>
    <a class="btn" href="/health">Cek Health</a>
    <a class="btn" href="/raw">Raw List</a>
    <table>
      <thead><tr><th>No</th><th>Proxy</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
  </html>`;
  return new Response(html, { headers: { "content-type": "text/html;charset=utf-8" } });
}

// 🔹 Subscription (Base64)
async function subscription() {
  const list = await fetchProxyList();
  const data = btoa(unescape(encodeURIComponent(list.join("\n"))));
  return new Response(data, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "profile-update-interval": "6h",
      "subscription-userinfo": `upload=0; download=0; total=0; expire=${Math.floor(Date.now()/1000)+30*86400}`,
    },
  });
}

// 🔹 Ambil link tertentu
async function links(url) {
  const list = await fetchProxyList();
  const id = url.searchParams.get("id");
  let selected = list;
  if (id) selected = [list[parseInt(id)-1]].filter(Boolean);
  return new Response(selected.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}

// 🔹 Cek proxy health (max 10 biar cepat)
async function healthCheck() {
  const list = await fetchProxyList();
  const results = [];

  for (let line of list.slice(0, 10)) { 
    try {
      const u = new URL(line);
      const res = await fetch("https://" + u.hostname, { method: "HEAD", redirect: "manual", cf: { cacheTtl: 0 } });
      results.push({ proxy: line, status: res.status });
    } catch (e) {
      results.push({ proxy: line, status: "dead" });
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "content-type": "application/json" }
  });
}

// 🔹 Raw proxy list (mentah)
async function rawList() {
  const list = await fetchProxyList();
  return new Response(list.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}
