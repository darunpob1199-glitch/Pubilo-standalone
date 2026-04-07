import { useEffect, useState } from 'react'
import { fetchEarnings } from '../api'
import type { Earnings, Page } from '../api'

interface Props { pages: Page[] }

export default function EarningsTab({ pages }: Props) {
    const [earnings, setEarnings] = useState<Earnings[]>([])
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
        fetchEarnings(selectedPage || undefined).then(setEarnings).finally(() => setLoading(false))
    }, [selectedPage])

    const pageMap = Object.fromEntries(pages.map(p => [p.id, p.name]))
    const total = earnings.reduce((s, e) => s + (e.amount || 0), 0)

    // Group by date
    const byDate = earnings.reduce<Record<string, Earnings[]>>((acc, e) => {
        const d = e.date
        if (!acc[d]) acc[d] = []
        acc[d].push(e)
        return acc
    }, {})

    const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))

    return (
        <div className="px-4 py-4 safe-bottom">
            <div className="flex items-center justify-between mb-4">
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>รายได้</h2>
                <div className="text-right">
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>รวม</p>
                    <p className="text-sm font-bold" style={{ color: 'var(--accent2)' }}>
                        ฿{total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </p>
                </div>
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
                    {pages.filter(p => p.has_token || p.auto_schedule).map(p => (
                        <button
                            key={p.id}
                            onClick={() => handleSelectPage(p.id)}
                            className="px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap tap-scale"
                            style={{
                                background: selectedPage === p.id ? 'var(--accent)' : 'var(--surface)',
                                color: selectedPage === p.id ? 'white' : 'var(--muted)'
                            }}
                        >
                            {p.name.length > 10 ? p.name.slice(0, 10) + '…' : p.name}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-8 h-8 border-2 rounded-full spin" style={{ borderColor: 'rgba(0,0,0,0.1)', borderTopColor: 'var(--accent)' }} />
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>กำลังโหลด...</p>
                </div>
            ) : earnings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                    <p className="text-3xl">💰</p>
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>ยังไม่มีข้อมูลรายได้</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {dates.map(date => {
                        const dayEarnings = byDate[date]
                        const dayTotal = dayEarnings.reduce((s, e) => s + (e.amount || 0), 0)
                        return (
                            <div key={date}>
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                                        {new Date(date + 'T00:00:00').toLocaleDateString('th-TH', {
                                            weekday: 'short', day: 'numeric', month: 'short'
                                        })}
                                    </p>
                                    <p className="text-xs font-bold" style={{ color: '#22c55e' }}>
                                        ฿{dayTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    {dayEarnings.map(e => (
                                        <div
                                            key={e.id}
                                            className="flex items-center justify-between p-3 rounded-2xl"
                                            style={{ background: 'var(--surface)' }}
                                        >
                                            <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }} className="truncate">{pageMap[e.page_id] || e.page_id}</p>
                                            <p className="text-sm font-bold shrink-0 ml-2" style={{ color: '#22c55e' }}>
                                                ฿{(e.amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
