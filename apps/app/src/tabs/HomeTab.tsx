import { useEffect, useState } from 'react'
import {
    fetchEarnings, triggerAutoPost, checkTokenHealth,
} from '../api'
import type { Page, Earnings, TokenHealth } from '../api'

interface Props {
    pages: Page[]
    loadingPages: boolean
    onRefreshPages: () => void
}

export default function HomeTab({ pages }: Props) {
    const [earnings, setEarnings] = useState<Earnings[]>([])
    const [posting, setPosting] = useState(false)
    const [postMsg, setPostMsg] = useState('')
    const [health, setHealth] = useState<TokenHealth | null>(null)

    useEffect(() => {
        fetchEarnings().then(setEarnings)
        checkTokenHealth().then(d => setHealth(d))
    }, [])

    const todayTH = new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0]
    const todayEarnings = earnings.filter(e => e.date === todayTH)
    const totalToday = todayEarnings.reduce((s, e) => s + (e.amount || 0), 0)
    const totalAllTime = earnings.reduce((s, e) => s + (e.amount || 0), 0)
    const activePages = pages.filter(p => p.auto_schedule)

    const handlePost = async () => {
        setPosting(true)
        setPostMsg('')
        try {
            const d = await triggerAutoPost()
            setPostMsg(d.message || (d.success ? 'สำเร็จ!' : 'ไม่มีโพสต์ใหม่'))
        } catch {
            setPostMsg('เชื่อมต่อไม่ได้')
        } finally {
            setPosting(false)
            setTimeout(() => setPostMsg(''), 3000)
        }
    }

    return (
        <div style={{ padding: '16px', paddingBottom: 80, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Dashboard</h1>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Facebook Auto-Post Manager</p>
                </div>
                <div style={{
                    width: 40, height: 40, borderRadius: 16,
                    background: '#1877f2',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                </div>
            </div>

            {/* Earnings Card — dark card like dubbing "Available Credits" */}
            <div style={{
                background: '#1a1a2e',
                borderRadius: 20,
                padding: '20px',
            }}>
                <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>รายได้วันนี้</p>
                <p style={{ margin: '8px 0 0', fontSize: 36, fontWeight: 700, color: '#ffffff', lineHeight: 1.1 }}>
                    ฿{totalToday.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                    <button style={{
                        flex: 1,
                        background: '#2563eb',
                        color: 'white',
                        border: 'none',
                        borderRadius: 12,
                        padding: '10px 0',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                    }} onClick={handlePost} disabled={posting}>
                        {posting ? '...' : '🚀 โพสต์เลย'}
                    </button>
                    <button style={{
                        flex: 1,
                        background: 'rgba(255,255,255,0.12)',
                        color: 'rgba(255,255,255,0.8)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 12,
                        padding: '10px 0',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                    }}>
                        รวม ฿{totalAllTime.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </button>
                </div>
            </div>

            {postMsg && (
                <p style={{
                    margin: 0, textAlign: 'center', fontSize: 13,
                    color: postMsg.includes('สำเร็จ') ? 'var(--green)' : 'var(--muted)'
                }} className="anim-fade-in">{postMsg}</p>
            )}

            {/* Stats Row — same as dubbing "Total Dubbed / Success Rate" */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[
                    { label: 'เพจทั้งหมด', value: pages.length, color: '#2563eb' },
                    { label: 'Auto On', value: activePages.length, color: '#16a34a' },
                    { label: 'มีToken', value: pages.filter(p => p.has_token).length, color: '#d97706' },
                ].map(s => (
                    <div key={s.label} className="card" style={{ padding: '14px 8px', textAlign: 'center' }}>
                        <p style={{ margin: 0, fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</p>
                        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>{s.label}</p>
                    </div>
                ))}
            </div>

            {/* Token Health */}
            {health && (
                <div className="card" style={{ padding: 16 }}>
                    <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.05em' }}>TOKEN HEALTH</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
                        <div>
                            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{health.healthy || 0}</p>
                            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>✅ ดี</p>
                        </div>
                        <div>
                            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#d97706' }}>{health.expiring_soon || 0}</p>
                            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>⚠️ ใกล้หมด</p>
                        </div>
                        <div>
                            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#dc2626' }}>{health.expired || 0}</p>
                            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>❌ หมด</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Active Pages List */}
            {activePages.length > 0 && (
                <div>
                    <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.05em' }}>ACTIVE PAGES</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {activePages.slice(0, 5).map(p => (
                            <div key={p.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
                                <div style={{ width: 36, height: 36, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
                                    {p.picture?.data?.url ? (
                                        <img src={p.picture.data.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <div style={{
                                            width: '100%', height: '100%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            background: p.color || 'var(--accent)',
                                            color: 'white', fontSize: 14, fontWeight: 700,
                                        }}>{p.name[0]}</div>
                                    )}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                                </div>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
