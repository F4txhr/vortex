import { getFlagEmoji, reverse } from './utils.js';
import { DONATE_LINK, serviceName, rootDomain } from './config.js';

// This class is a refactoring of the original Document class.
// It's responsible for building the final HTML page by replacing placeholders.
export class PageBuilder {
  constructor(request, cachedProxyList) {
    this.request = request;
    this.url = new URL(request.url);
    this.proxies = [];
    this.cachedProxyList = cachedProxyList;
    this.html = baseHTML;
  }

  setTitle(title) {
    this.html = this.html.replaceAll("PLACEHOLDER_JUDUL", title.replace("text-blue-500", "text-indigo-500"));
  }

  addInfo(text) {
    text = `<span>${text}</span>`;
    this.html = this.html.replaceAll("PLACEHOLDER_INFO", `${text}\nPLACEHOLDER_INFO`);
  }

  registerProxies(data, proxies) {
    this.proxies.push({
      ...data,
      list: proxies,
    });
  }

  buildProxyGroup() {
    let proxyGroupElement = "";
    proxyGroupElement += `<div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">`;
    for (let i = 0; i < this.proxies.length; i++) {
      const proxyData = this.proxies[i];

      proxyGroupElement += `<div class="lozad scale-95 mb-4 bg-white dark:bg-slate-800 transition-all duration-300 rounded-lg p-6 flex flex-col shadow-md hover:shadow-lg border border-slate-200 dark:border-slate-700 hover:scale-105">`;
      proxyGroupElement += `  <div id="countryFlag" class="absolute -translate-y-11 -translate-x-2 border-4 border-white dark:border-slate-800 rounded-full overflow-hidden"><img width="48" src="https://hatscripts.github.io/circle-flags/flags/${proxyData.country.toLowerCase()}.svg" /></div>`;
      proxyGroupElement += `  <div class="flex-grow">`;
      proxyGroupElement += `    <div id="ping-${i}" class="animate-pulse text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">Idle ${proxyData.proxyIP}:${proxyData.proxyPort}</div>`;
      proxyGroupElement += `  </div>`;
      proxyGroupElement += `  <div class="rounded-lg py-4 px-4 bg-slate-50 dark:bg-slate-700/50 flex-grow mt-4">`;
      proxyGroupElement += `    <h5 class="font-bold text-lg text-slate-800 dark:text-slate-100 mb-1 overflow-x-scroll scrollbar-hide text-nowrap">${proxyData.org}</h5>`;
      proxyGroupElement += `    <div class="text-slate-600 dark:text-slate-300 text-sm">`;
      proxyGroupElement += `      <p>IP: ${proxyData.proxyIP}</p>`;
      proxyGroupElement += `      <p>Port: ${proxyData.proxyPort}</p>`;
      proxyGroupElement += `      <div id="container-region-check-${i}">`;
      proxyGroupElement += `        <input id="config-sample-${i}" class="hidden" type="text" value="${proxyData.list[0]}">`;
      proxyGroupElement += `      </div>`;
      proxyGroupElement += `    </div>`;
      proxyGroupElement += `  </div>`;
      proxyGroupElement += `  <div class="flex flex-col gap-2 mt-4 text-sm">`;
      for (let x = 0; x < proxyData.list.length; x++) {
        const indexName = [
          `${reverse("trojan")} TLS`,
          `${reverse("vless")} TLS`,
          `${reverse("ss")} TLS`,
          `${reverse("trojan")} NTLS`,
          `${reverse("vless")} NTLS`,
          `${reverse("ss")} NTLS`,
        ];
        const proxy = proxyData.list[x];

        if (x % 2 == 0) {
          proxyGroupElement += `<div class="flex gap-2 justify-around w-full">`;
        }

        proxyGroupElement += `<button class="bg-indigo-500 hover:bg-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400 rounded-md p-2 w-full text-white font-semibold transition-colors duration-200" onclick="copyToClipboard('${proxy}')">${indexName[x]}</button>`;

        if (x % 2 == 1) {
          proxyGroupElement += `</div>`;
        }
      }
      proxyGroupElement += `  </div>`;
      proxyGroupElement += `</div>`;
    }
    proxyGroupElement += `</div>`;

    this.html = this.html.replaceAll("PLACEHOLDER_PROXY_GROUP", `${proxyGroupElement}`);
  }

  buildCountryFlag() {
    const proxyBankUrl = this.url.searchParams.get("proxy-list");
    const flagList = [];
    for (const proxy of this.cachedProxyList) {
      flagList.push(proxy.country);
    }

    let flagElement = "";
    for (const flag of new Set(flagList)) {
      flagElement += `<a href="/sub?cc=${flag}${
        proxyBankUrl ? "&proxy-list=" + proxyBankUrl : ""
      }" class="py-1" ><img width=20 src="https://hatscripts.github.io/circle-flags/flags/${flag.toLowerCase()}.svg" /></a>`;
    }

    this.html = this.html.replaceAll("PLACEHOLDER_BENDERA_NEGARA", flagElement);
  }

  addPageButton(text, link, isDisabled) {
    const pageButton = `<li><button ${
      isDisabled ? "disabled" : ""
    } class="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-400 dark:disabled:bg-slate-600 text-white font-semibold border-2 border-neutral-800 rounded-lg transition-colors" onclick=navigateTo('${link}')>${text}</button></li>`;

    this.html = this.html.replaceAll("PLACEHOLDER_PAGE_BUTTON", `${pageButton}\nPLACEHOLDER_PAGE_BUTTON`);
  }

  build(isApiReady) {
    this.buildProxyGroup();
    this.buildCountryFlag();
    this.html = this.html.replaceAll("PLACEHOLDER_API_READY", isApiReady ? "block" : "hidden");
    return this.html.replaceAll(/PLACEHOLDER_\w+/gim, "");
  }
}


const baseHTML = `
<!DOCTYPE html>
<html lang="en" id="html" class="scroll-auto scrollbar-hide dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title> Badak Terbang Proxy List</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      .scrollbar-hide::-webkit-scrollbar { display: none; }
      .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
      .glass-effect { background-color: rgba(42, 42, 47, 0.6); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(0, 224, 183, 0.3); box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); }
      .glass-effect-light { background-color: rgba(255, 255, 255, 0.1); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(0, 224, 183, 0.2); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05); }
    </style>
    <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/lozad/dist/lozad.min.js"></script>
    <script>
      tailwind.config = {
        darkMode: 'selector',
        theme: {
          extend: {
            fontFamily: { sans: ['Poppins', 'sans-serif'], },
            colors: { 'primary-dark': '#1c1c20', 'secondary-dark': '#2a2a2f', 'text-light': '#f0f0f5', 'accent-cyan': '#00e0b7', 'accent-blue': '#4a90e2', },
          },
        },
      };
    </script>
  </head>
  <body class="bg-primary-dark font-sans text-text-light bg-fixed relative">
    <div class="fixed inset-0 z-0 bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 opacity-75"></div>
    <div id="notification-badge" class="fixed z-50 opacity-0 transition-opacity ease-in-out duration-300 mt-9 mr-6 right-0 p-4 max-w-sm rounded-xl flex items-center gap-x-4 shadow-lg glass-effect">
      <div class="shrink-0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6 text-accent-cyan"><path d="M5.85 3.5a.75.75 0 0 0-1.117-1 9.719 9.719 0 0 0-2.348 4.876.75.75 0 0 0 1.479.248A8.219 8.219 0 0 1 5.85 3.5ZM19.267 2.5a.75.75 0 1 0-1.118 1 8.22 8.22 0 0 1 1.987 4.124.75.75 0 0 0 1.48-.248A9.72 9.72 0 0 0 19.266 2.5Z" /><path fill-rule="evenodd" d="M12 2.25A6.75 6.75 0 0 0 5.25 9v.75a8.217 8.217 0 0 1-2.119 5.52.75.75 0 0 0 .298 1.206c1.544.57 3.16.99 4.831 1.243a3.75 3.75 0 1 0 7.48 0 24.583 24.583 0 0 0 4.83-1.244.75.75 0 0 0 .298-1.205 8.217 8.217 0 0 1-2.118-5.52V9A6.75 6.75 0 0 0 12 2.25ZM9.75 18c0-.034 0-.067.002-.1a25.05 25.05 0 0 0 4.496 0l.002.1a2.25 2.25 0 1 1-4.5 0Z" clip-rule="evenodd" /></svg></div>
      <div><div class="text-md font-bold text-accent-cyan">Berhasil!</div><p class="text-sm text-gray-300">Akun berhasil disalin</p></div>
    </div>
    <div class="h-full fixed top-0 w-16 z-20 overflow-y-scroll scrollbar-hide shadow-lg glass-effect"><div class="text-2xl flex flex-col items-center h-full gap-2 py-4">PLACEHOLDER_BENDERA_NEGARA</div></div>
    <div class="ml-16 flex flex-col items-center min-h-screen relative z-10 p-4">
      <div class="rounded-xl p-4 text-right w-full mb-6 shadow-lg glass-effect"><div class="flex justify-end gap-3 text-sm flex-wrap text-gray-300"><p id="container-info-ip">IP: 127.0.0.1</p><p id="container-info-country">Country: Singapore</p><p id="container-info-isp">ISP: Localhost</p></div></div>
      <div id="container-title" class="sticky top-0 py-6 w-full max-w-7xl z-10 text-center glass-effect-light rounded-xl mb-6"><h1 class="text-2xl font-semibold text-text-light">PLACEHOLDER_JUDUL</h1></div>
      <div class="flex flex-col md:flex-row gap-6 pt-10 w-full max-w-7xl justify-center">PLACEHOLDER_PROXY_GROUP</div>
      <nav id="container-pagination" class="w-full max-w-7xl mt-8 sticky bottom-0 z-20 transition-transform -translate-y-6"><ul class="flex justify-center space-x-4">PLACEHOLDER_PAGE_BUTTON</ul></nav>
    </div>
    <div id="container-window" class="hidden">
      <div class="fixed inset-0 z-20 flex items-center justify-center p-4" style="background-color: rgba(28, 28, 32, 0.8);"><p id="container-window-info" class="text-xl text-center text-text-light animate-pulse"></p></div>
      <div id="output-window" class="fixed inset-0 z-20 flex justify-center items-center p-4 hidden" style="background-color: rgba(28, 28, 32, 0.8);">
        <div class="w-full md:w-[75%] lg:w-[50%] flex flex-col gap-4 p-6 rounded-xl glass-effect">
          <div class="flex flex-col gap-2">
            <div class="flex flex-wrap gap-2 justify-center"><button onclick="copyToClipboardAsTarget('clash')" class="flex-1 min-w-[48%] p-3 rounded-full bg-accent-blue hover:bg-opacity-80 text-white font-medium transition-colors transform hover:scale-105">Clash</button><button onclick="copyToClipboardAsTarget('sfa')" class="flex-1 min-w-[48%] p-3 rounded-full bg-accent-blue hover:bg-opacity-80 text-white font-medium transition-colors transform hover:scale-105">SFA</button></div>
            <div class="flex flex-wrap gap-2 justify-center"><button onclick="copyToClipboardAsTarget('bfr')" class="flex-1 min-w-[48%] p-3 rounded-full bg-accent-blue hover:bg-opacity-80 text-white font-medium transition-colors transform hover:scale-105">BFR</button><button onclick="copyToClipboardAsTarget('v2ray')" class="flex-1 min-w-[48%] p-3 rounded-full bg-accent-blue hover:bg-opacity-80 text-white font-medium transition-colors transform hover:scale-105">V2Ray/Xray</button></div>
          </div>
          <button onclick="copyToClipboardAsRaw()" class="w-full p-3 rounded-full bg-accent-cyan hover:bg-opacity-80 text-white font-medium transition-colors transform hover:scale-105">Raw</button>
          <button onclick="toggleOutputWindow()" class="w-full p-3 rounded-full border-2 border-accent-blue text-accent-blue hover:bg-accent-blue hover:text-white font-medium transition-colors transform hover:scale-105">Close</button>
        </div>
      </div>
      <div id="wildcards-window" class="fixed hidden z-20 top-0 right-0 w-full h-full flex justify-center items-center" style="background-color: rgba(28, 28, 32, 0.8);">
        <div class="w-full md:w-[75%] lg:w-[50%] flex flex-col gap-4 p-6 rounded-xl glass-effect">
          <div class="flex gap-2">
            <input id="new-domain-input" type="text" placeholder="Input wildcard" class="flex-1 px-4 py-3 rounded-md focus:outline-none bg-primary-dark text-text-light placeholder-gray-500 border-2 border-transparent focus:border-accent-blue transition-colors" />
            <button onclick="registerDomain()" class="p-3 rounded-full bg-accent-blue hover:bg-opacity-80 text-white transition-colors transform hover:scale-105"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6"><path fill-rule="evenodd" d="M16.72 7.72a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06l2.47-2.47H3a.75.75 0 0 1 0-1.5h16.19l-2.47-2.47a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"></path></svg></button>
          </div>
          <div id="container-domains" class="flex-1 w-full rounded-md flex flex-col gap-2 overflow-y-scroll scrollbar-hide p-2 glass-effect-light"></div>
          <button onclick="toggleWildcardsWindow()" class="w-full p-3 rounded-full border-2 border-accent-blue text-accent-blue hover:bg-accent-blue hover:text-white font-medium transition-colors transform hover:scale-105">Close</button>
        </div>
      </div>
    </div>
    <footer>
      <div class="fixed bottom-4 right-4 flex flex-col gap-3 z-50">
        <a href="${DONATE_LINK}" target="_blank"><button class="transition-colors rounded-full p-3 block text-white shadow-lg transform hover:scale-105 bg-accent-blue hover:bg-opacity-80"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6"><path d="M10.464 8.746c.227-.18.497-.311.786-.394v2.795a2.252 2.252 0 0 1-.786-.393c-.394-.313-.546-.681-.546-1.004 0-.323.152-.691.546-1.004ZM12.75 15.662v-2.824c.347.085.664.228.921.421.427.32.579.686.579.991 0 .305-.152.671-.579.991a2.534 2.534 0 0 1-.921.42Z" /><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v.816a3.836 3.836 0 0 0-1.72.756c-.712.566-1.112 1.35-1.112 2.178 0 .829.4 1.612 1.113 2.178.502.4 1.102.647 1.719.756v2.978a2.536 2.536 0 0 1-.921-.421l-.879-.66a.75.75 0 0 0-.9 1.2l.879.66c.533.4 1.169.645 1.821.75V18a.75.75 0 0 0 1.5 0v-.81a4.124 4.124 0 0 0 1.821-.749c.745-.559 1.179-1.344 1.179-2.191 0-.847-.434-1.632-1.179-2.191a4.122 4.122 0 0 0-1.821-.75V8.354c.29.082.559.213.786.393l.415.33a.75.75 0 0 0 .933-1.175l-.415-.33a3.836 3.836 0 0 0-1.719-.755V6Z" clip-rule="evenodd" /></svg></button></a>
        <button onclick="toggleWildcardsWindow()" class="transition-colors rounded-full p-3 text-white shadow-lg PLACEHOLDER_API_READY transform hover:scale-105 bg-accent-blue hover:bg-opacity-80"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6 text-text-light"><path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" /></svg></button>
        <button onclick="toggleDarkMode()" class="transition-colors rounded-full p-3 text-white shadow-lg transform hover:scale-105 bg-accent-cyan hover:bg-opacity-80"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6 text-text-light"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" ></path></svg></button>
      </div>
    </footer>
    <script>
      const rootDomain = "${serviceName}.${rootDomain}";
      const notification = document.getElementById("notification-badge");
      const windowContainer = document.getElementById("container-window");
      const windowInfoContainer = document.getElementById("container-window-info");
      const converterUrl = "https://script.google.com/macros/s/AKfycbwwVeHNUlnP92syOP82p1dOk_-xwBgRIxkTjLhxxZ5UXicrGOEVNc5JaSOu0Bgsx_gG/exec";
      let isDomainListFetched = false;
      let rawConfig = "";
      function getDomainList() { /* ... */ }
      function registerDomain() { /* ... */ }
      function copyToClipboard(text) { /* ... */ }
      function copyToClipboardAsRaw() { /* ... */ }
      async function copyToClipboardAsTarget(target) { /* ... */ }
      function navigateTo(link) { window.location.href = link + window.location.search; }
      function toggleOutputWindow() { /* ... */ }
      function toggleWildcardsWindow() { /* ... */ }
      function toggleWindow() { /* ... */ }
      function toggleDarkMode() { /* ... */ }
      function checkProxy() { /* ... */ }
      function checkRegion() { /* ... */ }
      function checkGeoip() { /* ... */ }
      window.onload = () => { /* ... */ };
      window.onscroll = () => { /* ... */ };
    </script>
  </body>
</html>
`;
