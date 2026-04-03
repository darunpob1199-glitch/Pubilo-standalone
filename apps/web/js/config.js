// Pubilo v5.0 - Cloudflare API Configuration
const PUBILO_API_STORAGE_KEY = 'pubilo_api_base';
const PUBILO_WEB_ONLY_MODE = false;

window.PUBILO_WEB_ONLY_MODE = PUBILO_WEB_ONLY_MODE;
window.PUBILO_HIDDEN_HASHES = ['quotes', 'earnings'];
window.PUBILO_DISABLED_HASHES = ['hide-posts'];

// Old production preview URLs stay frozen on older deploys and keep causing stale-client issues.
// Always move users back to the stable production hostname.
if (
    window.location.hostname.endsWith('.pubilo-web-prod.pages.dev') &&
    window.location.hostname !== 'pubilo-web-prod.pages.dev'
) {
    const stableUrl = `https://pubilo-web-prod.pages.dev${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(stableUrl);
}

if (window.location.hostname === 'pubilo.com') {
    const appUrl = `https://app.pubilo.com${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(appUrl);
}

const HOST_API_MAP = {
    'app.pubilo.com': 'https://api.pubilo.com',
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

document.addEventListener('DOMContentLoaded', () => {
    const hiddenIds = [
        'hidePostsNavItem',
    ];

    if (PUBILO_WEB_ONLY_MODE) {
        document.body.dataset.productMode = 'web-only';

        hiddenIds.push(
            'earningsNavItem',
            'pendingQuotesTab',
            'quotesPostsTab',
            'quotesQuotesTab',
            'quotesPanel',
            'earningsPanel',
            'textQuoteSubmitBtn',
            'addQuoteBtn',
        );
    }

    hiddenIds.forEach((id) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.style.display = 'none';
        element.setAttribute('aria-hidden', 'true');
    });
});

// Override fetch to automatically prefix API calls
const originalFetch = window.fetch;
window.__PUBILO_NATIVE_FETCH__ = originalFetch.bind(window);
window.PUBILO_AUTH_READY_PROMISE = window.PUBILO_AUTH_READY_PROMISE || Promise.resolve();
window.fetch = function (url, options) {
    const isApiRequest = typeof url === 'string' && url.startsWith('/api/');
    const bypassAuth =
        typeof url === 'string' && (
            url.startsWith('/api/auth/')
            || url.startsWith('/api/billing/')
            || url === '/api/news-link'
            || url === '/health'
            || url === '/'
        );

    if (isApiRequest) {
        url = window.API_BASE + url;
        options = {
            ...(options || {}),
            credentials: 'include',
        };
    }

    return (async () => {
        if (isApiRequest && !bypassAuth && window.PUBILO_AUTH_READY_PROMISE) {
            await window.PUBILO_AUTH_READY_PROMISE;
        }

        const response = await originalFetch.call(this, url, options);

        if (isApiRequest && response.status === 401 && window.PubiloAuth?.handleUnauthenticated) {
            window.PubiloAuth.handleUnauthenticated();
        }

        if (isApiRequest && response.status === 402 && window.PubiloAuth?.handleSubscriptionRequired) {
            window.PubiloAuth.handleSubscriptionRequired();
        }

        return response;
    })();
};
