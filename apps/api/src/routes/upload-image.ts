import { Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

// POST /api/upload-image
app.post('/', async (c) => {
    try {
        const { imageBase64, imageData, imageUrl } = await c.req.json() as {
            imageBase64?: string;
            imageData?: string;
            imageUrl?: string;
        };
        const normalizedImageBase64 =
            imageBase64?.replace(/^data:image\/\w+;base64,/, '') ||
            imageData?.replace(/^data:image\/\w+;base64,/, '');

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
