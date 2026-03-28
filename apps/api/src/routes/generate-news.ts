import { Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

const ANALYSIS_MODEL = 'gemini-2.0-flash-exp';
const GENERATION_MODEL = 'gemini-2.0-flash-exp';

interface ReferenceImage {
    data: string;
    mimeType: string;
}

function fillTemplate(template: string, replacements: Record<string, string>) {
    let result = template;
    for (const key in replacements) {
        result = result.replace(new RegExp(`{{${key}}}`, 'g'), replacements[key]);
    }
    return result;
}

// Generate news-style image montage
app.post('/', async (c) => {
    try {
        const { referenceImages, analysisPrompt, generationPrompt, aspectRatio, variationCount, aiResolution } = await c.req.json();

        if (!referenceImages?.length) {
            return c.json({ error: 'No images provided' }, 400);
        }

        // Get API key from environment first, then fallback to database settings.
        let apiKey: string | undefined = c.env.GEMINI_API_KEY;

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
            return c.json({ error: 'No Gemini API key configured' }, 400);
        }

        // Step 1: Analyze images (optional)
        let analysisContext = "";
        if (analysisPrompt) {
            const analysisParts: any[] = [];
            referenceImages.forEach((img: ReferenceImage, index: number) => {
                analysisParts.push({ text: `Image Index [${index}]:` });
                analysisParts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
            });
            analysisParts.push({ text: analysisPrompt });

            const analysisResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${ANALYSIS_MODEL}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: analysisParts }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });
            const analysisData = await analysisResponse.json() as any;
            analysisContext = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }

        // Step 2: Parse analysis
        let selectedImages: ReferenceImage[] = referenceImages;
        let subjectDescription = "";

        if (analysisContext) {
            try {
                const cleanJson = analysisContext.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(cleanJson);
                if (parsed.selected_indices?.length > 0) {
                    selectedImages = referenceImages.filter((_: any, i: number) => parsed.selected_indices.includes(i));
                }
                if (parsed.subject_visual_lock) subjectDescription = parsed.subject_visual_lock;
            } catch (e) {
                console.warn("Failed to parse analysis JSON:", e);
            }
        }

        if (selectedImages.length === 0) selectedImages = referenceImages.slice(0, 4);

        // Step 3: Generate images
        const finalPrompt = generationPrompt
            ? fillTemplate(generationPrompt, { input_count: selectedImages.length.toString(), subject_description: subjectDescription })
            : "Create a dramatic news montage from these images. Thai tabloid style with red borders.";

        const parts: any[] = [];
        selectedImages.forEach((img: ReferenceImage) => {
            parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
        });
        parts.push({ text: finalPrompt });

        const count = Math.min(variationCount || 4, 4);
        const generatedImages: string[] = [];

        for (let attempt = 0; attempt < count + 2 && generatedImages.length < count; attempt++) {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GENERATION_MODEL}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
                })
            });
            const data = await response.json() as any;

            for (const part of data.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData?.data && generatedImages.length < count) {
                    const mimeType = part.inlineData.mimeType || 'image/png';
                    generatedImages.push(`data:${mimeType};base64,${part.inlineData.data}`);
                }
            }
        }

        if (generatedImages.length === 0) {
            return c.json({ success: false, error: 'No images generated' }, 500);
        }

        return c.json({ success: true, images: generatedImages, analysis: analysisContext });
    } catch (err) {
        console.error('[generate-news] Error:', err);
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

export { app as generateNewsRouter };
