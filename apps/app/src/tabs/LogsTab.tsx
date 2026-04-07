import { useEffect, useState } from 'react'
import { fetchLogs } from '../api'
import type { Log, Page } from '../api'

interface Props { pages: Page[] }

const statusColor: Record<string, string> = {
    success: '#22c55e',
    posted: '#22c55e',
    failed: '#ef4444',
    error: '#ef4444',
    skipped: '#f59e0b',
    pending: '#6366f1',
}

const statusLabel: Record<string, string> = {
    success: '✅ สำเร็จ',
    posted: '✅ โพสต์แล้ว',
    failed: '❌ ล้มเหลว',
    error: '❌ Error',
    skipped: '⏭ ข้าม',
    pending: '⏳ รอ',
}

export default function LogsTab({ pages }: Props) {
    const [logs, setLogs] = useState<Log[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedPage, setSelectedPage] = useState<string>('')

    const handleSelectPage = (pageId: string) => {
        setSelectedPage((prev) => {
            if (prev === pageId) return prev
            setLoading(true)
            return pageId
        })
    }

    useEffect(() => {
        fetchLogs(selectedPage || undefined)
            .then(setLogs)
            .finally(() => setLoading(false))
    }, [selectedPage])

    const pageMap = Object.fromEntries(pages.map(p => [p.id, p.name]))

    return (
        <div className="px-4 py-4 safe-bottom">
            <div className="flex items-center justify-between mb-4">
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>ประวัติโพสต์</h2>
            </div>

            {/* Page filter */}
            <div className="overflow-x-auto pb-2 mb-4">
                <div className="flex gap-2" style={{ width: 'max-content' }}>
                    <button
                        onClick={() => handleSelectPage('')}
                        className="px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap tap-scale"
                        style={{ background: !selectedPage ? 'var(--accent)' : 'var(--surface)', color: !selectedPage ? 'white' : 'var(--muted)' }}
                    >
                        ทุกเพจ
                    </button>
                    {pages.map(p => (
                        <button
                            key={p.id}
                            onClick={() => handleSelectPage(p.id)}
                            className="px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap tap-scale"
                            style={{
                                background: selectedPage === p.id ? 'var(--accent)' : 'var(--surface)',
                                color: selectedPage === p.id ? 'white' : 'var(--muted)'
                            }}
                        >
                            {p.name.length > 12 ? p.name.slice(0, 12) + '…' : p.name}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-8 h-8 border-2 rounded-full spin" style={{ borderColor: 'rgba(0,0,0,0.1)', borderTopColor: 'var(--accent)' }} />
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>กำลังโหลด...</p>
                </div>
            ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                    <p className="text-3xl">📋</p>
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>ยังไม่มีประวัติ</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {logs.map((log) => (
                        <div
                            key={log.id}
                            className="rounded-2xl p-4"
                            style={{ background: 'var(--surface)' }}
                        >
                            <div className="flex items-start justify-between gap-2 mb-2">
                                <p className="text-xs font-semibold truncate" style={{ color: 'var(--accent2)' }}>
                                    {pageMap[log.page_id] || log.page_id}
                                </p>
                                <span
                                    className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                                    style={{ background: `${statusColor[log.status] || '#6366f1'}20`, color: statusColor[log.status] || '#6366f1' }}
                                >
                                    {statusLabel[log.status] || log.status}
                                </span>
                            </div>
                            <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.6 }} className="line-clamp-3">
                                {log.quote_text || '—'}
                            </p>
                            {log.error_message && (
                                <p className="text-xs mt-2 p-2 rounded-xl" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                                    {log.error_message}
                                </p>
                            )}
                            <div className="flex items-center justify-between mt-2">
                                <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                                    {new Date(log.created_at).toLocaleString('th-TH', {
                                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                                    })}
                                </span>
                                {log.facebook_post_id && (
                                    <a
                                        href={`https://facebook.com/${log.facebook_post_id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[10px] font-semibold"
                                        style={{ color: 'var(--accent2)' }}
                                    >
                                        ดูโพสต์ →
                                    </a>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
