import { Hono } from 'hono';
import { Env } from '../index';
import { decryptSecret } from '../lib/encryption';

const app = new Hono<{ Bindings: Env }>();

// Cron endpoint for fetching earnings from Facebook
app.get('/', async (c) => {
    const shouldNotify = c.req.query('notify') !== 'false';

    try {
        // Use Thailand timezone (UTC+7)
        const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const today = now.toISOString().split('T')[0];

        // Get pages with post_token
        const pages = await c.env.DB.prepare(`
            SELECT organization_id, page_id, page_name, post_token_encrypted, page_color 
            FROM page_settings 
            WHERE auto_schedule = 1 AND post_token_encrypted IS NOT NULL
        `).all<{ organization_id: string; page_id: string; page_name: string; post_token_encrypted: string; page_color: string }>();

        if (!pages.results?.length) {
            return c.json({ success: true, message: 'No pages with auto_schedule enabled', count: 0 });
        }

        const results: any[] = [];

        for (const page of pages.results) {
            try {
                const postToken = await decryptSecret(c.env, page.post_token_encrypted);
                if (!postToken) {
                    results.push({ pageId: page.page_id, pageName: page.page_name, error: 'Missing page token' });
                    continue;
                }
                const fbUrl = `https://graph.facebook.com/v21.0/${page.page_id}/insights?metric=monetization_approximate_earnings&access_token=${postToken}`;
                const fbResponse = await fetch(fbUrl);
                const fbData = await fbResponse.json() as any;

                if (fbData.error) {
                    results.push({ pageId: page.page_id, pageName: page.page_name, error: fbData.error.message });
                    continue;
                }

                const dailyData = fbData.data?.find((d: any) => d.period === 'day');
                const weeklyData = fbData.data?.find((d: any) => d.period === 'week');
                const monthlyData = fbData.data?.find((d: any) => d.period === 'days_28');

                const latestDaily = dailyData?.values?.[dailyData.values.length - 1];
                const dailyEarnings = latestDaily?.value || 0;
                const dailyDate = latestDaily?.end_time?.split('T')[0] || today;
                const weeklyEarnings = weeklyData?.values?.[weeklyData.values.length - 1]?.value || 0;
                const monthlyEarnings = monthlyData?.values?.[monthlyData.values.length - 1]?.value || 0;

                // Upsert earnings
                await c.env.DB.prepare(`
                    INSERT INTO earnings_history (organization_id, page_id, page_name, date, daily_earnings, weekly_earnings, monthly_earnings)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(organization_id, page_id, date) DO UPDATE SET 
                        daily_earnings = excluded.daily_earnings,
                        weekly_earnings = excluded.weekly_earnings,
                        monthly_earnings = excluded.monthly_earnings
                `).bind(page.organization_id, page.page_id, page.page_name, dailyDate, dailyEarnings, weeklyEarnings, monthlyEarnings).run();

                results.push({
                    pageId: page.page_id,
                    pageName: page.page_name,
                    pageColor: page.page_color || '#666666',
                    daily: dailyEarnings,
                    weekly: weeklyEarnings,
                    monthly: monthlyEarnings,
                    date: dailyDate,
                    saved: true
                });
            } catch (err) {
                results.push({ pageId: page.page_id, error: err instanceof Error ? err.message : String(err) });
            }
        }

        // Send LINE notification if shouldNotify and we have data
        if (shouldNotify && results.length > 0) {
            const LINE_TOKEN = c.env.LINE_CHANNEL_ACCESS_TOKEN;
            const LINE_USER_ID = c.env.LINE_USER_ID;

            if (LINE_TOKEN && LINE_USER_ID) {
                // Check if we already sent notification today
                const notificationCheck = await c.env.DB.prepare(`
                    SELECT COUNT(*) as count FROM earnings_notifications 
                    WHERE date = ? AND sent = 1
                `).bind(today).first<{ count: number }>();

                if (notificationCheck && notificationCheck.count > 0) {
                    console.log('[cron-earnings] Notification already sent today, skipping');
                    return c.json({
                        success: true,
                        date: today,
                        processed: pages.results.length,
                        results,
                        notification: 'already_sent_today'
                    });
                }
                // Calculate totals
                let totalDaily = 0;
                let totalWeekly = 0;
                let totalMonthly = 0;
                const validResults = results.filter(r => r.saved);

                for (const r of validResults) {
                    totalDaily += r.daily || 0;
                    totalWeekly += r.weekly || 0;
                    totalMonthly += r.monthly || 0;
                }

                // Build page contents for Flex Message
                const pageContents = validResults.map((r) => ({
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                        { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '●', size: 'xs', color: r.pageColor || '#666666' }], width: '20px', alignItems: 'center', justifyContent: 'center' },
                        { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: (r.pageName || r.pageId).slice(0, 8), size: 'sm', color: '#333333' }], flex: 4 },
                        { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: `$${(r.daily || 0).toFixed(2)}`, size: 'md', color: r.pageColor || '#666666', weight: 'bold', align: 'end' }], flex: 3 }
                    ],
                    backgroundColor: '#F8F9FA',
                    paddingAll: 'md',
                    cornerRadius: 'lg',
                    margin: 'sm'
                }));

                // Use actual date from Facebook data
                const fbDate = validResults[0]?.date || today;
                const displayDate = new Date(fbDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

                const flexMessage = {
                    type: 'flex',
                    altText: `💰 รายได้วันนี้: $${totalDaily.toFixed(2)}`,
                    contents: {
                        type: 'bubble',
                        size: 'mega',
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                {
                                    type: 'box', layout: 'horizontal', contents: [
                                        { type: 'text', text: '💰 Earnings (Cron)', size: 'md', color: '#333333', weight: 'bold', flex: 1 },
                                        { type: 'text', text: displayDate, size: 'xs', color: '#999999', align: 'end', gravity: 'center' }
                                    ], paddingBottom: 'lg'
                                },
                                {
                                    type: 'box', layout: 'vertical', contents: [
                                        { type: 'text', text: 'TODAY TOTAL', size: 'xxs', color: '#1DB954', weight: 'bold' },
                                        { type: 'text', text: `$${totalDaily.toFixed(2)}`, size: '3xl', weight: 'bold', color: '#1DB954' }
                                    ], backgroundColor: '#E8F5E9', paddingAll: 'lg', cornerRadius: 'lg', alignItems: 'center'
                                },
                                {
                                    type: 'box', layout: 'horizontal', contents: [
                                        {
                                            type: 'box', layout: 'vertical', contents: [
                                                { type: 'text', text: 'WEEKLY', size: 'xxs', color: '#2196F3', weight: 'bold' },
                                                { type: 'text', text: `$${totalWeekly.toFixed(2)}`, size: 'lg', weight: 'bold', color: '#2196F3' }
                                            ], flex: 1, backgroundColor: '#E3F2FD', paddingAll: 'md', cornerRadius: 'lg', alignItems: 'center'
                                        },
                                        {
                                            type: 'box', layout: 'vertical', contents: [
                                                { type: 'text', text: '28-DAY', size: 'xxs', color: '#FF5722', weight: 'bold' },
                                                { type: 'text', text: `$${totalMonthly.toFixed(2)}`, size: 'lg', weight: 'bold', color: '#FF5722' }
                                            ], flex: 1, backgroundColor: '#FBE9E7', paddingAll: 'md', cornerRadius: 'lg', alignItems: 'center', margin: 'sm'
                                        }
                                    ], paddingTop: 'md'
                                },
                                { type: 'separator', color: '#EEEEEE', margin: 'lg' },
                                { type: 'text', text: 'PAGES', size: 'xs', color: '#999999', margin: 'lg' },
                                ...pageContents
                            ],
                            paddingAll: 'lg',
                            backgroundColor: '#ffffff'
                        }
                    }
                };

                try {
                    const response = await fetch('https://api.line.me/v2/bot/message/push', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
                        body: JSON.stringify({ to: LINE_USER_ID, messages: [flexMessage] })
                    });

                    if (response.ok) {
                        // Record that we sent notification today
                        await c.env.DB.prepare(`
                            INSERT INTO earnings_notifications (date, sent, sent_at) 
                            VALUES (?, 1, ?)
                            ON CONFLICT(date) DO UPDATE SET sent = 1, sent_at = excluded.sent_at
                        `).bind(today, new Date().toISOString()).run();
                        console.log('[cron-earnings] LINE notification sent with total: $' + totalDaily.toFixed(2));
                    } else {
                        console.error('[cron-earnings] LINE notification failed:', response.status);
                    }
                } catch (err) {
                    console.error('[cron-earnings] LINE notification error:', err);
                }
            }
        }

        return c.json({ success: true, date: today, processed: pages.results.length, results });
    } catch (err) {
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

export { app as cronEarningsRouter };
