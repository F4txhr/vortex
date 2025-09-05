/*
  🌪️ VortexVpn — Dynamic Proxy Bank
  - Ambil proxy list dari GitHub (proxyList.txt)
  - Cache 5 menit menggunakan Cloudflare Cache API
  - Generate Link & Subscription
  - Health check untuk cek proxy hidup/mati
  - /raw untuk ambil list mentah
*/

const SOURCE_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt";

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

// 🔹 Ambil daftar proxy dari GitHub (dengan cache 5 menit menggunakan Cache API)
async function fetchProxyList() {
  const cache = caches.default;
  const cacheKey = new Request(SOURCE_URL);

  let response = await cache.match(cacheKey);

  if (!response) {
    // Jika tidak ada di cache, fetch dari sumber
    const sourceResponse = await fetch(SOURCE_URL, { cf: { cacheTtl: 0 } }); // Biarkan kita yang mengontrol cache

    // Buat response baru dengan header cache
    response = new Response(sourceResponse.body, sourceResponse);
    response.headers.set("Cache-Control", "s-maxage=300"); // Cache selama 5 menit (300 detik)

    // Simpan ke cache. Awaiting this ensures the cache is written.
    await cache.put(cacheKey, response.clone());
  }

  const text = await response.text();
  return text.split("\n").map(l => l.trim()).filter(Boolean);
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
  const idStr = url.searchParams.get("id");

  if (!idStr) {
    // Jika tidak ada id, kembalikan semua link
    return new Response(list.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const id = parseInt(idStr, 10);

  if (isNaN(id) || id < 1) {
    return new Response("Error: Invalid ID parameter. ID must be a positive integer.", { status: 400 });
  }

  if (id > list.length) {
    return new Response(`Error: Invalid ID. ID must be between 1 and ${list.length}.`, { status: 404 });
  }

  const selected = list[id - 1];
  return new Response(selected, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

// 🔹 Cek proxy health (max 10 biar cepat)
// Catatan: Pengecekan ini terbatas karena limitasi platform Cloudflare.
// Hanya port HTTPS standar (443, 2053, 2083, 2087, 2096, 8443) yang bisa dites.
async function healthCheck() {
  const list = await fetchProxyList();
  const results = [];
  const ALLOWED_PORTS = [443, 2053, 2083, 2087, 2096, 8443];

  // Jalankan pengecekan secara paralel untuk kecepatan
  const promises = list.slice(0, 10).map(async (line) => {
    let status = "untested";
    try {
      const u = new URL(line);
      // Fallback ke port 443 jika tidak ada port spesifik
      const port = parseInt(u.port || "443", 10);

      if (ALLOWED_PORTS.includes(port)) {
        // Hanya coba fetch jika port diizinkan
        const res = await fetch(`https://${u.hostname}:${port}`, {
          method: "HEAD",
          redirect: "manual",
          signal: AbortSignal.timeout(4000), // Tambah timeout 4 detik
          cf: { cacheTtl: 0 }
        });
        status = res.status;
      } else {
        status = `unsupported_port (${u.port})`;
      }
    } catch (e) {
      // Tangkap error seperti timeout atau koneksi gagal
      status = "dead";
    }
    return { proxy: line, status: status };
  });

  const settledResults = await Promise.allSettled(promises);
  settledResults.forEach(res => {
    if(res.status === 'fulfilled') {
      results.push(res.value);
    } else {
      // Should not happen with the current logic, but as a fallback
      results.push({ proxy: 'unknown', status: 'check_failed' });
    }
  });

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
