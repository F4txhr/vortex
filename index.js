// @ts-ignore
import { connect } from 'cloudflare:sockets';

let rpoyxPI = "";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");

      if (upgradeHeader === "websocket") {
        const proxyMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/);

        if (proxyMatch) {
          rpoyxPI = proxyMatch[1];
          return await wesbokerPeler(request, env);
        }
      }
      return fetch(request);
    } catch (err) {
      return new Response(`An error occurred: ${err.toString()}`, {
        status: 500,
      });
    }
  },
};

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

async function wesbokerPeler(request, env) {
	const DNS_SERVER_ADDRESS = env.DNS_SERVER_ADDRESS || "1.1.1.1";
	const DNS_SERVER_PORT = 53;
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);

    webSocket.accept();

    let addressLog = "";
    let portLog = "";
    const log = (info, event) => {
        console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
    };
    const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";

    const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

    let remoteSocketWrapper = { value: null };
    let isDNS = false;

    readableWebSocketStream
        .pipeTo(new WritableStream({
            async write(chunk, controller) {
                if (isDNS) {
                    return handleUDPOutbound(DNS_SERVER_ADDRESS, DNS_SERVER_PORT, chunk, webSocket, null, log);
                }
                if (remoteSocketWrapper.value) {
                    const writer = remoteSocketWrapper.value.writable.getWriter();
                    await writer.write(chunk);
                    writer.releaseLock();
                    return;
                }

                const protocol = await protocolSniffer(chunk);
                let protocolHeader;

                if (protocol === "Alpha") {
                    protocolHeader = parseNarutoHeader(chunk);
                } else if (protocol === "BETA") {
                    protocolHeader = parseVolosHeader(chunk);
                } else if (protocol === "Gama") {
                    protocolHeader = parseSodokHeader(chunk);
                } else {
                    parseVmessHeader(chunk);
                    throw new Error("Unknown Protocol!");
                }

                addressLog = protocolHeader.addressRemote;
                portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`;

                if (protocolHeader.hasError) {
                    throw new Error(protocolHeader.message);
                }

                if (protocolHeader.isUDP) {
                    if (protocolHeader.portRemote === 53) {
                        isDNS = true;
                    } else {
                        throw new Error("UDP only support for DNS port 53");
                    }
                }

                if (isDNS) {
                    return handleUDPOutbound(
                        DNS_SERVER_ADDRESS,
                        DNS_SERVER_PORT,
                        chunk,
                        webSocket,
                        protocolHeader.version,
                        log
                    );
                }

                handleTCPOutBound(
                    remoteSocketWrapper,
                    protocolHeader.addressRemote,
                    protocolHeader.portRemote,
                    protocolHeader.rawClientData,
                    webSocket,
                    protocolHeader.version,
                    log
                );
            },

            close() {
                log(`readableWebSocketStream is close`);
            },

            abort(reason) {
                log(`readableWebSocketStream is abort`, JSON.stringify(reason));
            },
        }))
        .catch((err) => {
            log("readableWebSocketStream pipeTo error", err);
        });

    return new Response(null, {
        status: 101,
        webSocket: client,
    });
}

async function protocolSniffer(buffer) {
    if (buffer.byteLength >= 62) {
        const trojanDelimiter = new Uint8Array(buffer.slice(56, 60));
        if (trojanDelimiter[0] === 0x0d && trojanDelimiter[1] === 0x0a) {
            if (trojanDelimiter[2] === 0x01 || trojanDelimiter[2] === 0x03 || trojanDelimiter[2] === 0x7f) {
                if (trojanDelimiter[3] === 0x01 || trojanDelimiter[3] === 0x03 || trojanDelimiter[3] === 0x04) {
                    return "Alpha";
                }
            }
        }
    }

    const vlessDelimiter = new Uint8Array(buffer.slice(1, 17));
    if (arrayBufferToHex(vlessDelimiter).match(/^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i)) {
        return "BETA";
    }

    return "GAMA"; // Default
}

async function handleTCPOutBound(remoteSocket, addressRemote, portRemote, rawClientData, webSocket, responseHeader, log) {
    async function connectAndWrite(address, port) {
        const tcpSocket = connect({ hostname: address, port: port });
        remoteSocket.value = tcpSocket;
        log(`connected to ${address}:${port}`);
        const writer = tcpSocket.writable.getWriter();
        await writer.write(rawClientData);
        writer.releaseLock();

        return tcpSocket;
    }

    async function retry() {
        const tcpSocket = await connectAndWrite(
            rpoyxPI.split(/[:=-]/)[0] || addressRemote,
            rpoyxPI.split(/[:=-]/)[1] || portRemote
        );
        tcpSocket.closed
            .catch((error) => {
                console.log("retry tcpSocket closed error", error);
            })
            .finally(() => {
                safeCloseWebSocket(webSocket);
            });
        remoteSocketToWS(tcpSocket, webSocket, responseHeader, null, log);
    }

    const tcpSocket = await connectAndWrite(addressRemote, portRemote);
    remoteSocketToWS(tcpSocket, webSocket, responseHeader, retry, log);
}

async function handleUDPOutbound(targetAddress, targetPort, udpChunk, webSocket, responseHeader, log) {
    try {
        let protocolHeader = responseHeader;
        const tcpSocket = connect({ hostname: targetAddress, port: targetPort });

        log(`Connected to ${targetAddress}:${targetPort}`);

        const writer = tcpSocket.writable.getWriter();
        await writer.write(udpChunk);
        writer.releaseLock();

        await tcpSocket.readable.pipeTo(new WritableStream({
            async write(chunk) {
                if (webSocket.readyState === WS_READY_STATE_OPEN) {
                    if (protocolHeader) {
                        webSocket.send(await new Blob([protocolHeader, chunk]).arrayBuffer());
                        protocolHeader = null;
                    } else {
                        webSocket.send(chunk);
                    }
                }
            },
            close() {
                log(`UDP connection to ${targetAddress} closed`);
            },
            abort(reason) {
                console.error(`UDP connection to ${targetPort} aborted due to ${reason}`);
            },
        }));
    } catch (e) {
        console.error(`Error while handling UDP outbound, error ${e.message}`);
    }
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
    let readableStreamCancel = false;
    const stream = new ReadableStream({
        start(controller) {
            webSocketServer.addEventListener("message", (event) => {
                if (readableStreamCancel) {
                    return;
                }
                const message = event.data;
                controller.enqueue(message);
            });
            webSocketServer.addEventListener("close", () => {
                safeCloseWebSocket(webSocketServer);
                if (readableStreamCancel) {
                    return;
                }
                controller.close();
            });
            webSocketServer.addEventListener("error", (err) => {
                log("webSocketServer has error");
                controller.error(err);
            });
            const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
            if (error) {
                controller.error(error);
            } else if (earlyData) {
                controller.enqueue(earlyData);
            }
        },

        pull(controller) {},

        cancel(reason) {
            if (readableStreamCancel) {
                return;
            }
            log(`ReadableStream was canceled, due to ${reason}`);
            readableStreamCancel = true;
            safeCloseWebSocket(webSocketServer);
        },
    });

    return stream;
}

function parseVmessHeader(vmessBuffer) {
    // https://xtls.github.io/development/protocols/vmess.html#%E6%8C%87%E4%BB%A4%E9%83%A8%E5%88%86
}

function parseSodokHeader(ssBuffer) {
    const view = new DataView(ssBuffer);
    const addressType = view.getUint8(0);

    let addressLength = 0;
    let addressValueIndex = 1;
    let addressValue = "";

    switch (addressType) {
        case 1:
            addressLength = 4;
            addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
            break;
        case 3:
            addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
            addressValueIndex += 1;
            addressValue = new TextDecoder().decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            break;
        case 4:
            addressLength = 16;
            const dataView = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            const ipv6 = [];
            for (let i = 0; i < 8; i++) {
                ipv6.push(dataView.getUint16(i * 2).toString(16));
            }
            addressValue = ipv6.join(":");
            break;
        default:
            return { hasError: true, message: `Invalid addressType for Shadowsocks: ${addressType}` };
    }

    if (!addressValue) {
        return { hasError: true, message: `Destination address empty, address type is: ${addressType}` };
    }

    const portIndex = addressValueIndex + addressLength;
    const portBuffer = ssBuffer.slice(portIndex, portIndex + 2);
    const portRemote = new DataView(portBuffer).getUint16(0);
    return {
        hasError: false,
        addressRemote: addressValue,
        addressType: addressType,
        portRemote: portRemote,
        rawDataIndex: portIndex + 2,
        rawClientData: ssBuffer.slice(portIndex + 2),
        version: null,
        isUDP: portRemote == 53,
    };
}

function parseVolosHeader(vlessBuffer) {
    const version = new Uint8Array(vlessBuffer.slice(0, 1));
    let isUDP = false;

    const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
    const cmd = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
    if (cmd === 1) {
    } else if (cmd === 2) {
        isUDP = true;
    } else {
        return { hasError: true, message: `command ${cmd} is not support, command 01-tcp,02-udp,03-mux` };
    }
    const portIndex = 18 + optLength + 1;
    const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
    const portRemote = new DataView(portBuffer).getUint16(0);

    let addressIndex = portIndex + 2;
    const addressBuffer = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1));

    const addressType = addressBuffer[0];
    let addressLength = 0;
    let addressValueIndex = addressIndex + 1;
    let addressValue = "";
    switch (addressType) {
        case 1: // For IPv4
            addressLength = 4;
            addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
            break;
        case 2: // For Domain
            addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
            addressValueIndex += 1;
            addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            break;
        case 3: // For IPv6
            addressLength = 16;
            const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            const ipv6 = [];
            for (let i = 0; i < 8; i++) {
                ipv6.push(dataView.getUint16(i * 2).toString(16));
            }
            addressValue = ipv6.join(":");
            break;
        default:
            return { hasError: true, message: `invalid addressType is ${addressType}` };
    }
    if (!addressValue) {
        return { hasError: true, message: `addressValue is empty, addressType is ${addressType}` };
    }

    return {
        hasError: false,
        addressRemote: addressValue,
        addressType: addressType,
        portRemote: portRemote,
        rawDataIndex: addressValueIndex + addressLength,
        rawClientData: vlessBuffer.slice(addressValueIndex + addressLength),
        version: new Uint8Array([version[0], 0]),
        isUDP: isUDP,
    };
}

function parseNarutoHeader(buffer) {
    const socks5DataBuffer = buffer.slice(58);
    if (socks5DataBuffer.byteLength < 6) {
        return { hasError: true, message: "invalid SOCKS5 request data" };
    }

    let isUDP = false;
    const view = new DataView(socks5DataBuffer);
    const cmd = view.getUint8(0);
    if (cmd == 3) {
        isUDP = true;
    } else if (cmd != 1) {
        throw new Error("Unsupported command type!");
    }

    let addressType = view.getUint8(1);
    let addressLength = 0;
    let addressValueIndex = 2;
    let addressValue = "";
    switch (addressType) {
        case 1: // For IPv4
            addressLength = 4;
            addressValue = new Uint8Array(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
            break;
        case 3: // For Domain
            addressLength = new Uint8Array(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
            addressValueIndex += 1;
            addressValue = new TextDecoder().decode(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            break;
        case 4: // For IPv6
            addressLength = 16;
            const dataView = new DataView(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
            const ipv6 = [];
            for (let i = 0; i < 8; i++) {
                ipv6.push(dataView.getUint16(i * 2).toString(16));
            }
            addressValue = ipv6.join(":");
            break;
        default:
            return { hasError: true, message: `invalid addressType is ${addressType}` };
    }

    if (!addressValue) {
        return { hasError: true, message: `address is empty, addressType is ${addressType}` };
    }

    const portIndex = addressValueIndex + addressLength;
    const portBuffer = socks5DataBuffer.slice(portIndex, portIndex + 2);
    const portRemote = new DataView(portBuffer).getUint16(0);
    return {
        hasError: false,
        addressRemote: addressValue,
        addressType: addressType,
        portRemote: portRemote,
        rawDataIndex: portIndex + 4,
        rawClientData: socks5DataBuffer.slice(portIndex + 4),
        version: null,
        isUDP: isUDP,
    };
}

function base64ToArrayBuffer(base64Str) {
    if (!base64Str) {
        return { error: null };
    }
    try {
        base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
        const decode = atob(base64Str);
        const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
        return { earlyData: arryBuffer.buffer, error: null };
    } catch (error) {
        return { error };
    }
}

function arrayBufferToHex(buffer) {
    return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}


function shuffleArray(array) {
    let currentIndex = array.length;

    while (currentIndex != 0) {
        let randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
}

async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log) {
    let header = responseHeader;
    let hasIncomingData = false;
    await remoteSocket.readable
        .pipeTo(new WritableStream({
            start() {},
            async write(chunk, controller) {
                hasIncomingData = true;
                if (webSocket.readyState !== WS_READY_STATE_OPEN) {
                    controller.error("webSocket.readyState is not open, maybe close");
                }
                if (header) {
                    webSocket.send(await new Blob([header, chunk]).arrayBuffer());
                    header = null;
                } else {
                    webSocket.send(chunk);
                }
            },
            close() {
                log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`);
            },
            abort(reason) {
                console.error(`remoteConnection!.readable abort`, reason);
            },
        }))
        .catch((error) => {
            console.error(`remoteSocketToWS has exception `, error.stack || error);
            safeCloseWebSocket(webSocket);
        });
    if (hasIncomingData === false && retry) {
        log(`retry`);
        retry();
    }
}

function safeCloseWebSocket(socket) {
    try {
        if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
            socket.close();
        }
    } catch (error) {
        console.error("safeCloseWebSocket error", error);
    }
}
