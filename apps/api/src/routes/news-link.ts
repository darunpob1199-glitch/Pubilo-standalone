import { Hono } from 'hono';
import { html } from 'hono/html';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

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

function isPreviewCrawler(userAgent: string): boolean {
    const ua = String(userAgent || '').toLowerCase();
    if (!ua) return false;

    return [
        'facebookexternalhit',
        'facebot',
        'meta-externalagent',
        'meta-externalfetcher',
        'twitterbot',
        'slackbot',
        'linkedinbot',
        'discordbot',
        'telegrambot',
        'whatsapp',
        'skypeuripreview',
    ].some((needle) => ua.includes(needle));
}

app.get('/', (c) => {
    const target = sanitizeText(c.req.query('target'));
    if (!isHttpUrl(target)) {
        return c.text('Invalid target', 400);
    }

    const title = sanitizeText(c.req.query('title'), 'ดูรายละเอียดสินค้า');
    const description = sanitizeText(c.req.query('description'), 'แตะเพื่อดูรายละเอียดสินค้าใน Lazada');
    const image = sanitizeText(c.req.query('image'));
    const siteName = normalizeSiteName(c.req.query('site') || '', target);
    const userAgent = c.req.header('user-agent') || '';
    const shouldServePreviewHtml = isPreviewCrawler(userAgent);

    if (!shouldServePreviewHtml) {
        return c.redirect(target, 302);
    }

    const requestUrl = new URL(c.req.url);
    const previewUrl = requestUrl.toString();
    const canonicalUrl = target;

    return c.html(html`<!doctype html>
        <html lang="th">
            <head>
                <meta charset="utf-8" />
                <title>${title}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <meta name="robots" content="noindex, nofollow" />
                <meta http-equiv="refresh" content=${`0;url=${target}`} />
                <meta property="og:type" content="website" />
                <meta property="og:url" content=${canonicalUrl} />
                <meta property="og:title" content=${title} />
                <meta property="og:description" content=${description} />
                <meta property="og:site_name" content=${siteName} />
                <meta name="twitter:title" content=${title} />
                <meta name="twitter:description" content=${description} />
                <meta name="twitter:url" content=${canonicalUrl} />
                <link rel="canonical" href=${canonicalUrl} />
                ${image
                    ? html`
                        <meta property="og:image" content=${image} />
                        <meta property="og:image:secure_url" content=${image} />
                        <meta property="og:image:width" content="800" />
                        <meta property="og:image:height" content="1200" />
                        <meta property="og:image:alt" content=${title} />
                        <meta name="twitter:card" content="summary_large_image" />
                        <meta name="twitter:image" content=${image} />
                    `
                    : html`<meta name="twitter:card" content="summary" />`}
            </head>
            <body style="margin:0;background:#fff;">
                <script>window.location.replace(${JSON.stringify(target)});</script>
                <noscript><meta http-equiv="refresh" content=${`0;url=${target}`} /></noscript>
                <p style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;">
                    <a href=${target}>${title}</a>
                </p>
                <small style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;">
                    Preview: ${previewUrl}
                </small>
            </body>
        </html>`);
});

export { app as newsLinkRouter };
