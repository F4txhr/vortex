import { connect } from "cloudflare:sockets";

// =================================
// Configuration
// =================================
// For now, we keep configuration minimal.
// In a real-world scenario, these might come from environment variables.

// =================================
// Main Fetch Handler
// =================================
export default {
  async fetch(request, env, ctx) {
    // We only handle WebSocket upgrade requests.
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected a WebSocket request.", { status: 426 });
    }

    // The core logic is delegated to the websocketHandler.
    return websocketHandler(request);
  }
};

// =================================
// WebSocket Handler
// =================================
async function websocketHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  // The server-side WebSocket is the one we work with.
  server.accept();
  console.log("WebSocket connection accepted.");

  // Pass the server-side socket to the stream handler.
  handleWebSocketStream(server);

  // Return the client-side socket to the browser to establish the connection.
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

// =================================
// Stream and Protocol Logic
// =================================
function handleWebSocketStream(server) {
  let remoteSocket = null;
  let remoteSocketWriter = null;

  server.readable.pipeTo(new WritableStream({
    async write(chunk, controller) {
      // If the remote socket writer is already set up, it means we are in "relay" mode.
      if (remoteSocketWriter) {
        await remoteSocketWriter.write(chunk);
        return;
      }

      // This is the first chunk. Parse the header and establish the connection.
      const { destination, remainingData, error } = parseRequestHeader(chunk);

      if (error) {
        console.error("Failed to parse request header:", error);
        server.close(1002, error);
        return;
      }

      // Establish the TCP connection to the destination.
      const connectionResult = await handleTCPOutbound(destination, server);

      if (!connectionResult) {
        // The handleTCPOutbound function will have already closed the client socket.
        return;
      }

      remoteSocket = connectionResult.socket;
      remoteSocketWriter = connectionResult.writer;

      // If there's any data left from the first chunk after the header,
      // write it to the remote socket.
      if (remainingData && remainingData.byteLength > 0) {
        await remoteSocketWriter.write(remainingData);
      }
    },
    close() {
      console.log("Client WebSocket stream closed.");
      if (remoteSocket) {
        console.log("Closing remote TCP socket.");
        remoteSocket.close();
      }
    },
    abort(reason) {
      console.error("Client WebSocket stream aborted:", reason);
      if (remoteSocket) {
        console.log("Aborting remote TCP socket.");
        remoteSocket.abort();
      }
    },
  })).catch(err => {
    console.error("Error piping WebSocket stream:", err);
    if (remoteSocket) {
      remoteSocket.abort();
    }
  });
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

  // VLESS check: First byte is protocol version, followed by 16-byte UUID.
  if (chunk.byteLength > 17) {
    const vlessResult = parseVlessHeader(chunk);
    if (!vlessResult.error) {
        console.log("Detected VLESS protocol.");
        return vlessResult;
    }
  }

  // Trojan check: 56 bytes of hex-encoded password, CRLF, SOCKS5-like request.
  if (chunk.byteLength > 58) {
      const trojanResult = parseTrojanHeader(chunk);
      if (!trojanResult.error) {
          console.log("Detected Trojan protocol.");
          return trojanResult;
      }
  }

  // Shadowsocks check: Starts with a SOCKS5-like address type.
  if (chunk.byteLength > 4) {
    const ssResult = parseShadowsocksHeader(chunk);
    if (!ssResult.error) {
      console.log("Detected Shadowsocks protocol.");
      return ssResult;
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
    // Connect to the destination using TCP sockets API
    const remoteSocket = connect({
      hostname: destination.address,
      port: destination.port,
    });

    // Pipe data from the remote TCP socket back to the client's WebSocket
    remoteSocket.readable.pipeTo(new WritableStream({
      async write(chunk) {
        // The readyState for a WebSocket is 1 for OPEN.
        if (clientSocket.readyState === 1) {
          clientSocket.send(chunk);
        }
      },
      close() {
        console.log("Remote TCP socket readable stream closed.");
      },
      abort(reason) {
        console.error("Remote TCP socket readable stream aborted:", reason);
      },
    })).catch(err => {
      console.error("Error piping remote readable to client writable:", err.message);
    });

    // Return the writer for the remote socket's writable stream.
    // This allows the client-to-remote pipe to be set up.
    return {
      writer: remoteSocket.writable.getWriter(),
      socket: remoteSocket,
    };

  } catch (error) {
    console.error(`Connection to ${destination.address}:${destination.port} failed:`, error.message);
    clientSocket.close(1011, `Could not connect to destination.`);
    return null;
  }
}
