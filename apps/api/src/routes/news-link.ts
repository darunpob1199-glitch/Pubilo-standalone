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

app.get('/', (c) => {
    const target = sanitizeText(c.req.query('target'));
    if (!isHttpUrl(target)) {
        return c.text('Invalid target', 400);
    }

    const title = sanitizeText(c.req.query('title'), 'ดูรายละเอียดสินค้า');
    const description = sanitizeText(c.req.query('description'), 'แตะเพื่อดูรายละเอียดสินค้าใน Lazada');
    const image = sanitizeText(c.req.query('image'));
    const siteName = normalizeSiteName(c.req.query('site') || '', target);

    const requestUrl = new URL(c.req.url);
    const ogUrl = requestUrl.toString();

    return c.html(html`<!doctype html>
        <html lang="th">
            <head>
                <meta charset="utf-8" />
                <title>${title}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <meta name="robots" content="noindex, nofollow" />
                <meta property="og:type" content="website" />
                <meta property="og:url" content=${ogUrl} />
                <meta property="og:title" content=${title} />
                <meta property="og:description" content=${description} />
                <meta property="og:site_name" content=${siteName} />
                <link rel="canonical" href=${ogUrl} />
                <meta http-equiv="refresh" content=${`0;url=${target}`} />
                ${image
                    ? html`
                        <meta property="og:image" content=${image} />
                        <meta property="og:image:secure_url" content=${image} />
                        <meta property="og:image:width" content="800" />
                        <meta property="og:image:height" content="1200" />
                        <meta name="twitter:card" content="summary_large_image" />
                        <meta name="twitter:image" content=${image} />
                    `
                    : html`<meta name="twitter:card" content="summary" />`}
            </head>
            <body>
                <script>window.location.replace(${JSON.stringify(target)});</script>
                <p><a href=${target}>${title}</a></p>
            </body>
        </html>`);
});

export { app as newsLinkRouter };
