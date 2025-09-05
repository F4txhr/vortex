/*
  🌪️ VortexVpn — Serverless V2Ray Tunnel (Cloudflare Workers)
  Bahasa Indonesia | Multi-node proxy bank + Subscription API

  Endpoint:
    /        -> Landing (dashboard list proxy)
    /link    -> Generate shareable links (single node / semua node)
    /sub     -> Subscription (v2ray/Clash-compatible base64 list)

  ⚠️ Catatan:
  - Fokus utama: VLESS & Trojan via WebSocket
  - UDP tidak didukung (batasan Workers)
  - PROXIES bisa diganti dengan KV/DO untuk dinamis
*/

const CONF = {
  DOH_URL: "https://cloudflare-dns.com/dns-query",
};

const PROXIES = [
  {
    id: "sg1",
    type: "vless",
    uuid: "11111111-1111-1111-1111-111111111111",
    host: "sg1.proxy.net",
    path: "/vless",
    isp: "SingTel",
    location: "Singapore",
    latency: 35,
  },
  {
    id: "id1",
    type: "trojan",
    psk: "changeme-trojan",
    host: "id1.proxy.net",
    path: "/trojan",
    isp: "IndiHome",
    location: "Jakarta",
    latency: 12,
  },
];

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname === "/") return landing(req);
    if (url.pathname === "/link") return links(req, url);
    if (url.pathname === "/sub") return subscription(req, url);

    return new Response("Not Found", { status: 404 });
  },
};

// ======= Landing Page =======
function landing(req) {
  const host = new URL(req.url).host;
  const rows = PROXIES.map((p) => {
    const link = makeLink(p, host);
    return `<tr><td>${p.id}</td><td>${p.type}</td><td>${p.isp}</td><td>${p.location}</td><td>${p.latency} ms</td><td><code>${link}</code></td></tr>`;
  }).join("");

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
    <p>Pusat akun proxy serverless di Cloudflare Workers — optimized for Indonesia.</p>
    <a class="btn" href="/sub">Subscription API</a>
    <table>
      <thead><tr><th>ID</th><th>Type</th><th>ISP</th><th>Lokasi</th><th>Latency</th><th>Link</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
  </html>`;

  return new Response(html, {
    headers: { "content-type": "text/html;charset=utf-8" },
  });
}

// ======= Generate Link =======
function links(req, url) {
  const host = url.host;
  const id = url.searchParams.get("node");
  let selected = PROXIES;
  if (id) selected = PROXIES.filter((p) => p.id === id);
  const body = selected.map((p) => makeLink(p, host)).join("\n");
  return new Response(body + "\n", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// ======= Subscription API =======
function subscription(req, url) {
  const host = url.host;
  let filtered = PROXIES;

  if (url.searchParams.has("isp")) {
    const isp = url.searchParams.get("isp");
    filtered = filtered.filter(
      (p) => p.isp.toLowerCase() === isp.toLowerCase()
    );
  }
  if (url.searchParams.has("node")) {
    const node = url.searchParams.get("node");
    filtered = filtered.filter((p) => p.id === node);
  }

  const list = filtered.map((p) => makeLink(p, host)).join("\n");
  const data = btoa(unescape(encodeURIComponent(list)));
  return new Response(data, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "profile-update-interval": "6h",
      "subscription-userinfo": `upload=0; download=0; total=0; expire=${
        Math.floor(Date.now() / 1000) + 30 * 86400
      }`,
    },
  });
}

// ======= Link Generator =======
function makeLink(p, host) {
  if (p.type === "vless") {
    const q = new URLSearchParams({
      type: "ws",
      security: "tls",
      sni: host,
      path: p.path,
      host,
      alpn: "h2,http/1.1",
      fp: "chrome",
    }).toString();
    return `vless://${p.uuid}@${host}:443?${q}#${encodeURIComponent(
      `Vortex-${p.id}`
    )}`;
  }
  if (p.type === "trojan") {
    const q = new URLSearchParams({
      type: "ws",
      security: "tls",
      sni: host,
      path: p.path,
      host,
      alpn: "h2,http/1.1",
      fp: "chrome",
    }).toString();
    return `trojan://${p.psk}@${host}:443?${q}#${encodeURIComponent(
      `Vortex-${p.id}`
    )}`;
  }
  return "";
}

// ======= DoH Resolver (Optional) =======
async function dohResolveA(host, dohUrl = CONF.DOH_URL) {
  const dnsQuery = makeDnsQuery(host);
  const resp = await fetch(dohUrl, {
    method: "POST",
    headers: { "content-type": "application/dns-message" },
    body: dnsQuery,
  });
  if (!resp.ok) return null;
  const buf = await resp.arrayBuffer();
  return parseDnsAnswer(buf);
}

function makeDnsQuery(host) {
  // Minimal DNS wire-format query untuk A record
  const encoder = new TextEncoder();
  const nameParts = host.split(".");
  let qname = [];
  for (const part of nameParts) {
    qname.push(part.length);
    qname.push(...encoder.encode(part));
  }
  qname.push(0);

  const header = new Uint8Array([
    0x00,
    0x00, // ID
    0x01,
    0x00, // flags: recursion desired
    0x00,
    0x01, // QDCOUNT
    0x00,
    0x00, // ANCOUNT
    0x00,
    0x00, // NSCOUNT
    0x00,
    0x00, // ARCOUNT
  ]);
  const qtypeqclass = new Uint8Array([0x00, 0x01, 0x00, 0x01]); // QTYPE=A, QCLASS=IN
  return new Uint8Array([...header, ...qname, ...qtypeqclass]);
}

function parseDnsAnswer(buf) {
  const dv = new DataView(buf);
  const anCount = dv.getUint16(6);
  if (anCount < 1) return null;

  // sangat minimal, lompat ke bagian jawaban (skip header + question)
  // praktik aslinya parsing lebih kompleks
  // untuk demo kita anggap response benar dan ambil 4 byte terakhir
  const ip = Array.from(new Uint8Array(buf).slice(-4)).join(".");
  return ip;
}
