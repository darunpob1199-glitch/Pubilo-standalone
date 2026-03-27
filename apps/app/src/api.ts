const configuredApiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim()

export const API = configuredApiBase
    ? configuredApiBase.replace(/\/+$/, '')
    : 'https://api.pubilo.com'

export interface Page {
    id: string
    name: string
    picture?: { data?: { url?: string } }
    color: string
    auto_schedule: number
    has_token: boolean
    schedule_interval?: number   // minutes between posts, e.g. 60
}

export interface Quote {
    id: number
    quote_text: string
    used_by_pages?: string
    created_at: string
}

export interface Log {
    id: number
    page_id: string
    post_type: string
    quote_text: string
    status: string
    facebook_post_id?: string
    error_message?: string
    created_at: string
    share_status?: string
}

export interface PageSetting {
    page_id: string
    page_name: string
    post_token?: string
    hide_token?: string
    comment_token?: string
    auto_schedule: number
    schedule_minutes?: string  // post_hours as comma-separated HH:MM
    working_hours_start?: number
    working_hours_end?: number
    ai_model?: string
    ai_resolution?: string
    link_image_size?: string
    image_image_size?: string
    post_mode?: string          // 'link' | 'image' | 'news' | 'auto'
    image_source?: string       // 'ai' | 'shopee'
    color_bg?: number
    share_page_id?: string
    share_mode?: string
    news_analysis_prompt?: string
    news_generation_prompt?: string
    news_image_size?: string
    news_variation_count?: number
    hide_types?: string
    og_background_url?: string
    og_font?: string
    page_color?: string
    picture_url?: string
}

export interface Earnings {
    id: number
    page_id: string
    date: string
    amount: number
    currency: string
}

export const fetchPages = async (): Promise<Page[]> => {
    const r = await fetch(`${API}/api/pages`)
    const d = await r.json() as any
    return d.pages || []
}

export const fetchQuotes = async (filter?: string, limit = 30): Promise<{ quotes: Quote[], total: number, unusedCount: number, usedCount: number }> => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (filter) params.set('filter', filter)
    const r = await fetch(`${API}/api/quotes?${params}`)
    return r.json()
}

export const addQuote = async (content: string) => {
    const r = await fetch(`${API}/api/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    })
    return r.json()
}

export const deleteQuote = async (id: number) => {
    await fetch(`${API}/api/quotes/${id}`, { method: 'DELETE' })
}

export const fetchLogs = async (pageId?: string, limit = 50): Promise<Log[]> => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (pageId) params.set('pageId', pageId)
    const r = await fetch(`${API}/api/logs?${params}`)
    const d = await r.json() as any
    return d.logs || []
}

export const fetchPageSetting = async (pageId: string): Promise<PageSetting | null> => {
    const r = await fetch(`${API}/api/page-settings?pageId=${pageId}`)
    const d = await r.json() as any
    return d.settings || null
}

export const savePageSetting = async (pageId: string, data: Partial<PageSetting> & Record<string, any>) => {
    const body: Record<string, any> = { pageId }
    if (data.auto_schedule !== undefined) body.autoSchedule = data.auto_schedule
    if (data.schedule_minutes !== undefined) body.scheduleMinutes = data.schedule_minutes
    if (data.post_token !== undefined) body.postToken = data.post_token
    if (data.hide_token !== undefined) body.hideToken = data.hide_token
    if (data.working_hours_start !== undefined) body.workingHoursStart = data.working_hours_start
    if (data.working_hours_end !== undefined) body.workingHoursEnd = data.working_hours_end
    if (data.post_mode !== undefined) body.postMode = data.post_mode
    if (data.image_source !== undefined) body.imageSource = data.image_source
    if (data.ai_model !== undefined) body.aiModel = data.ai_model
    if (data.ai_resolution !== undefined) body.aiResolution = data.ai_resolution
    if (data.link_image_size !== undefined) body.linkImageSize = data.link_image_size
    if (data.image_image_size !== undefined) body.imageImageSize = data.image_image_size
    if (data.color_bg !== undefined) body.colorBg = data.color_bg
    if (data.share_page_id !== undefined) body.sharePageId = data.share_page_id
    if (data.share_mode !== undefined) body.shareMode = data.share_mode
    if (data.news_analysis_prompt !== undefined) body.newsAnalysisPrompt = data.news_analysis_prompt
    if (data.news_generation_prompt !== undefined) body.newsGenerationPrompt = data.news_generation_prompt
    if (data.news_image_size !== undefined) body.newsImageSize = data.news_image_size
    if (data.news_variation_count !== undefined) body.newsVariationCount = data.news_variation_count
    if (data.hide_types !== undefined) body.hideTypes = data.hide_types
    if (data.og_background_url !== undefined) body.ogBackgroundUrl = data.og_background_url
    if (data.og_font !== undefined) body.ogFont = data.og_font
    if (data.page_color !== undefined) body.pageColor = data.page_color
    const r = await fetch(`${API}/api/page-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    return r.json()
}

export const deletePage = async (pageId: string) => {
    const r = await fetch(`${API}/api/page-settings?pageId=${pageId}`, {
        method: 'DELETE',
    })
    if (!r.ok) {
        throw new Error(`Failed to delete: ${r.status}`)
    }
    // Handle 204 No Content or empty bodies
    const text = await r.text()
    if (!text) return { success: true }
    try {
        return JSON.parse(text)
    } catch {
        return { success: true }
    }
}

export const fetchEarnings = async (pageId?: string): Promise<Earnings[]> => {
    const params = pageId ? `?pageId=${pageId}` : ''
    const r = await fetch(`${API}/api/earnings${params}`)
    const d = await r.json() as any
    return d.earnings || []
}

export const getTodayTH = () => {
    return new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0]
}

export const importPages = async (token: string) => {
    try {
        // Fetch pages from Facebook Graph API
        const r = await fetch(
            `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,picture,category&limit=100&access_token=${token}`
        )
        const data = await r.json() as any
        if (data.error) return { success: false, error: data.error.message }

        const fbPages: any[] = data.data || []
        let imported = 0, updated = 0

        for (const page of fbPages) {
            const pageToken = page.access_token || token
            const picUrl = page.picture?.data?.url || ''
            const colors = ['#f59e0b', '#6366f1', '#22c55e', '#ef4444', '#ec4899', '#14b8a6', '#f97316']
            const color = colors[Math.abs(parseInt(page.id.slice(-4), 16)) % colors.length]

            // Check if page already exists by checking page-settings
            const check = await fetch(`${API}/api/page-settings?pageId=${page.id}`)
            const checkData = await check.json() as any

            // Save/update settings
            await fetch(`${API}/api/page-settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: page.id,
                    pageName: page.name,
                    pageColor: color,
                    pictureUrl: picUrl,
                    postToken: pageToken,
                })
            })

            if (checkData.settings?.page_name) updated++
            else imported++
        }
        return { success: true, imported, updated }
    } catch (e) {
        return { success: false, error: String(e) }
    }
}

export const triggerAutoPost = async () => {
    const r = await fetch(`${API}/api/cron/auto-post`, { method: 'GET' })
    return r.json()
}

export const checkTokenHealth = async () => {
    const r = await fetch(`${API}/api/token-health`)
    return r.json()
}
