import { connect } from "cloudflare:sockets";

// =================================
// Configuration & State
// =================================
const PROXY_BANK_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt";
const MAX_LOG_ENTRIES = 20;
let logEvents = ["[" + new Date().toISOString() + "] Worker started."];

function addLog(message) {
	const timestamp = new Date().toISOString();
	logEvents.push(`[${timestamp}] ${message}`);
	if (logEvents.length > MAX_LOG_ENTRIES) {
		logEvents.shift(); // Keep the log size manageable
	}
	console.log(message); // Also log to the standard console
}

// =================================
// Main Fetch Handler
// =================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get("Upgrade");

    // Handle WebSocket relay requests
    if (upgradeHeader === "websocket") {
      const proxyMatch = url.pathname.match(/^\/([\w.-]+)-(\d+)$/);
      if (proxyMatch) {
        const destination = {
          address: proxyMatch[1],
          port: parseInt(proxyMatch[2]),
        };
        return websocketHandler(request, destination);
      }
      return websocketHandler(request, null);
    }

    // Handle HTTP GET requests
    if (url.pathname === "/") {
      return generateSubscriptionPage(request);
    }

    if (url.pathname === "/log") {
      return new Response(logEvents.join('\n'), {
        headers: { "Content-Type": "text/plain;charset=utf-8" },
      });
    }

    return new Response("Not found.", { status: 404 });
  }
};

// =================================
// HTML Page Generation
// =================================
async function generateSubscriptionPage(request) {
    const proxyList = await getProxyList();
    const workerHost = request.headers.get("host");

    if (!proxyList || !proxyList.length) {
        return new Response("<h1>Could not fetch proxy list.</h1>", {
            status: 500,
            headers: { "Content-Type": "text/html;charset=utf-8" },
        });
    }

    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Proxy Relay Configurations</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; background-color: #f8f9fa; color: #212529; margin: 0; }
        .container { max-width: 900px; margin: 20px auto; padding: 20px; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.05); }
        h1 { color: #0056b3; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px 15px; border: 1px solid #dee2e6; text-align: left; }
        th { background-color: #e9ecef; }
        tr:nth-child(even) { background-color: #f8f9fa; }
        code { display: block; background-color: #e9ecef; padding: 8px; border-radius: 4px; white-space: pre-wrap; word-break: break-all; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace; font-size: 0.875em; }
        .proxy-info { font-size: 0.9em; }
        strong { color: #343a40; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Proxy Relay Configurations</h1>
        <p>Worker Host: <strong>${workerHost}</strong></p>
        <table>
            <thead>
                <tr>
                    <th>Proxy Info</th>
                    <th>Configuration Links</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const proxy of proxyList) {
        const configs = generateConfigLinks(proxy, workerHost);
        html += `
                <tr>
                    <td class="proxy-info">
                        <strong>IP:</strong> ${proxy.ip}<br>
                        <strong>Port:</strong> ${proxy.port}<br>
                        <strong>Country:</strong> ${proxy.country || 'N/A'}<br>
                        <strong>Org:</strong> ${proxy.org || 'N/A'}
                    </td>
                    <td>
                        <p><strong>VLESS:</strong></p>
                        <code>${configs.vless}</code>
                        <p><strong>Trojan:</strong></p>
                        <code>${configs.trojan}</code>
                        <p><strong>Shadowsocks:</strong></p>
                        <code>${configs.shadowsocks}</code>
                    </td>
                </tr>
        `;
    }

    html += `
            </tbody>
        </table>
    </div>
</body>
</html>
    `;

    return new Response(html, {
        headers: { "Content-Type": "text/html;charset=utf-8" },
    });
}

// =================================
// Proxy List Fetching
// =================================
async function getProxyList() {
    try {
        const response = await fetch(PROXY_BANK_URL);
        if (!response.ok) {
            console.error(`Failed to fetch proxy list: ${response.status} ${response.statusText}`);
            return [];
        }
        const text = await response.text();
        const lines = text.split('\n').filter(line => line.trim() !== '');

        return lines.map(line => {
            const [ip, port, country, org] = line.split(',');
            return { ip, port, country, org };
        });
    } catch (error) {
        console.error("Error fetching or parsing proxy list:", error);
        return [];
    }
}

// =================================
// Configuration Link Generation
// =================================
function generateConfigLinks(proxy, workerHost) {
    const configs = {};
    const { ip, port, org, country } = proxy;

    // The path that encodes the destination, e.g., /1.2.3.4-8080
    const encodedPath = `/${ip}-${port}`;
    const commonRemark = `${country || ''} ${org || ''}`.trim();

    // VLESS Configuration
    const vlessURL = new URL(`vless://${crypto.randomUUID()}@${workerHost}:443`);
    vlessURL.searchParams.set('encryption', 'none');
    vlessURL.searchParams.set('security', 'tls');
    vlessURL.searchParams.set('sni', workerHost);
    vlessURL.searchParams.set('type', 'ws');
    vlessURL.searchParams.set('host', workerHost);
    vlessURL.searchParams.set('path', encodedPath);
    vlessURL.hash = encodeURIComponent(`VLESS - ${commonRemark}`);
    configs.vless = vlessURL.toString();

    // Trojan Configuration
    const trojanURL = new URL(`trojan://${crypto.randomUUID()}@${workerHost}:443`);
    trojanURL.searchParams.set('security', 'tls');
    trojanURL.searchParams.set('sni', workerHost);
    trojanURL.searchParams.set('type', 'ws');
    trojanURL.searchParams.set('host', workerHost);
    trojanURL.searchParams.set('path', encodedPath);
    trojanURL.hash = encodeURIComponent(`Trojan - ${commonRemark}`);
    configs.trojan = trojanURL.toString();

    // Shadowsocks Configuration (using v2ray-plugin)
    const ssUserPass = btoa(`aes-128-gcm:${crypto.randomUUID()}`);
    const ssURL = new URL(`ss://${ssUserPass}@${workerHost}:443`);
    const ssPlugin = `v2ray-plugin;tls;host=${workerHost};path=${encodedPath}`;
    ssURL.searchParams.set('plugin', ssPlugin);
    ssURL.hash = encodeURIComponent(`Shadowsocks - ${commonRemark}`);
    configs.shadowsocks = ssURL.toString();

    return configs;
}

// =================================
// WebSocket Handler
// =================================
async function websocketHandler(request, pathDestination) {
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();
  addLog(`Accepted WebSocket connection.`);

  // Pass the server-side socket and the path-derived destination to the stream handler.
  handleWebSocketStream(server, pathDestination);

  // Return the client-side socket to the browser to establish the connection.
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

// =================================
// Stream and Protocol Logic
// =================================
function handleWebSocketStream(server, pathDestination) {
	let remoteSocket = null;
	let remoteSocketWriter = null;
	let connectionEstablished = false;

	server.addEventListener('message', async (event) => {
		if (connectionEstablished) {
			if (remoteSocketWriter) {
				await remoteSocketWriter.write(event.data);
			}
			return;
		}

		addLog(`Received first message from client. Size: ${event.data.byteLength}`);
		connectionEstablished = true;

		const { destination: headerDestination, remainingData, error, protocol } = parseRequestHeader(event.data);

		if (error) {
			addLog(`ERROR: Failed to parse request header: ${error}`);
			server.close(1002, error);
			return;
		}

		const finalDestination = pathDestination || headerDestination;

		if (!finalDestination) {
			addLog(`ERROR: No destination specified in path or header.`);
			server.close(1002, "Destination not specified.");
			return;
		}

		addLog(`Protocol: ${protocol}. Destination: ${finalDestination.address}:${finalDestination.port}`);

		const connectionResult = await handleTCPOutbound(finalDestination, server);

		if (!connectionResult) {
			return;
		}

		remoteSocket = connectionResult.socket;
		remoteSocketWriter = connectionResult.writer;

		if (remainingData && remainingData.byteLength > 0) {
			await remoteSocketWriter.write(remainingData);
		}
	});

	server.addEventListener('close', (event) => {
		addLog(`Client WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
		if (remoteSocket) {
			remoteSocket.close();
		}
	});

	server.addEventListener('error', (error) => {
		addLog(`WebSocket error: ${error.message}`);
		if (remoteSocket) {
			remoteSocket.close();
		}
	});

	addLog('Added WebSocket event listeners.');
}

// =================================
// Protocol Parsers
// =================================

/**
 * A unified function to sniff and parse the protocol header from the client.
 * @param {ArrayBuffer} chunk The first data chunk from the client.
 * @returns {object} An object containing destination, remainingData, and error.
 */
function parseRequestHeader(chunk) {
  const dataView = new DataView(chunk);

  // The order of these checks is important. VLESS and Trojan have more
  // specific and longer signatures than Shadowsocks. Shadowsocks is the most
  // generic and should be checked last to avoid false positives.

  // VLESS check
  if (chunk.byteLength > 17) {
    const vlessResult = parseVlessHeader(chunk);
    if (!vlessResult.error) {
        return { ...vlessResult, protocol: 'VLESS' };
    }
  }

  // Trojan check
  if (chunk.byteLength > 58) {
      const trojanResult = parseTrojanHeader(chunk);
      if (!trojanResult.error) {
          return { ...trojanResult, protocol: 'Trojan' };
      }
  }

  // Shadowsocks check
  if (chunk.byteLength > 4) {
    const ssResult = parseShadowsocksHeader(chunk);
    if (!ssResult.error) {
      return { ...ssResult, protocol: 'Shadowsocks' };
    }
  }

  return { error: "Could not determine protocol." };
}

/**
 * Parses a VLESS protocol header.
 * @param {ArrayBuffer} buffer The client's initial data packet.
 * @returns {object} Destination info or an error.
 */
function parseVlessHeader(buffer) {
    try {
        const dataView = new DataView(buffer);
        // const version = dataView.getUint8(0); // Typically 0
        // const uuid = buffer.slice(1, 17); // 16-byte UUID

        // Add-ons length
        const addOnLength = dataView.getUint8(17);
        let offset = 18 + addOnLength;

        // Command (1 = TCP, 2 = UDP)
        const command = dataView.getUint8(offset);
        if (command !== 1) return { error: "Only TCP connections are supported." };
        offset += 1;

        const port = dataView.getUint16(offset);
        offset += 2;

        const addressType = dataView.getUint8(offset);
        offset += 1;

        let address = '';
        let addressLength = 0;

        switch (addressType) {
            case 1: // IPv4
                addressLength = 4;
                address = new Uint8Array(buffer.slice(offset, offset + addressLength)).join('.');
                break;
            case 2: // Domain
                addressLength = dataView.getUint8(offset);
                offset += 1;
                address = new TextDecoder().decode(buffer.slice(offset, offset + addressLength));
                break;
            case 3: // IPv6
                addressLength = 16;
                const ipv6 = [];
                for (let i = 0; i < 8; i++) {
                    ipv6.push(dataView.getUint16(offset + i * 2).toString(16));
                }
                address = ipv6.join(':');
                break;
            default:
                return { error: `Invalid VLESS address type: ${addressType}` };
        }

        offset += addressLength;

        return {
            destination: { address, port },
            remainingData: buffer.slice(offset)
        };
    } catch (err) {
        return { error: `VLESS parsing failed: ${err.message}` };
    }
}

/**
 * Parses a Trojan protocol header.
 * @param {ArrayBuffer} buffer The client's initial data packet.
 * @returns {object} Destination info or an error.
 */
function parseTrojanHeader(buffer) {
    try {
        const dataView = new DataView(buffer);
        // Trojan request format:
        // 56 bytes hex password + CRLF (\r\n) + SOCKS5-like request
        const passwordHex = new TextDecoder().decode(buffer.slice(0, 56));
        const crlf = new TextDecoder().decode(buffer.slice(56, 58));
        if (crlf !== '\r\n') return { error: "Invalid Trojan header (CRLF not found)." };

        let offset = 58;
        const command = dataView.getUint8(offset); // 1 = TCP, 3 = UDP
        if (command !== 1) return { error: "Only TCP connections are supported." };
        offset += 1;

        const addressType = dataView.getUint8(offset);
        offset += 1;

        let address = '';
        let addressLength = 0;

        switch (addressType) {
            case 1: // IPv4
                addressLength = 4;
                address = new Uint8Array(buffer.slice(offset, offset + addressLength)).join('.');
                break;
            case 3: // Domain
                addressLength = dataView.getUint8(offset);
                offset += 1;
                address = new TextDecoder().decode(buffer.slice(offset, offset + addressLength));
                break;
            case 4: // IPv6
                addressLength = 16;
                const ipv6 = [];
                for (let i = 0; i < 8; i++) {
                    ipv6.push(dataView.getUint16(offset + i * 2).toString(16));
                }
                address = ipv6.join(':');
                break;
            default:
                return { error: `Invalid Trojan address type: ${addressType}` };
        }

        offset += addressLength;
        const port = dataView.getUint16(offset);
        offset += 2;

        // There might be another CRLF at the end of the header
        // For simplicity, we assume the rest is payload
        offset += 2; // Skipping final CRLF

        return {
            destination: { address, port },
            remainingData: buffer.slice(offset)
        };
    } catch (err) {
        return { error: `Trojan parsing failed: ${err.message}` };
    }
}

/**
 * Parses a Shadowsocks protocol header.
 * @param {ArrayBuffer} buffer The client's initial data packet.
 * @returns {object} Destination info or an error.
 */
function parseShadowsocksHeader(buffer) {
    try {
        const dataView = new DataView(buffer);
        let offset = 0;
        const addressType = dataView.getUint8(offset);
        offset += 1;

        let address = '';
        let addressLength = 0;

        switch (addressType) {
            case 1: // IPv4
                addressLength = 4;
                address = new Uint8Array(buffer.slice(offset, offset + addressLength)).join('.');
                break;
            case 3: // Domain
                addressLength = dataView.getUint8(offset);
                offset += 1;
                address = new TextDecoder().decode(buffer.slice(offset, offset + addressLength));
                break;
            case 4: // IPv6
                addressLength = 16;
                const ipv6 = [];
                for (let i = 0; i < 8; i++) {
                    ipv6.push(dataView.getUint16(offset + i * 2).toString(16));
                }
                address = ipv6.join(':');
                break;
            default:
                return { error: `Invalid Shadowsocks address type: ${addressType}` };
        }

        offset += addressLength;
        const port = dataView.getUint16(offset);
        offset += 2;

        return {
            destination: { address, port },
            remainingData: buffer.slice(offset)
        };
    } catch (err) {
        return { error: `Shadowsocks parsing failed: ${err.message}` };
    }
}

function parseVmessHeader(chunk) {
  // TODO: Implement VMess header parsing
  return { error: 'VMess protocol is not yet supported.' };
}

// =================================
// TCP Outbound Logic
// =================================
/**
 * Establishes a TCP connection to the destination and relays data.
 * @param {object} destination The destination address and port.
 * @param {WebSocket} clientSocket The server-side WebSocket from the client.
 * @returns {object|null} An object with the remote socket and its writer, or null on failure.
 */
async function handleTCPOutbound(destination, clientSocket) {
  try {
    const remoteSocket = connect({
      hostname: destination.address,
      port: destination.port,
    });

    addLog(`Successfully connected to destination: ${destination.address}:${destination.port}`);

    remoteSocket.readable.pipeTo(new WritableStream({
      async write(chunk) {
        if (clientSocket.readyState === 1) {
          clientSocket.send(chunk);
        }
      },
      close() {
        addLog("Remote TCP socket readable stream closed.");
      },
      abort(reason) {
        addLog(`Remote TCP socket readable stream aborted: ${reason}`);
      },
    })).catch(err => {
      addLog(`Error piping remote readable to client writable: ${err.message}`);
    });

    return {
      writer: remoteSocket.writable.getWriter(),
      socket: remoteSocket,
    };

  } catch (error) {
    const errorMessage = `Failed to connect to ${destination.address}:${destination.port}: ${error.message}`;
    addLog(`ERROR: ${errorMessage}`);

    if (clientSocket.readyState === 1) {
        clientSocket.send(errorMessage);
    }

    clientSocket.close(1011, `Connection failed.`);
    return null;
  }
}
