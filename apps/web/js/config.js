// Pubilo v5.0 - Cloudflare API Configuration
const PUBILO_API_STORAGE_KEY = 'pubilo_api_base';
const HOST_API_MAP = {
    'pubilo-web-prod.pages.dev': 'https://pubilo-api-prod.lungnuek.workers.dev',
    'pubilo-web-dev.pages.dev': 'https://pubilo-api-dev.lungnuek.workers.dev',
    'www.pubilo.com': 'https://api.pubilo.com',
    'pubilo.lslly.com': 'https://api.pubilo.com',
};

function normalizeApiBase(value) {
    return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

const urlParams = new URLSearchParams(window.location.search);
const apiParam = normalizeApiBase(urlParams.get('api'));

if (apiParam) {
    localStorage.setItem(PUBILO_API_STORAGE_KEY, apiParam);
}

window.API_BASE = normalizeApiBase(
    window.__PUBILO_API_BASE__
    || document.querySelector('meta[name="pubilo-api-base"]')?.content
    || apiParam
    || localStorage.getItem(PUBILO_API_STORAGE_KEY)
    || HOST_API_MAP[window.location.hostname]
    || 'https://api.pubilo.com'
);

console.log('[Pubilo] API_BASE:', window.API_BASE);

// Override fetch to automatically prefix API calls
const originalFetch = window.fetch;
window.fetch = function (url, options) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
        url = window.API_BASE + url;
    }
    return originalFetch.call(this, url, options);
};
