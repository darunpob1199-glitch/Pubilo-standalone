import { Hono } from 'hono';
import { Env } from '../index';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

const riskyPatterns: { pattern: RegExp; category: string }[] = [
    { pattern: /เย็ด/gi, category: 'sexual-explicit' },
    { pattern: /หี/gi, category: 'sexual-explicit' },
    { pattern: /ควย/gi, category: 'sexual-explicit' },
    { pattern: /เงี่ยน/gi, category: 'sexual-explicit' },
    { pattern: /โป๊/gi, category: 'sexual-explicit' },
    { pattern: /xxx/gi, category: 'sexual-explicit' },
    { pattern: /ข่มขืน/gi, category: 'sexual-explicit' },
    { pattern: /\bporn/gi, category: 'sexual-explicit' },
    { pattern: /\bnude/gi, category: 'sexual-explicit' },
    { pattern: /fuck/gi, category: 'sexual-explicit' },
    { pattern: /ฆ่าตัวตาย/gi, category: 'self-harm' },
    { pattern: /กรีดข้อมือ/gi, category: 'self-harm' },
    { pattern: /ยาบ้า/gi, category: 'drugs' },
    { pattern: /เฮโรอีน/gi, category: 'drugs' },
    { pattern: /โคเคน/gi, category: 'drugs' },
];

app.get('/', async (c) => {
    const action = c.req.query('action');

    try {
        const workspaceId = getWorkspaceId(c);
        const allQuotes = await c.env.DB.prepare(`
            SELECT id, quote_text
            FROM quotes
            WHERE organization_id = ?
        `).bind(workspaceId).all<{ id: number; quote_text: string }>();
        const quotes = allQuotes.results || [];

        const riskyQuotes: any[] = [];
        for (const quote of quotes) {
            const text = quote.quote_text || '';
            for (const { pattern, category } of riskyPatterns) {
                pattern.lastIndex = 0;
                const match = text.match(pattern);
                if (match) {
                    riskyQuotes.push({ id: quote.id, text, category, matched: match[0] });
                    break;
                }
            }
        }

        if (action === 'delete' && riskyQuotes.length > 0) {
            const ids = riskyQuotes.map(q => q.id);
            for (const id of ids) {
                await c.env.DB.prepare(`DELETE FROM quotes WHERE organization_id = ? AND id = ?`).bind(workspaceId, id).run();
            }
            return c.json({ success: true, action: 'deleted', totalScanned: quotes.length, deletedCount: riskyQuotes.length, deletedQuotes: riskyQuotes });
        }

        return c.json({ success: true, action: 'scan', totalScanned: quotes.length, riskyCount: riskyQuotes.length, riskyQuotes });
    } catch (err) {
        return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
});

export { app as checkRiskyQuotesRouter };
