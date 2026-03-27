import { Hono } from 'hono';
import { Env } from '../index';

const app = new Hono<{ Bindings: Env }>();

interface AutoPostConfig {
    page_id: string;
    auto_schedule: number;
    schedule_minutes: string;
    working_hours_start: number;
    working_hours_end: number;
    post_token: string | null;
    post_mode: 'image' | 'text' | 'alternate' | null;
    color_bg: number;
    share_page_id: string | null;
    share_mode: 'both' | 'image' | 'text' | null;
    share_schedule_minutes: string | null;
    color_bg_presets: string | null;
    color_bg_index: number;
    page_color: string | null;
    page_name: string | null;
    last_post_type: 'text' | 'image' | null;
    image_source: 'ai' | 'og' | null;
    og_background_url: string | null;
    og_font: string | null;
    ai_model: string | null;
    ai_resolution: string | null;
    image_image_size: string | null;
}

// Facebook Graph API helpers
async function createTextPost(pageId: string, postToken: string, message: string, presetId: string | null = null): Promise<string> {
    const params: Record<string, string> = { message, access_token: postToken };
    if (presetId) params.text_format_preset_id = presetId;

    console.log(`[createTextPost] Posting to ${pageId} with preset: ${presetId}`);

    const response = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });

    const result = await response.json() as any;
    if (result.error) throw new Error(result.error.message);
    console.log(`[createTextPost] Success: ${result.id}`);
    return result.id;
}

async function createImagePost(pageId: string, postToken: string, imageUrl: string, message: string): Promise<string> {
    const response = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url: imageUrl, caption: message, access_token: postToken }),
    });

    const result = await response.json() as any;
    if (result.error) throw new Error(result.error.message);
    return result.post_id || result.id;
}

async function sharePost(postId: string, targetPageId: string, targetPageToken: string): Promise<string> {
    const response = await fetch(`https://graph.facebook.com/v21.0/${targetPageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ link: `https://www.facebook.com/${postId}`, access_token: targetPageToken }),
    });

    const result = await response.json() as any;
    if (result.error) throw new Error(result.error.message);
    return result.id;
}

async function generateAIImage(quoteText: string, customPrompt: string | undefined, aspectRatio: string, pageName: string | undefined, aiModel: string, aiResolution: string, GEMINI_API_KEY: string): Promise<string> {
    let textPrompt: string;

    if (customPrompt?.trim()) {
        textPrompt = customPrompt
            .replace(/\{\{QUOTE\}\}/g, quoteText)
            .replace(/\{\{PAGE_NAME\}\}/g, pageName || '');

        const aspectDimensions: Record<string, string> = {
            '1:1': '1024x1024 pixels (square)',
            '2:3': '1024x1536 pixels (portrait)',
            '3:2': '1536x1024 pixels (landscape)',
            '4:5': '1024x1280 pixels (portrait)',
            '5:4': '1280x1024 pixels (landscape)',
            '9:16': '1024x1820 pixels (vertical)',
            '16:9': '1820x1024 pixels (widescreen)',
        };
        const dimensionDesc = aspectDimensions[aspectRatio] || `${aspectRatio} ratio`;
        textPrompt += `\n\n**IMAGE DIMENSIONS:** Aspect Ratio ${aspectRatio} → ${dimensionDesc}, Resolution: ${aiResolution}`;
    } else {
        textPrompt = `สร้างรูปภาพ 1 รูป สำหรับโพสต์ Facebook:\n- พื้นหลังธรรมชาติสวยงาม\n- ข้อความ: "${quoteText}"\n- ฟอนต์หนา อ่านง่าย`;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${aiModel}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: textPrompt }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
    });

    if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

    const result = await response.json() as any;
    for (const part of result.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) {
            return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        }
    }
    throw new Error('No image generated from Gemini');
}

async function uploadImageToHost(base64Data: string, FREEIMAGE_API_KEY: string): Promise<string> {
    const base64Only = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const formData = new FormData();
    formData.append('key', FREEIMAGE_API_KEY);
    formData.append('source', base64Only);
    formData.append('format', 'json');

    const response = await fetch('https://freeimage.host/api/1/upload', { method: 'POST', body: formData });
    if (!response.ok) throw new Error(`Image upload failed: ${response.status}`);

    const result = await response.json() as any;
    if (!result.image?.url) throw new Error('No URL returned from image host');
    return result.image.url;
}



async function generateOGImage(quoteText: string, backgroundUrl: string, font: string, baseUrl?: string): Promise<string> {
    // Use Rust Worker to generate OG Image - return URL directly
    const cleanText = quoteText.replace(/\n/g, ' ').trim();
    const ogParams = new URLSearchParams({ text: cleanText, font, image: backgroundUrl });
    const normalizedBaseUrl = (baseUrl || '').trim().replace(/\/+$/, '');
    if (!normalizedBaseUrl) {
        throw new Error('OG image worker is not configured');
    }
    const generateUrl = `${normalizedBaseUrl}/api/generate.png?${ogParams.toString()}`;
    
    // Facebook will fetch the image from this URL when posting
    return generateUrl;
}

// Main cron handler
app.get('/', async (c) => {
    const forcePost = c.req.query('force') === 'true';
    const now = new Date();
    const thaiNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const currentMinute = thaiNow.getUTCMinutes();
    const currentHour = thaiNow.getUTCHours();

    console.log(`[cron-auto-post] Running at Thai time ${currentHour}:${currentMinute.toString().padStart(2, '0')}`);

    // Get enabled configs (select only needed columns to save D1 rows read)
    const configs = await c.env.DB.prepare(`
        SELECT page_id, auto_schedule, schedule_minutes, working_hours_start, working_hours_end,
               post_token, post_mode, color_bg, color_bg_presets, color_bg_index, page_color, page_name,
               last_post_type, image_source, og_background_url, og_font, ai_model, ai_resolution,
               image_image_size, share_page_id, share_mode, share_schedule_minutes
        FROM page_settings WHERE auto_schedule = 1 AND post_mode IS NOT NULL
    `).all<AutoPostConfig>();

    if (!configs.results?.length) {
        return c.json({ success: true, message: 'No enabled configs', processed: 0 });
    }

    // Get target page_id if specified
    const targetPageId = c.req.query('page_id');

    // Filter due configs
    const dueConfigs = configs.results.filter(config => {
        if (!config.post_mode) return false;
        
        // If force post with specific page_id, only match that page
        if (forcePost && targetPageId) {
            return config.page_id === targetPageId;
        }
        
        // If force post without page_id, match all
        if (forcePost) return true;

        const scheduleMinutes = (config.schedule_minutes || '00,15,30,45')
            .split(',').map(m => parseInt(m.trim())).filter(m => !isNaN(m));
        const workingStart = config.working_hours_start ?? 6;
        const workingEnd = config.working_hours_end ?? 24;
        const isInWorkingHours = currentHour >= workingStart && currentHour < workingEnd;
        const isScheduledMinute = scheduleMinutes.includes(currentMinute);

        return isInWorkingHours && isScheduledMinute;
    });

    if (!dueConfigs.length) {
        return c.json({ success: true, message: 'No posts due at this minute', processed: 0 });
    }

    let processed = 0;
    const results: any[] = [];

    for (const config of dueConfigs) {
        // Each page has its own try-catch to prevent one page's error from affecting others
        try {
            if (!config.post_token) {
                results.push({ page_id: config.page_id, status: 'skipped', reason: 'no_token' });
                continue;
            }

            // Get unused quote - first try completely unused, then fall back
            let unusedQuote: { id: number; quote_text: string; used_by_pages: string } | null = null;

            // Try completely unused quotes first (reads ~1 row with index)
            const freshQuote = await c.env.DB.prepare(`
                SELECT id, quote_text, used_by_pages FROM quotes
                WHERE used_by_pages IS NULL OR used_by_pages = '[]' OR used_by_pages = ''
                ORDER BY created_at DESC LIMIT 1
            `).first<{ id: number; quote_text: string; used_by_pages: string }>();

            if (freshQuote) {
                unusedQuote = freshQuote;
            } else {
                // Fall back: scan recent 50 quotes (reduced from 200)
                const quotesResult = await c.env.DB.prepare(`
                    SELECT id, quote_text, used_by_pages FROM quotes ORDER BY created_at DESC LIMIT 50
                `).all<{ id: number; quote_text: string; used_by_pages: string }>();

                unusedQuote = quotesResult.results?.find(q => {
                    const usedBy = q.used_by_pages ? JSON.parse(q.used_by_pages) : [];
                    return !usedBy.includes(config.page_id);
                }) || null;
            }

            if (!unusedQuote) {
                results.push({ page_id: config.page_id, status: 'skipped', reason: 'no_quotes' });
                continue;
            }

            // Determine post type
            const postMode = config.post_mode || 'image';
            let nextPostType: 'text' | 'image' = postMode === 'text' ? 'text' :
                postMode === 'image' ? 'image' :
                    config.last_post_type === 'text' ? 'image' : 'text';

            let facebookPostId: string;

            if (nextPostType === 'text') {
                let presetId: string | null = null;
                if (config.color_bg) {
                    const presets = (config.color_bg_presets || '').split(',').filter(s => s.trim());
                    if (presets.length) {
                        presetId = presets[config.color_bg_index % presets.length];
                        await c.env.DB.prepare(`UPDATE page_settings SET color_bg_index = ? WHERE page_id = ?`)
                            .bind((config.color_bg_index + 1) % presets.length, config.page_id).run();
                    }
                }
                facebookPostId = await createTextPost(config.page_id, config.post_token, unusedQuote.quote_text, presetId);
            } else {
                let imageUrl: string;
                
                if (config.image_source === 'og' && config.og_background_url) {
                    // Use Rust Worker directly - Facebook will fetch from this URL
                    imageUrl = await generateOGImage(
                        unusedQuote.quote_text,
                        config.og_background_url,
                        config.og_font || 'noto-sans-thai',
                        c.env.OG_IMAGE_BASE_URL
                    );
                } else {
                    // Get custom prompt
                    const promptResult = await c.env.DB.prepare(`
                        SELECT COALESCE(prompt_text, prompt) as prompt_text
                        FROM prompts
                        WHERE (page_id = ? AND prompt_type = 'image_post')
                           OR (page_id = '_default' AND prompt_type = 'image_post')
                        ORDER BY CASE WHEN page_id = ? THEN 0 ELSE 1 END, updated_at DESC
                        LIMIT 1
                    `).bind(config.page_id, config.page_id).first<{ prompt_text: string }>();

                    const base64Image = await generateAIImage(
                        unusedQuote.quote_text,
                        promptResult?.prompt_text,
                        config.image_image_size || '1:1',
                        config.page_name || undefined,
                        config.ai_model || 'gemini-2.0-flash-exp',
                        config.ai_resolution || '2K',
                        c.env.GEMINI_API_KEY
                    );
                    imageUrl = await uploadImageToHost(base64Image, c.env.FREEIMAGE_API_KEY);
                }
                
                facebookPostId = await createImagePost(config.page_id, config.post_token, imageUrl, unusedQuote.quote_text);
            }

            // Update last_post_type
            await c.env.DB.prepare(`UPDATE page_settings SET last_post_type = ?, updated_at = ? WHERE page_id = ?`)
                .bind(nextPostType, now.toISOString(), config.page_id).run();

            // Mark quote as used
            const usedBy = unusedQuote.used_by_pages ? JSON.parse(unusedQuote.used_by_pages) : [];
            usedBy.push(config.page_id);
            await c.env.DB.prepare(`UPDATE quotes SET used_by_pages = ? WHERE id = ?`)
                .bind(JSON.stringify(usedBy), unusedQuote.id).run();

            // Log to auto_post_logs with Thai time
            const thaiTimestamp = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
            await c.env.DB.prepare(`INSERT INTO auto_post_logs (page_id, post_type, quote_text, status, facebook_post_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
                .bind(config.page_id, nextPostType, unusedQuote.quote_text, 'success', facebookPostId, thaiTimestamp).run();

            // Queue share if configured
            if (config.share_page_id && facebookPostId) {
                const shareMode = config.share_mode || 'both';
                const shouldQueue = shareMode === 'both' ||
                    (shareMode === 'image' && nextPostType === 'image') ||
                    (shareMode === 'text' && nextPostType === 'text');

                if (shouldQueue) {
                    await c.env.DB.prepare(`INSERT INTO share_queue (source_page_id, target_page_id, facebook_post_id, post_type, share_schedule_minutes) VALUES (?, ?, ?, ?, ?)`)
                        .bind(config.page_id, config.share_page_id, facebookPostId, nextPostType, config.share_schedule_minutes).run();
                }
            }

            processed++;
            results.push({ page_id: config.page_id, status: 'success', post_type: nextPostType, post_id: facebookPostId });
        } catch (err) {
            const thaiTimestamp = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
            await c.env.DB.prepare(`INSERT INTO auto_post_logs (page_id, post_type, status, error_message, created_at) VALUES (?, ?, ?, ?, ?)`)
                .bind(config.page_id, 'unknown', 'failed', err instanceof Error ? err.message : String(err), thaiTimestamp).run();
            results.push({ page_id: config.page_id, status: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
    }

    // Process share queue
    const shareResults: any[] = [];
    try {
        const pendingShares = await c.env.DB.prepare(`
            SELECT sq.id, sq.source_page_id, sq.target_page_id, sq.facebook_post_id, sq.post_type, sq.created_at,
                   ps_source.share_schedule_minutes, ps_target.post_token as target_token
            FROM share_queue sq
            JOIN page_settings ps_source ON sq.source_page_id = ps_source.page_id
            JOIN page_settings ps_target ON sq.target_page_id = ps_target.page_id
            WHERE sq.status = 'pending'
        `).all<any>();

        for (const item of pendingShares.results || []) {
            const shareMins = (item.share_schedule_minutes || '').split(',').map((m: string) => parseInt(m.trim())).filter((m: number) => !isNaN(m));
            if (!shareMins.includes(currentMinute) && !forcePost) continue;
            if (!item.target_token) continue;

            // Skip if created less than 1 minute ago (wait for next share cycle)
            const createdAt = new Date(item.created_at);
            const ageMs = now.getTime() - createdAt.getTime();
            if (ageMs < 60000 && !forcePost) {
                console.log(`[cron-auto-post] Skipping share ${item.id}: created ${Math.round(ageMs / 1000)}s ago, waiting for next cycle`);
                continue;
            }

            try {
                const sharedPostId = await sharePost(item.facebook_post_id, item.target_page_id, item.target_token);
                await c.env.DB.prepare(`UPDATE share_queue SET status = 'shared', shared_post_id = ?, shared_at = ? WHERE id = ?`)
                    .bind(sharedPostId, now.toISOString(), item.id).run();
                shareResults.push({ target_page_id: item.target_page_id, status: 'shared', shared_post_id: sharedPostId });
            } catch (err) {
                await c.env.DB.prepare(`UPDATE share_queue SET status = 'failed', error_message = ? WHERE id = ?`)
                    .bind(err instanceof Error ? err.message : String(err), item.id).run();
                shareResults.push({ target_page_id: item.target_page_id, status: 'failed', error: err instanceof Error ? err.message : String(err) });
            }
        }
    } catch (err) {
        console.error('[cron-auto-post] Error processing share queue:', err);
    }

    return c.json({ success: true, processed, results, shareResults });
});

export { app as cronAutoPostRouter };
