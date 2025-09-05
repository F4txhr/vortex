// User-configurable variables
// These should be changed to match your setup.
export const rootDomain = "workers.dev"; // Your root domain for the worker
export const serviceName = "vortex"; // The name of your worker service
export const apiKey = "91635e325f2ff0c5cf163ee39d25cedd68d67"; // Your Global API key
export const apiEmail = "cf.paid1@novan.email"; // Your Cloudflare account email
export const accountID = ""; // Your Cloudflare Account ID
export const zoneID = ""; // The Zone ID of the domain

// Application constants
export const APP_DOMAIN = `${serviceName}.${rootDomain}`;
export const PORTS = [443, 80];
export const PROTOCOLS = ["trojan", "vless", "ss"]; // Using direct strings for clarity

// External resource URLs
export const KV_PROXY_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/kvProxyList.json";
export const PROXY_BANK_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt";
export const DNS_SERVER_ADDRESS = "8.8.8.8";
export const DNS_SERVER_PORT = 53;
export const PROXY_HEALTH_CHECK_API = "https://id1.foolvpn.me/api/v1/check";
export const CONVERTER_URL = "https://api.foolvpn.me/convert";
export const DONATE_LINK = "https://trakteer.id/dickymuliafiqri/tip";
export const BAD_WORDS_LIST =
  "https://gist.githubusercontent.com/adierebel/a69396d79b787b84d89b45002cb37cd6/raw/6df5f8728b18699496ad588b3953931078ab9cf1/kata-kasar.txt";

// UI and other constants
export const PROXY_PER_PAGE = 24;
export const WS_READY_STATE_OPEN = 1;
export const WS_READY_STATE_CLOSING = 2;
export const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};
