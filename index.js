/*
  VortexVpn — Cloudflare Worker (Bank Proxy Manager)
  Bahasa Indonesia

  Fitur utama:
  - Endpoint `/` -> dashboard HTML menampilkan daftar proxy (ISP, lokasi, latency, link)
  - Endpoint `/link?node=<id>` -> mengeluarkan link (vless:// / trojan://) untuk node
  - Endpoint `/sub` (+ filter query) -> subscription (base64) berisi kumpulan link sesuai filter
  - Endpoint `/api/nodes` -> JSON daftar node (untuk dipakai programmatically)
  - Endpoint `/vless/{id}` dan `/trojan/{id}` -> handler WebSocket yang meneruskan koneksi ke backend sesuai node

  Catatan:
  - UDP tidak didukung (batasan Cloudflare Workers).
  - PROXIES disimpan di array (bisa diupgrade ke KV atau Durable Objects jika mau dinamis).
  - Untuk produksi, GANTI UUID / PSK default, dan pertimbangkan rate-limiting + auth.
*/

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Konfigurasi dasar
    const CONF = {
      NAME: env.NAME || 'VortexVpn',
      DOH_URL: env.DOH_URL || 'https://cloudflare-dns.com/dns-query',
    };

    // Daftar proxy (bank). Ubah / tambahkan sesuai kebutuhan.
    const PROXIES = [
      {
        id: 'id-jkt-1',
        type: 'trojan', // 'vless' atau 'trojan'
        backend_host: '203.0.113.10',
        backend_port: 443,
        psk: 'trojan-secret-1',
        isp: 'IndiHome',
        location: 'Jakarta',
        latency: 18,
        note: 'Edge JKT 1'
      },
      {
        id: 'sg-sg1',
        type: 'vless',
        backend_host: '198.51.100.23',
        backend_port: 443,
        uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        isp: 'SingTel',
        location: 'Singapore',
        latency: 28,
        note: 'SG Primary'
      },
      {
        id: 'hk-hk1',
        type: 'vless',
        backend_host: '192.0.2.45',
        backend_port: 443,
        uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        isp: 'HKNet',
        location: 'Hong Kong',
        latency: 35,
        note: 'HK Backup'
      }
    ];

    // Routing
    if (pathname === '/') return dashboard(req, CONF, PROXIES);
    if (pathname === '/link') return linkEndpoint(req, CONF, PROXIES);
    if (pathname === '/sub') return subEndpoint(req, CONF, PROXIES);
    if (pathname === '/api/nodes') return apiNodes(req, CONF, PROXIES);

    // Dynamic proxy paths: /vless/{id} and /trojan/{id}
    const vlessMatch = pathname.match(/^\/vless\/(.+)$/);
    if (vlessMatch) return vlessHandler(req, CONF, PROXIES, vlessMatch[1]);
    const trojanMatch = pathname.match(/^\/trojan\/(.+)$/);
    if (trojanMatch) return trojanHandler(req, CONF, PROXIES, trojanMatch[1]);

    return new Response('Not found', { status: 404 });
  }
};

// ---------------- UI / Endpoints ----------------
function dashboard(req, CONF, PROXIES) {
  const host = new URL(req.url).host;
  // Buat baris tabel
  const rows = PROXIES.map(p => {
    const link = p.type === 'vless' ? makeVlessLink({ host, id: p.id }) : makeTrojanLink({ host, id: p.id });
    return `
      <tr>
        <td>${p.id}</td>
        <td>${p.type.toUpperCase()}</td>
        <td>${p.isp}</td>
        <td>${p.location}</td>
        <td>${p.latency} ms</td>
        <td><code>${escapeHtml(link)}</code></td>
        <td><a class="btn" href="/link?node=${encodeURIComponent(p.id)}">Ambil</a></td>
      </tr>`;
  }).join('\n');

  const html = `<!doctype html>
  <html lang="id">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${CONF.NAME}</title>
    <style>
      body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;margin:24px;background:#0f1724;color:#e6eef8}
      .card{max-width:1100px;margin:auto;background:#0b1220;padding:18px;border-radius:12px}
      table{width:100%;border-collapse:collapse}
      th,td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:left}
      th{color:#a9c0ff}
      code{background:#071228;padding:4px 6px;border-radius:6px}
      .btn{display:inline-block;padding:8px 10px;border-radius:8px;background:#1f6feb;color:white;text-decoration:none}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${CONF.NAME}</h1>
      <p>Daftar node proxy (bank). Klik <strong>Ambil</strong> untuk menyalin link akun.</p>
      <table>
        <thead><tr><th>ID</th><th>Type</th><th>ISP</th><th>Lokasi</th><th>Latency</th><th>Link</th><th>Aksi</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <p style="margin-top:12px;color:#9fb2ff">API: <code>/api/nodes</code> — Subscription: <code>/sub</code>. Contoh: <code>/sub?isp=IndiHome</code></p>
    </div>
  </body>
  </html>`;

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function linkEndpoint(req, CONF, PROXIES) {
  const url = new URL(req.url);
  const node = url.searchParams.get('node');
  if (!node) return new Response('node query param required', { status: 400 });
  const p = PROXIES.find(x => x.id === node);
  if (!p) return new Response('node not found', { status: 404 });
  const host = new URL(req.url).host;
  const link = p.type === 'vless' ? makeVlessLink({ host, id: p.id }) : makeTrojanLink({ host, id: p.id });
  return new Response(link + '\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function subEndpoint(req, CONF, PROXIES) {
  const url = new URL(req.url);
  // Filter support: ?isp=IndiHome, ?type=vless, ?node=id-123
  const params = url.searchParams;
  let list = PROXIES.slice();
  if (params.has('isp')) list = list.filter(p => p.isp.toLowerCase() === params.get('isp').toLowerCase());
  if (params.has('type')) list = list.filter(p => p.type.toLowerCase() === params.get('type').toLowerCase());
  if (params.has('node')) list = list.filter(p => p.id === params.get('node'));

  const host = url.host;
  const links = list.map(p => p.type === 'vless' ? makeVlessLink({ host, id: p.id }) : makeTrojanLink({ host, id: p.id }));
  const payload = links.join('\n');
  const data = btoa(unescape(encodeURIComponent(payload)));

  return new Response(data + '\n', {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'profile-update-interval': '6h',
      'subscription-userinfo': `upload=0; download=0; total=0; expire=${Math.floor(Date.now()/1000)+30*86400}`
    }
  });
}

function apiNodes(req, CONF, PROXIES) {
  const url = new URL(req.url);
  let list = PROXIES.slice();
  if (url.searchParams.has('isp')) list = list.filter(p => p.isp.toLowerCase() === url.searchParams.get('isp').toLowerCase());
  const out = list.map(p => ({ id: p.id, type: p.type, isp: p.isp, location: p.location, latency: p.latency, note: p.note }));
  return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}

// ---------------- Proxy Handlers ----------------
// Handler ini menerima WebSocket dari klien dan meneruskan ke backend node.
// Untuk VLESS: melakukan validasi UUID dari payload handshake.
// Untuk Trojan: validasi PSK (dalam handshake awal).

async function vlessHandler(req, CONF, PROXIES, nodeId) {
  const p = PROXIES.find(x => x.id === nodeId && x.type === 'vless');
  if (!p) return new Response('node not found', { status: 404 });
  if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });

  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  server.addEventListener('message', async (ev) => {
    const buf = new Uint8Array(ev.data);
    try {
      // Parse VLESS handshake (minimal)
      const dv = new DataView(buf.buffer);
      const ver = dv.getUint8(0);
      if (ver !== 1) throw new Error('bad ver');
      const uuidBytes = buf.slice(1, 17);
      if (!uuidEqual(uuidBytes, p.uuid)) throw new Error('invalid uuid');
      const optLen = dv.getUint8(17);
      const idxAfterOpt = 18 + optLen;
      const cmd = dv.getUint8(idxAfterOpt);
      if (cmd !== 1) throw new Error('only tcp supported');
      const port = dv.getUint16(idxAfterOpt + 1);
      const at = dv.getUint8(idxAfterOpt + 3);
      let host = '';
      let off = idxAfterOpt + 4;
      if (at === 1) { host = [...buf.slice(off, off+4)].join('.'); off += 4; }
      else if (at === 2) { const l = dv.getUint8(off); off++; host = new TextDecoder().decode(buf.slice(off, off + l)); off += l; }
      else if (at === 3) { const p16 = buf.slice(off, off+16); const dd = new DataView(p16.buffer); const parts = []; for (let i=0;i<8;i++) parts.push(dd.getUint16(i*2).toString(16)); host = parts.join(':'); off += 16; }

      // Connect ke backend node
      const socket = await connectToBackend(p.backend_host, p.backend_port, CONF);
      // Kirim response awal ke klien
      server.send(new Uint8Array([0,0]));

      // Pipe TCP <-> WS
      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          server.send(value);
        }
        server.close();
      })();

      // Kirim sisa data dari handshake
      const rest = buf.slice(off);
      if (rest.length) await writer.write(rest);

      server.addEventListener('message', async (e2) => {
        if (typeof e2.data === 'string') return;
        await writer.write(new Uint8Array(e2.data));
      });

      server.addEventListener('close', async () => { try { await writer.close(); } catch(e){} });

    } catch (e) {
      server.close(1011, e.message);
    }
  });

  return new Response(null, { status: 101, webSocket: client });
}

async function trojanHandler(req, CONF, PROXIES, nodeId) {
  const p = PROXIES.find(x => x.id === nodeId && x.type === 'trojan');
  if (!p) return new Response('node not found', { status: 404 });
  if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });

  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  server.addEventListener('message', async (ev) => {
    const buf = new Uint8Array(ev.data);
    try {
      const text = new TextDecoder().decode(buf);
      const [line1, line2] = text.split('\r\n');
      if (!line1 || !line1.startsWith(p.psk)) throw new Error('invalid psk');
      const m = /HOST:\s([^:]+):(\d+)/i.exec(line2 || '');
      if (!m) throw new Error('bad host');
      const host = m[1];
      const port = parseInt(m[2],10);

      const socket = await connectToBackend(p.backend_host, p.backend_port, CONF);
      server.send(new TextEncoder().encode('HTTP/1.1 200 OK\r\n\r\n'));

      const reader = socket.readable.getReader();
      const writer = socket.writable.getWriter();

      (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          server.send(value);
        }
        server.close();
      })();

      server.addEventListener('message', async (e2) => {
        if (typeof e2.data === 'string') return;
        await writer.write(new Uint8Array(e2.data));
      });

      server.addEventListener('close', async () => { try { await writer.close(); } catch(e){} });

    } catch (e) {
      server.close(1011, e.message);
    }
  });

  return new Response(null, { status: 101, webSocket: client });
}

// ---------------- Helpers ----------------
function makeVlessLink({ host, id }) {
  // Link menggunakan host Worker, path menunjuk node spesifik
  const uuid = id; // placeholder; client akan menggunakan uuid yang sesuai di sisi pengguna
  // Saran: user harus mengganti UUID sesuai instruksi dari dashboard
  const q = new URLSearchParams({ type: 'ws', security: 'tls', path: `/vless/${id}`, sni: host, host }).toString();
  // NOTE: uuid placeholder di sini; sebenarnya client harus memasukkan UUID yang sesuai untuk node.
  return `vless://UUID@${host}:443?${q}#${encodeURIComponent('VortexVpn-'+id)}`;
}

function makeTrojanLink({ host, id }) {
  const q = new URLSearchParams({ type: 'ws', security: 'tls', path: `/trojan/${id}`, sni: host, host }).toString();
  // PSK juga tidak ditampilkan di link ini; anda bisa mengubah format agar menyertakan PSK jika ingin
  return `trojan://PSK@${host}:443?${q}#${encodeURIComponent('VortexVpn-'+id)}`;
}

async function connectToBackend(host, port, CONF) {
  // Coba resolve via DoH jika host bukan IP
  let target = host;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.includes(':')) {
    try { const ip = await dohResolveA(host, CONF.DO H_URL || CONF.DO H_URL); if (ip) target = ip; } catch(e){}
  }
  // Menggunakan API connect() (Workers TCP sockets)
  // @ts-ignore - environment yang mendukung harus menyediakan connect()
  return await connect({ hostname: target, port });
}

async function dohResolveA(name, dohUrl) {
  const r = await fetch(dohUrl + '?name=' + encodeURIComponent(name) + '&type=A');
  if (!r.ok) return null;
  const j = await r.json();
  if (j.Answer && j.Answer.length) return j.Answer[0].data;
  if (j.Answers && j.Answers.length) return j.Answers[0].data; // beberapa implementasi
  return null;
}

function uuidEqual(bytes16, uuidStr) {
  const hex = [...bytes16].map(b=>b.toString(16).padStart(2,'0')).join('');
  const canon = uuidStr.replace(/-/g,'').toLowerCase();
  return hex === canon;
}

function escapeHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
