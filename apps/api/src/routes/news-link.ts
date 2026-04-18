import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { Env } from '../index';
import { getNewsLinkPreview } from '../lib/news-link-previews';

const app = new Hono<{ Bindings: Env }>();
const PREVIEW_CRAWLER_TOKENS = [
    'facebookexternalhit',
    'facebot',
    'twitterbot',
    'slackbot',
    'linkedinbot',
    'discordbot',
    'telegrambot',
    'whatsapp',
    'skypeuripreview',
    'googlebot',
    'bingbot',
    'pinterestbot',
    'applebot',
];

function sanitizeText(value: string | null | undefined, fallback = ''): string {
    return typeof value === 'string' ? value.trim() : fallback;
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function normalizeSiteName(siteName: string, targetUrl: string): string {
    const explicit = sanitizeText(siteName);
    if (explicit) return explicit;

    try {
        return new URL(targetUrl).hostname.replace(/^www\./, '').toUpperCase();
    } catch {
        return 'PUBILO';
    }
}

function shouldServePreviewHtml(userAgent: string): boolean {
    const normalized = sanitizeText(userAgent).toLowerCase();
    if (!normalized) return true;
    return PREVIEW_CRAWLER_TOKENS.some((token) => normalized.includes(token));
}

app.get('/', async (c) => {
    const previewId = sanitizeText(c.req.query('id'));
    const previewRecord = previewId
        ? await getNewsLinkPreview(c.env, previewId)
        : null;
    const target = previewRecord?.target_url
        ? sanitizeText(previewRecord.target_url)
        : sanitizeText(c.req.query('target'));
    if (!isHttpUrl(target)) {
        return c.text('Invalid target', 400);
    }

    const userAgent = sanitizeText(c.req.header('user-agent'));
    // Always serve OG HTML first, then redirect client-side.
    // Relying on crawler UA detection caused some Facebook fetchers to receive 302
    // and skip OG metadata, resulting in "api.pubilo.com" plain cards.
    // Keep the call for diagnostics, but do not branch on it.
    shouldServePreviewHtml(userAgent);

    const title = previewRecord?.title
        ? sanitizeText(previewRecord.title, 'ดูรายละเอียดสินค้า')
        : sanitizeText(c.req.query('title'), 'ดูรายละเอียดสินค้า');
    const description = previewRecord?.description
        ? sanitizeText(previewRecord.description, 'แตะเพื่อดูรายละเอียดสินค้าใน Lazada')
        : sanitizeText(c.req.query('description'), 'แตะเพื่อดูรายละเอียดสินค้าใน Lazada');
    const image = previewRecord?.image_url
        ? sanitizeText(previewRecord.image_url)
        : sanitizeText(c.req.query('image'));
    const siteName = previewRecord?.site_name
        ? normalizeSiteName(previewRecord.site_name, target)
        : normalizeSiteName(c.req.query('site') || '', target);
    const previewUrl = sanitizeText(c.req.header('x-public-preview-url')) || c.req.url;

    // Build the redirect script with raw() to prevent Hono from escaping
    // quotes inside <script> tags. JSON.stringify is safe here because it
    // produces a valid JS string literal with proper escaping.
    const redirectScript = raw(`<script>window.location.replace(${JSON.stringify(target)});</script>`);

    c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    return c.html(html`<!doctype html>
        <html lang="th">
            <head>
                <meta charset="utf-8" />
                <title>${title}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <meta name="robots" content="noindex, nofollow" />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="${previewUrl}" />
                <meta property="og:title" content="${title}" />
                <meta property="og:description" content="${description}" />
                <meta property="og:site_name" content="${siteName}" />
                <meta property="og:see_also" content="${target}" />
                <meta name="twitter:title" content="${title}" />
                <meta name="twitter:description" content="${description}" />
                <link rel="canonical" href="${previewUrl}" />
                ${image
                    ? html`
                        <meta property="og:image" content="${image}" />
                        <meta property="og:image:secure_url" content="${image}" />
                        <meta property="og:image:width" content="1080" />
                        <meta property="og:image:height" content="1080" />
                        <meta property="og:image:alt" content="${title}" />
                        <meta name="twitter:card" content="summary_large_image" />
                        <meta name="twitter:image" content="${image}" />
                    `
                    : html`<meta name="twitter:card" content="summary" />`}
            </head>
            <body>
                ${redirectScript}
                <noscript>
                    <meta http-equiv="refresh" content="${`0;url=${target}`}" />
                </noscript>
                <p><a href="${target}">${title}</a></p>
            </body>
        </html>`);
});

export { app as newsLinkRouter };
