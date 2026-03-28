// Pubilo v5.0 - Cloudflare API Configuration
const PUBILO_API_STORAGE_KEY = 'pubilo_api_base';

// Old production preview URLs stay frozen on older deploys and keep causing stale-client issues.
// Always move users back to the stable production hostname.
if (
    window.location.hostname.endsWith('.pubilo-web-prod.pages.dev') &&
    window.location.hostname !== 'pubilo-web-prod.pages.dev'
) {
    const stableUrl = `https://pubilo-web-prod.pages.dev${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(stableUrl);
}

const HOST_API_MAP = {
    'pubilo-web-prod.pages.dev': 'https://pubilo-api-prod.lungnuek.workers.dev',
    'pubilo-web-dev.pages.dev': 'https://pubilo-api-dev.lungnuek.workers.dev',
    'pubilo.com': 'https://pubilo-api-prod.lungnuek.workers.dev',
    'www.pubilo.com': 'https://pubilo-api-prod.lungnuek.workers.dev',
    'pubilo.lslly.com': 'https://pubilo-api-prod.lungnuek.workers.dev',
};

function resolveHostApiBase(hostname) {
    if (!hostname) return '';
    if (HOST_API_MAP[hostname]) return HOST_API_MAP[hostname];
    if (hostname.endsWith('.pubilo-web-prod.pages.dev')) {
        return 'https://pubilo-api-prod.lungnuek.workers.dev';
    }
    if (hostname.endsWith('.pubilo-web-dev.pages.dev')) {
        return 'https://pubilo-api-dev.lungnuek.workers.dev';
    }
    return '';
}

function normalizeApiBase(value) {
    return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

const urlParams = new URLSearchParams(window.location.search);
const apiParam = normalizeApiBase(urlParams.get('api'));

if (apiParam) {
    localStorage.setItem(PUBILO_API_STORAGE_KEY, apiParam);
}

const hostApiBase = resolveHostApiBase(window.location.hostname);
const storedApiBase = normalizeApiBase(localStorage.getItem(PUBILO_API_STORAGE_KEY));

window.API_BASE = normalizeApiBase(
    window.__PUBILO_API_BASE__
    || document.querySelector('meta[name="pubilo-api-base"]')?.content
    || apiParam
    // Host mapping has priority over stored value to prevent stale API base on preview subdomains.
    || hostApiBase
    || storedApiBase
    || 'https://api.pubilo.com'
);

console.log('[Pubilo] API_BASE:', window.API_BASE, '| host:', window.location.hostname);

// Override fetch to automatically prefix API calls
const originalFetch = window.fetch;
window.fetch = function (url, options) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
        url = window.API_BASE + url;
    }
    return originalFetch.call(this, url, options);
};
