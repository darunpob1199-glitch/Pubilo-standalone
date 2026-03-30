import { Hono } from 'hono';
import { Env } from '../index';
import { decryptSecret } from '../lib/encryption';
import { getWorkspaceId } from '../lib/workspace';

const app = new Hono<{ Bindings: Env }>();

interface TokenHealthResult {
    page_id: string;
    page_name: string;
    has_token: boolean;
    token_valid: boolean;
    error?: string;
    expires_at?: string;
    scopes?: string[];
}

// GET /api/token-health - Check token validity for all pages
app.get('/', async (c) => {
    try {
        const workspaceId = getWorkspaceId(c);
        // Get all pages with their tokens
        const pagesResult = await c.env.DB.prepare(`
            SELECT page_id, page_name, post_token_encrypted
            FROM page_settings
            WHERE organization_id = ?
              AND post_token_encrypted IS NOT NULL
              AND post_token_encrypted != ''
        `).bind(workspaceId).all<{ page_id: string; page_name: string; post_token_encrypted: string }>();

        const pages = pagesResult.results || [];
        const results: TokenHealthResult[] = [];

        for (const page of pages) {
            const pageToken = await decryptSecret(c.env, page.post_token_encrypted);
            const result: TokenHealthResult = {
                page_id: page.page_id,
                page_name: page.page_name || 'Unknown',
                has_token: !!pageToken,
                token_valid: false,
            };

            if (!pageToken) {
                result.error = 'No token';
                results.push(result);
                continue;
            }

            try {
                // Use Facebook Graph API to validate token
                // Simple check: try to get page info
                const response = await fetch(
                    `https://graph.facebook.com/v21.0/${page.page_id}?fields=id,name&access_token=${pageToken}`
                );
                const data = await response.json() as any;

                if (data.error) {
                    result.token_valid = false;
                    result.error = `${data.error.message} (Code: ${data.error.code})`;
                    
                    // Common error codes:
                    // 190 = Invalid/expired token
                    // 100 = Invalid parameter
                    // 200 = Permission error
                    if (data.error.code === 190) {
                        result.error = '❌ Token หมดอายุหรือถูกยกเลิก';
                    } else if (data.error.code === 200) {
                        result.error = '⚠️ ไม่มีสิทธิ์เข้าถึงเพจนี้';
                    }
                } else if (data.id) {
                    result.token_valid = true;
                    
                    // Try to get more token info
                    try {
                        const debugResponse = await fetch(
                            `https://graph.facebook.com/v21.0/debug_token?input_token=${pageToken}&access_token=${pageToken}`
                        );
                        const debugData = await debugResponse.json() as any;
                        
                        if (debugData.data) {
                            if (debugData.data.expires_at) {
                                const expiresAt = new Date(debugData.data.expires_at * 1000);
                                result.expires_at = expiresAt.toISOString();
                                
                                // Check if expiring soon (within 7 days)
                                const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                                if (daysUntilExpiry < 7 && daysUntilExpiry > 0) {
                                    result.error = `⚠️ Token จะหมดอายุใน ${Math.floor(daysUntilExpiry)} วัน`;
                                } else if (daysUntilExpiry <= 0) {
                                    result.token_valid = false;
                                    result.error = '❌ Token หมดอายุแล้ว';
                                }
                            }
                            if (debugData.data.scopes) {
                                result.scopes = debugData.data.scopes;
                            }
                        }
                    } catch {
                        // Debug token failed, but main token works
                    }
                }
            } catch (err) {
                result.error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
            }

            results.push(result);
        }

        // Summary
        const validCount = results.filter(r => r.token_valid).length;
        const invalidCount = results.filter(r => !r.token_valid).length;
        const expiringCount = results.filter(r => r.error?.includes('จะหมดอายุ')).length;

        return c.json({
            success: true,
            summary: {
                total: results.length,
                valid: validCount,
                invalid: invalidCount,
                expiring_soon: expiringCount,
            },
            pages: results,
            checked_at: new Date().toISOString(),
        });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export { app as tokenHealthRouter };
