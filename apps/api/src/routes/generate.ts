import { Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

// POST /api/generate - Generate content using Gemini
app.post('/', async (c) => {
    try {
        const { prompt, model = 'gemini-2.0-flash-exp' } = await c.req.json();
        if (!prompt) return c.json({ success: false, error: 'Missing prompt' }, 400);

        // Get API key from database or environment
        let apiKey = c.env.GEMINI_API_KEY;

        if (!apiKey) {
            try {
                const settings = await c.env.DB.prepare(`
                    SELECT setting_value FROM global_settings WHERE setting_key = ?
                `).bind('gemini_api_key').first<{ setting_value: string }>();
                apiKey = settings?.setting_value;
            } catch {
                // Fall back to legacy schema if it still exists.
            }
        }

        if (!apiKey) {
            try {
                const legacySettings = await c.env.DB.prepare(`
                    SELECT gemini_api_key FROM global_settings WHERE id = 1
                `).first<{ gemini_api_key: string }>();
                apiKey = legacySettings?.gemini_api_key;
            } catch {
                // Ignore legacy lookup failures.
            }
        }

        if (!apiKey) {
            return c.json({ success: false, error: 'No Gemini API key configured' }, 400);
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.9,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 2048,
                    },
                }),
            }
        );

        const data = await response.json() as any;

        if (data.error) {
            return c.json({ success: false, error: data.error.message }, 400);
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return c.json({ success: true, text });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as generateRouter };
