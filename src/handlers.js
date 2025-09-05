import { connect } from "cloudflare:sockets";
import {
  rootDomain, serviceName, apiKey, apiEmail, accountID, zoneID,
  APP_DOMAIN, PORTS, PROTOCOLS, KV_PROXY_URL, PROXY_BANK_URL,
  DNS_SERVER_ADDRESS, DNS_SERVER_PORT, PROXY_HEALTH_CHECK_API,
  CONVERTER_URL, DONATE_LINK, BAD_WORDS_LIST, PROXY_PER_PAGE,
  WS_READY_STATE_OPEN, CORS_HEADER_OPTIONS
} from './config.js';
import { PageBuilder } from './html.js';
import { protocolSniffer, parseNajortHeader, parseSselvHeader, parseSsHeader } from './parsers.js';
import { getFlagEmoji, reverse, base64ToArrayBuffer, shuffleArray } from './utils.js';

// Note: This maintains the stateful nature of the original script.
// A more advanced refactor might manage state differently.
let proxyIP = "";
let cachedProxyList = [];

export async function getKVProxyList(kvProxyUrl = KV_PROXY_URL) {
  if (!kvProxyUrl) {
    throw new Error("No KV Proxy URL Provided!");
  }
  const kvProxy = await fetch(kvProxyUrl);
  return kvProxy.status === 200 ? await kvProxy.json() : {};
}

export async function getProxyList(proxyBankUrl = PROXY_BANK_URL) {
  if (!proxyBankUrl) {
    throw new Error("No Proxy Bank URL Provided!");
  }
  const proxyBank = await fetch(proxyBankUrl);
  if (proxyBank.status === 200) {
    const text = (await proxyBank.text()) || "";
    const proxyString = text.split("\n").filter(Boolean);
    cachedProxyList = proxyString.map((entry) => {
      const [proxyIP, proxyPort, country, org] = entry.split(",");
      return { proxyIP: proxyIP || "Unknown", proxyPort: proxyPort || "Unknown", country: country || "Unknown", org: org || "Unknown Org" };
    }).filter(Boolean);
  }
  return cachedProxyList;
}

export async function reverseProxy(request, target, targetPath) {
  const targetUrl = new URL(request.url);
  const targetChunk = target.split(":");
  targetUrl.hostname = targetChunk[0];
  targetUrl.port = targetChunk[1]?.toString() || "443";
  targetUrl.pathname = targetPath || targetUrl.pathname;

  const modifiedRequest = new Request(targetUrl, request);
  modifiedRequest.headers.set("X-Forwarded-Host", request.headers.get("Host"));

  const response = await fetch(modifiedRequest);
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(CORS_HEADER_OPTIONS)) {
    newResponse.headers.set(key, value);
  }
  newResponse.headers.set("X-Proxied-By", "Cloudflare Worker");
  return newResponse;
}

export function getAllConfig(request, hostName, proxyList, page = 0, isApiReady) {
  const startIndex = PROXY_PER_PAGE * page;
  try {
    const uuid = crypto.randomUUID();
    const uri = new URL(`trojan://${hostName}`); // Start with trojan
    uri.searchParams.set("encryption", "none");
    uri.searchParams.set("type", "ws");
    uri.searchParams.set("host", hostName);

    const document = new PageBuilder(request, cachedProxyList);
    document.setTitle("Welcome to <span class='text-blue-500 font-semibold'>Badak Terbang Proxy</span>");
    document.addInfo(`Total: ${proxyList.length}`);
    document.addInfo(`Page: ${page}/${Math.floor(proxyList.length / PROXY_PER_PAGE)}`);

    for (let i = startIndex; i < startIndex + PROXY_PER_PAGE; i++) {
      const proxy = proxyList[i];
      if (!proxy) break;

      const { proxyIP, proxyPort, country, org } = proxy;
      uri.searchParams.set("path", `/${proxyIP}-${proxyPort}`);

      const proxies = [];
      for (const port of PORTS) {
        uri.port = port.toString();
        uri.hash = `${i + 1} ${getFlagEmoji(country)} ${org} WS ${port === 443 ? "TLS" : "NTLS"} [${serviceName}]`;
        for (const protocol of PROTOCOLS) {
          uri.protocol = `${protocol}://`;
          if (protocol === "ss") {
            uri.username = btoa(`none:${uuid}`);
            uri.searchParams.set("plugin", `v2ray-plugin;${port === 80 ? "" : "tls;"}mux=0;mode=websocket;path=/${proxyIP}-${proxyPort};host=${hostName}`);
          } else {
            uri.username = uuid;
            uri.searchParams.delete("plugin");
          }
          uri.searchParams.set("security", port === 443 ? "tls" : "none");
          uri.searchParams.set("sni", port === 80 && protocol === "vless" ? "" : hostName);
          proxies.push(uri.toString());
        }
      }
      document.registerProxies({ proxyIP, proxyPort, country, org }, proxies);
    }

    document.addPageButton("Prev", `/sub/${page > 0 ? page - 1 : 0}`, page <= 0);
    document.addPageButton("Next", `/sub/${page + 1}`, page >= Math.floor(proxyList.length / PROXY_PER_PAGE));
    return document.build(isApiReady);
  } catch (error) {
    return `An error occurred while generating configurations: ${error}`;
  }
}

export async function websocketHandler(request, addLog) {
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);

    webSocket.accept();
    addLog("Accepted WebSocket connection.");

    let addressLog = "";
    let portLog = "";
    const log = (info, event) => {
        const message = `[${addressLog}:${portLog}] ${info}`;
        addLog(message);
    };
    const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";

    const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

    let remoteSocketWrapper = { value: null };
    let isDNS = false;

    readableWebSocketStream.pipeTo(
        new WritableStream({
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

                if (protocol === "trojan") {
                    protocolHeader = parseNajortHeader(chunk);
                } else if (protocol === "vless") {
                    protocolHeader = parseSselvHeader(chunk);
                } else if (protocol === "ss") {
                    protocolHeader = parseSsHeader(chunk);
                } else {
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
                    return handleUDPOutbound(DNS_SERVER_ADDRESS, DNS_SERVER_PORT, chunk, webSocket, protocolHeader.version, log);
                }

                handleTCPOutBound(remoteSocketWrapper, protocolHeader.addressRemote, protocolHeader.portRemote, protocolHeader.rawClientData, webSocket, protocolHeader.version, log);
            },
            close() { log(`readableWebSocketStream is close`); },
            abort(reason) { log(`readableWebSocketStream is abort`, JSON.stringify(reason)); },
        })
    ).catch((err) => {
        const message = `WebSocket stream error: ${err.message}`;
        addLog(`ERROR: ${message}`);
    });

    return new Response(null, { status: 101, webSocket: client });
}


async function handleTCPOutBound(remoteSocket, addressRemote, portRemote, rawClientData, webSocket, responseHeader, log) {
    async function connectAndWrite(address, port) {
        const tcpSocket = connect({ hostname: address, port: port });
        remoteSocket.value = tcpSocket;
        const message = `Successfully connected to destination: ${address}:${port}`;
        addLog(message);
        log(`connected to ${address}:${port}`); // Keep original log
        const writer = tcpSocket.writable.getWriter();
        await writer.write(rawClientData);
        writer.releaseLock();
        return tcpSocket;
    }

    async function retry() {
        const tcpSocket = await connectAndWrite(proxyIP.split(/[:=-]/)[0] || addressRemote, proxyIP.split(/[:=-]/)[1] || portRemote);
        tcpSocket.closed.catch((error) => {
            log("retry tcpSocket closed error", error);
        }).finally(() => {
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

        await tcpSocket.readable.pipeTo(
            new WritableStream({
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
                close() { log(`UDP connection to ${targetAddress} closed`); },
                abort(reason) { console.error(`UDP connection to ${targetPort} aborted due to ${reason}`); },
            })
        );
    } catch (e) {
        console.error(`Error while handling UDP outbound, error ${e.message}`);
    }
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
    let readableStreamCancel = false;
    const stream = new ReadableStream({
        start(controller) {
            webSocketServer.addEventListener("message", (event) => {
                if (readableStreamCancel) return;
                controller.enqueue(event.data);
            });
            webSocketServer.addEventListener("close", () => {
                safeCloseWebSocket(webSocketServer);
                if (readableStreamCancel) return;
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
            if (readableStreamCancel) return;
            log(`ReadableStream was canceled, due to ${reason}`);
            readableStreamCancel = true;
            safeCloseWebSocket(webSocketServer);
        },
    });
    return stream;
}


async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log) {
    let header = responseHeader;
    let hasIncomingData = false;
    await remoteSocket.readable.pipeTo(
        new WritableStream({
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
            close() { log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`); },
            abort(reason) { console.error(`remoteConnection!.readable abort`, reason); },
        })
    ).catch((error) => {
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
        if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === 2) { // 2 is CLOSING
            socket.close();
        }
    } catch (error) {
        console.error("safeCloseWebSocket error", error);
    }
}

export async function checkProxyHealth(proxyIP, proxyPort) {
    const req = await fetch(`${PROXY_HEALTH_CHECK_API}?ip=${proxyIP}:${proxyPort}`);
    return await req.json();
}

export class CloudflareApi {
    constructor() {
        this.bearer = `Bearer ${apiKey}`;
        this.accountID = accountID;
        this.zoneID = zoneID;
        this.apiEmail = apiEmail;
        this.apiKey = apiKey;
        this.headers = { Authorization: this.bearer, "X-Auth-Email": this.apiEmail, "X-Auth-Key": this.apiKey };
    }

    async getDomainList() {
        const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountID}/workers/domains`;
        const res = await fetch(url, { headers: { ...this.headers } });
        if (res.status == 200) {
            const respJson = await res.json();
            return respJson.result.filter((data) => data.service == serviceName).map((data) => data.hostname);
        }
        return [];
    }

    async registerDomain(domain) {
        domain = domain.toLowerCase();
        const registeredDomains = await this.getDomainList();
        if (!domain.endsWith(rootDomain)) return 400;
        if (registeredDomains.includes(domain)) return 409;
        try {
            const domainTest = await fetch(`https://${domain.replaceAll("." + APP_DOMAIN, "")}`);
            if (domainTest.status == 530) return domainTest.status;
            const badWordsListRes = await fetch(BAD_WORDS_LIST);
            if (badWordsListRes.status == 200) {
                const badWordsList = (await badWordsListRes.text()).split("\n");
                for (const badWord of badWordsList) {
                    if (domain.includes(badWord.toLowerCase())) return 403;
                }
            } else {
                return 403;
            }
        } catch (e) {
            return 400;
        }
        const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountID}/workers/domains`;
        const res = await fetch(url, {
            method: "PUT",
            body: JSON.stringify({ environment: "production", hostname: domain, service: serviceName, zone_id: this.zoneID }),
            headers: { ...this.headers },
        });
        return res.status;
    }
}
