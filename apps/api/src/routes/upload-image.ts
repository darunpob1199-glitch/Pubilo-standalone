import { Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

function normalizeBase64Input(raw?: string): string {
    if (!raw || typeof raw !== 'string') return '';

    const trimmed = raw.trim();
    if (!trimmed) return '';

    // Support full data URLs with any mime params, e.g. data:image/jpeg;name=a.jpg;base64,xxxx
    const base64Payload = (() => {
        if (!trimmed.startsWith('data:')) return trimmed;
        const commaIndex = trimmed.indexOf(',');
        return commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : '';
    })();

    // Normalize possible base64url + whitespace/newlines
    let normalized = base64Payload
        .replace(/\s+/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const remainder = normalized.length % 4;
    if (remainder > 0) {
        normalized += '='.repeat(4 - remainder);
    }

    return normalized;
}

// POST /api/upload-image
app.post('/', async (c) => {
    try {
        const { imageBase64, imageData, imageUrl } = await c.req.json() as {
            imageBase64?: string;
            imageData?: string;
            imageUrl?: string;
        };
        const normalizedImageBase64 =
            normalizeBase64Input(imageBase64) ||
            normalizeBase64Input(imageData);

        if (!normalizedImageBase64 && !imageUrl) {
            return c.json({ success: false, error: 'Missing image data' }, 400);
        }

        const apiKey = c.env.FREEIMAGE_API_KEY;
        if (!apiKey) {
            return c.json({ success: false, error: 'No image upload API key configured' }, 400);
        }

        const formData = new FormData();
        formData.append('key', apiKey);

        if (normalizedImageBase64) {
            formData.append('source', normalizedImageBase64);
        } else if (imageUrl) {
            formData.append('source', imageUrl);
        }

        const response = await fetch('https://freeimage.host/api/1/upload', {
            method: 'POST',
            body: formData,
        });

        const data = await response.json() as any;

        if (data.error) {
            return c.json({ success: false, error: data.error.message }, 400);
        }

        return c.json({
            success: true,
            url: data.image?.url || data.image?.display_url,
            thumb: data.image?.thumb?.url,
        });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as uploadImageRouter };
