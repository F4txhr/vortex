import { getFlagEmoji } from "./utils.js";

const baseHTML = `
<!DOCTYPE html>
<html lang="en" id="html" class="dark scroll-smooth">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Badak Terbang Proxy</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        .font-poppins { font-family: 'Poppins', sans-serif; }
        .glass-effect {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
    </style>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    fontFamily: {
                        poppins: ['Poppins', 'sans-serif'],
                    },
                    colors: {
                        'dark-bg': '#121212',
                        'dark-card': '#1E1E1E',
                        'dark-text': '#E0E0E0',
                        'dark-accent': '#BB86FC',
                        'dark-primary': '#03DAC6',
                    },
                },
            },
        };
    </script>
</head>
<body class="bg-dark-bg text-dark-text font-poppins">

    <!-- Notification Badge -->
    <div id="notification" class="fixed top-5 right-5 bg-dark-primary text-dark-bg py-2 px-4 rounded-lg shadow-lg opacity-0 transition-opacity duration-300 z-50">
        Copied to clipboard!
    </div>

    <!-- Main Container -->
    <div class="container mx-auto px-4 py-8">

        <!-- Header -->
        <header class="text-center mb-8">
            <h1 id="main-title" class="text-4xl font-bold text-dark-primary">PLACEHOLDER_TITLE</h1>
            <p id="info-container" class="text-md text-dark-text mt-2">PLACEHOLDER_INFO</p>
        </header>

        <!-- Proxy Cards Grid -->
        <div id="proxy-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            PLACEHOLDER_PROXY_CARDS
        </div>

        <!-- Pagination -->
        <nav id="pagination-container" class="flex justify-center mt-8 space-x-4">
            PLACEHOLDER_PAGINATION
        </nav>
    </div>

    <!-- Floating Action Buttons -->
    <div class="fixed bottom-5 right-5 flex flex-col items-center space-y-4">
         <a href="PLACEHOLDER_DONATE_LINK" target="_blank" class="bg-dark-accent hover:bg-opacity-80 text-white w-14 h-14 flex items-center justify-center rounded-full shadow-lg transform hover:scale-110 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.87 7.73l7.92 4.22a2 2 0 001.42 0l7.92-4.22m-15.84 9.54a2 2 0 001.42 0l7.92-4.22 7.92 4.22m-17.26-4.22V7.73a2 2 0 011.42-1.94l7.92-4.22a2 2 0 011.42 0l7.92 4.22A2 2 0 0120.55 7.73v5.54a2 2 0 01-1.42 1.94l-7.92 4.22a2 2 0 01-1.42 0l-7.92-4.22A2 2 0 013.29 13.27z" /></svg>
        </a>
        <button onclick="toggleDarkMode()" class="bg-dark-primary hover:bg-opacity-80 text-white w-14 h-14 flex items-center justify-center rounded-full shadow-lg transform hover:scale-110 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
        </button>
    </div>

    <!-- Modal for showing all configs -->
    <div id="modal" class="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center p-4 hidden z-40">
        <div class="bg-dark-card rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div class="p-4 border-b border-gray-700 flex justify-between items-center">
                <h3 class="text-xl font-semibold text-dark-primary">All Configurations</h3>
                <button onclick="toggleModal()" class="text-gray-400 hover:text-white">&times;</button>
            </div>
            <textarea id="modal-textarea" class="w-full flex-grow p-4 bg-dark-bg text-dark-text resize-none scrollbar-hide" readonly></textarea>
            <div class="p-4 border-t border-gray-700">
                 <button onclick="copyFromModal()" class="w-full bg-dark-primary hover:bg-opacity-80 text-dark-bg font-bold py-2 px-4 rounded-lg transition-colors">
                    Copy All
                </button>
            </div>
        </div>
    </div>

    <script>
        function showNotification() {
            const notification = document.getElementById('notification');
            notification.classList.remove('opacity-0');
            setTimeout(() => {
                notification.classList.add('opacity-0');
            }, 2000);
        }

        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                showNotification();
            });
        }

        function showAllConfigs(textareaId) {
            const sourceTextarea = document.getElementById(textareaId);
            const modalTextarea = document.getElementById('modal-textarea');
            modalTextarea.value = sourceTextarea.value;
            toggleModal();
        }

        function copyFromModal() {
            const modalTextarea = document.getElementById('modal-textarea');
            copyToClipboard(modalTextarea.value);
            toggleModal();
        }

        function toggleModal() {
            const modal = document.getElementById('modal');
            modal.classList.toggle('hidden');
        }

        function toggleDarkMode() {
            document.documentElement.classList.toggle('dark');
        }

        function navigateTo(link) {
            window.location.href = link + window.location.search;
        }

    </script>
</body>
</html>
`;

export class Document {
  constructor(request) {
    this.request = request;
    this.title = "";
    this.info = [];
    this.proxyCards = "";
    this.pagination = "";
  }

  setTitle(title) {
    this.title = title;
  }

  addInfo(text) {
    this.info.push(text);
  }

  registerProxies(proxyInfo, proxies) {
    const textareaId = `proxy-text-${proxyInfo.proxyIP}-${proxyInfo.proxyPort}`;
    const allConfigs = proxies.join("\n");

    this.proxyCards += `
      <div class="bg-dark-card rounded-lg shadow-lg p-5 flex flex-col transform hover:scale-105 transition-transform duration-300">
        <div class="flex items-center mb-3">
          <span class="text-2xl mr-3">${getFlagEmoji(proxyInfo.country)}</span>
          <div>
            <h3 class="font-bold text-lg text-dark-text">${proxyInfo.proxyIP}:${proxyInfo.proxyPort}</h3>
            <p class="text-sm text-gray-400">${proxyInfo.org}</p>
          </div>
        </div>
        <textarea id="${textareaId}" class="w-full h-32 bg-dark-bg text-gray-300 p-2 rounded-md resize-none scrollbar-hide" readonly>${allConfigs}</textarea>
        <div class="mt-4 flex space-x-2">
            <button onclick="copyToClipboard(document.getElementById('${textareaId}').value)" class="flex-1 bg-dark-primary hover:bg-opacity-80 text-dark-bg font-bold py-2 px-4 rounded-lg transition-colors">
                Copy
            </button>
            <button onclick="showAllConfigs('${textareaId}')" class="flex-1 bg-dark-accent hover:bg-opacity-80 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                View All
            </button>
        </div>
      </div>
    `;
  }

  addPageButton(text, link, disabled) {
    const baseClasses = "px-4 py-2 rounded-lg transition-colors";
    const disabledClasses = "bg-gray-700 text-gray-500 cursor-not-allowed";
    const enabledClasses = "bg-dark-primary hover:bg-opacity-80 text-dark-bg font-bold";
    const finalClasses = disabled ? `${baseClasses} ${disabledClasses}` : `${baseClasses} ${enabledClasses}`;

    this.pagination += `
      <a href="${disabled ? "#" : link}" onclick="${disabled ? 'event.preventDefault();' : `navigateTo('${link}')`}" class="${finalClasses}">
        ${text}
      </a>
    `;
  }

  build(env) {
    let html = baseHTML;

    html = html.replace("PLACEHOLDER_TITLE", this.title);
    html = html.replace("PLACEHOLDER_INFO", this.info.join(" | "));
    html = html.replace("PLACEHOLDER_PROXY_CARDS", this.proxyCards);
    html = html.replace("PLACEHOLDER_PAGINATION", this.pagination);
    html = html.replace("PLACEHOLDER_DONATE_LINK", env.DONATE_LINK || "#");

    return html;
  }
}
