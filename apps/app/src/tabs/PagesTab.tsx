import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchPageSetting, savePageSetting, importPages, deletePage } from '../api'
import type { Page } from '../api'
import { BackIcon, SmallSpinner } from '../icons'

interface Props {
    pages: Page[]
    onRefresh: () => void
}

// ---- Helpers ----
const Divider = () => <div style={{ height: 1, background: 'var(--border)', margin: '0 16px' }} />

const ToggleRow = ({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}>
        <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{label}</p>
            {sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--muted)' }}>{sub}</p>}
        </div>
        <button
            onClick={() => onChange(!value)}
            style={{
                width: 48, height: 27, borderRadius: 14, border: 'none', cursor: 'pointer',
                background: value ? 'var(--accent)' : '#d1d5db',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }}
        >
            <div style={{
                position: 'absolute', top: 3,
                left: value ? 24 : 3,
                width: 21, height: 21, borderRadius: '50%', background: 'white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
            }} />
        </button>
    </div>
)

const SelectRow = ({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{label}</p>
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            style={{
                border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px',
                fontSize: 13, background: 'var(--surface2)', color: 'var(--text)',
                outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
            }}
        >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    </div>
)

// Paste-only field — no keyboard ever shows
const PasteField = ({ value, onChange, placeholder, mono, tall }: {
    value: string; onChange: (v: string) => void
    placeholder?: string; mono?: boolean; tall?: boolean
}) => (
    <div style={{ position: 'relative' }}>
        <div
            contentEditable
            suppressContentEditableWarning
            inputMode="none"
            onPaste={(e) => {
                e.preventDefault()
                const text = e.clipboardData.getData('text/plain').trim()
                if (text) onChange(text)
            }}
            onBeforeInput={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
            style={{
                minHeight: tall ? 88 : 44,
                borderRadius: 10, padding: '10px 12px',
                fontSize: mono ? 11 : 13,
                fontFamily: mono ? 'monospace' : 'inherit',
                background: 'var(--surface2)', border: '1px solid var(--border)',
                color: 'var(--text)', outline: 'none',
                wordBreak: 'break-all', lineHeight: 1.6,
                WebkitUserSelect: 'text', userSelect: 'text',
            } as React.CSSProperties}
        >
            {value && <span>{value}</span>}
        </div>
        {!value && (
            <p style={{
                position: 'absolute',
                top: tall ? 10 : '50%',
                left: 12,
                transform: tall ? 'none' : 'translateY(-50%)',
                margin: 0, fontSize: mono ? 11 : 13,
                color: 'rgba(0,0,0,0.3)', pointerEvents: 'none',
            } as React.CSSProperties}>{placeholder}</p>
        )}
    </div>
)

// +/- stepper for number fields — no keyboard
const StepperField = ({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40 }}>
        <button onClick={() => onChange(Math.max(min, value - 1))}
            style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: 'var(--surface2)', color: 'var(--text)', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>−</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
        <button onClick={() => onChange(Math.min(max, value + 1))}
            style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: 'var(--surface2)', color: 'var(--text)', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>+</button>
    </div>
)

function PageDetail({ page, onBack, onDeleted }: { page: Page; onBack: () => void; onDeleted: () => void }) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saveMsg, setSaveMsg] = useState('')
    const [openSection, setOpenSection] = useState<string | null>(null)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [deleting, setDeleting] = useState(false)

    // All settings
    const [isActive, setIsActive] = useState(false)
    const [postToken, setPostToken] = useState('')
    const [hideToken, setHideToken] = useState('')
    const [hourMinutes, setHourMinutes] = useState<Record<number, number>>({})
    const [workStart, setWorkStart] = useState(6)
    const [workEnd, setWorkEnd] = useState(24)

    // Post mode
    const [postMode, setPostMode] = useState('link')
    const [imageSource, setImageSource] = useState('ai')
    const [colorBg, setColorBg] = useState(false)

    // Auto hide
    const [hideEnabled, setHideEnabled] = useState(false)
    const [hideTypes, setHideTypes] = useState('')

    // Prompts
    const [linkPrompt, setLinkPrompt] = useState('')
    const [imagePrompt, setImagePrompt] = useState('')
    const [newsAnalysisPrompt, setNewsAnalysisPrompt] = useState('')
    const [newsGenPrompt, setNewsGenPrompt] = useState('')

    // AI Image
    const [aiModel, setAiModel] = useState('gemini-2.0-flash-exp')
    const [aiResolution, setAiResolution] = useState('2K')
    const [linkImageSize, setLinkImageSize] = useState('1:1')
    const [imageImageSize, setImageImageSize] = useState('1:1')
    const [newsImageSize, setNewsImageSize] = useState('1:1')
    const [newsVariationCount, setNewsVariationCount] = useState(1)

    // Editing a textarea inline
    const [editField, setEditField] = useState<{ key: string; label: string; val: string } | null>(null)

    useEffect(() => {
        fetchPageSetting(page.id).then(s => {
            if (s) {
                setIsActive(s.auto_schedule === 1)
                setPostToken(s.post_token || '')
                setHideToken(s.hide_token || '')
                setWorkStart(s.working_hours_start ?? 6)
                setWorkEnd(s.working_hours_end ?? 24)
                setPostMode(s.post_mode || 'link')
                setImageSource(s.image_source || 'ai')
                setColorBg(!!s.color_bg)
                setAiModel(s.ai_model || 'gemini-2.0-flash-exp')
                setAiResolution(s.ai_resolution || '2K')
                setLinkImageSize(s.link_image_size || '1:1')
                setImageImageSize(s.image_image_size || '1:1')
                setNewsAnalysisPrompt(s.news_analysis_prompt || '')
                setNewsGenPrompt(s.news_generation_prompt || '')
                setNewsImageSize(s.news_image_size || '1:1')
                setNewsVariationCount(s.news_variation_count || 1)
                setHideTypes(s.hide_types || '')

                // Parse schedule_minutes
                const map: Record<number, number> = {}
                if (s.schedule_minutes) {
                    for (const part of s.schedule_minutes.split(',')) {
                        const t = part.trim()
                        if (t.includes(':')) {
                            const [h, m] = t.split(':').map(Number)
                            if (h >= 1 && h <= 24) map[h] = m
                        } else {
                            const h = Number(t)
                            if (h >= 1 && h <= 24) map[h] = 0
                        }
                    }
                }
                setHourMinutes(map)
                if (s.hide_types) setHideEnabled(true)
            }
            setLoading(false)
        })
    }, [page.id])

    const toggleHour = (h: number) => {
        setHourMinutes(prev => {
            const n = { ...prev }
            if (h in n) delete n[h]
            else n[h] = 0
            return n
        })
    }

    const selectedHours = Object.keys(hourMinutes).map(Number).sort((a, b) => a - b)
    const scheduleStr = selectedHours.map(h => `${h}:${String(hourMinutes[h]).padStart(2, '0')}`).join(',')

    const handleSave = async () => {
        setSaving(true)
        setSaveMsg('')
        try {
            await savePageSetting(page.id, {
                auto_schedule: isActive ? 1 : 0,
                schedule_minutes: scheduleStr,
                post_token: postToken || undefined,
                hide_token: hideToken || undefined,
                working_hours_start: workStart,
                working_hours_end: workEnd,
                post_mode: postMode,
                image_source: imageSource,
                color_bg: colorBg ? 1 : 0,
                ai_model: aiModel,
                ai_resolution: aiResolution,
                link_image_size: linkImageSize,
                image_image_size: imageImageSize,
                news_analysis_prompt: newsAnalysisPrompt || undefined,
                news_generation_prompt: newsGenPrompt || undefined,
                news_image_size: newsImageSize,
                news_variation_count: newsVariationCount,
                hide_types: hideEnabled ? hideTypes : '',
            })
            setSaveMsg('บันทึกสำเร็จ ✅')
            setTimeout(() => { setSaveMsg(''); onBack() }, 1200)
        } catch {
            setSaveMsg('เกิดข้อผิดพลาด ❌')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        setDeleting(true)
        try {
            await deletePage(page.id)
            setShowDeleteConfirm(false)
            onDeleted()
        } catch (e) {
            alert('ลบไม่สำเร็จ: ' + String(e))
        } finally {
            setDeleting(false)
        }
    }

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
            <div className="spin" style={{ width: 32, height: 32, border: '3px solid rgba(0,0,0,0.08)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
        </div>
    )

    const sections = [
        { id: 'token', emoji: '🔑', label: 'Page Token', desc: postToken ? `${postToken.slice(0, 18)}...` : 'ยังไม่ได้ตั้งค่า' },
        { id: 'schedule', emoji: '⏰', label: 'ตั้งเวลาโพสต์', desc: selectedHours.length > 0 ? `${selectedHours.length} ชั่วโมง` : 'ยังไม่ได้ตั้งค่า' },
        { id: 'mode', emoji: '🤖', label: 'Auto-Post Mode', desc: postMode === 'link' ? 'Link Post' : postMode === 'image' ? 'Image Post' : postMode === 'news' ? 'News Post' : 'Auto' },
        { id: 'autohide', emoji: '🙈', label: 'Auto Hide Posts', desc: hideEnabled ? 'เปิดใช้งาน' : 'ปิด' },
        { id: 'linkprompt', emoji: '🔗', label: 'Link Post Prompt', desc: linkPrompt ? linkPrompt.slice(0, 40) + '...' : 'ใช้ค่าเริ่มต้น' },
        { id: 'imageprompt', emoji: '🖼️', label: 'Image Post Prompt', desc: imagePrompt ? imagePrompt.slice(0, 40) + '...' : 'ใช้ค่าเริ่มต้น' },
        { id: 'newsprompt', emoji: '📰', label: 'News Post Prompt', desc: newsGenPrompt ? newsGenPrompt.slice(0, 40) + '...' : 'ใช้ค่าเริ่มต้น' },
        { id: 'aiimage', emoji: '🎨', label: 'AI Image Generation', desc: `${aiModel === 'gemini-2.0-flash-exp' ? 'Gemini Flash' : 'Gemini'} · ${aiResolution}` },
    ]

    return (
        <div style={{ paddingBottom: 100 }}>
            {/* Back + Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 0' }}>
                <button onClick={onBack} className="tap-scale" style={{
                    width: 36, height: 36, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--muted)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}>
                    <BackIcon />
                </button>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, overflow: 'hidden', background: page.color || 'var(--accent)', flexShrink: 0 }}>
                        <img
                            src={page.picture?.data?.url || `https://graph.facebook.com/${page.id}/picture?type=large`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => {
                                const target = e.currentTarget
                                target.style.display = 'none'
                                const parent = target.parentElement
                                if (parent) {
                                    parent.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:18px">${page.name[0]}</div>`
                                }
                            }}
                        />
                    </div>
                    <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{page.name}</p>
                </div>
            </div>

            {/* Title */}
            <p style={{ margin: '20px 16px 8px', fontSize: 13, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.06em' }}>SETTINGS</p>

            {/* Section list */}
            <div className="card" style={{ margin: '0 16px' }}>
                {sections.map((sec, idx) => (
                    <div key={sec.id}>
                        {idx > 0 && <Divider />}
                        <button
                            onClick={() => setOpenSection(openSection === sec.id ? null : sec.id)}
                            style={{
                                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '14px 16px', border: 'none', background: 'transparent', cursor: 'pointer',
                                textAlign: 'left',
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                                    {sec.emoji} {sec.label}
                                </p>
                                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {sec.desc}
                                </p>
                            </div>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                style={{ color: 'var(--muted)', transform: openSection === sec.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0, marginLeft: 8 }}>
                                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>

                        {/* Expanded content */}
                        {openSection === sec.id && (
                            <div style={{ padding: '4px 16px 16px', borderTop: '1px solid var(--border)' }} className="anim-fade-in">

                                {/* 🔑 Token */}
                                {sec.id === 'token' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <div>
                                            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Access Token (โพสต์)</p>
                                            <PasteField value={postToken} onChange={setPostToken} placeholder="กดค้าง → Paste Token..." mono />
                                        </div>
                                        <div>
                                            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Comment Token (ซ่อนคอมเมนต์)</p>
                                            <PasteField value={hideToken} onChange={setHideToken} placeholder="กดค้าง → Paste Token..." mono />
                                        </div>
                                    </div>
                                )}

                                {/* ⏰ Schedule */}
                                {sec.id === 'schedule' && (
                                    <div>
                                        <ToggleRow label="เปิดโพสต์อัตโนมัติ" value={isActive} onChange={setIsActive} />
                                        <div style={{ marginTop: 8 }}>
                                            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>เลือกชั่วโมงที่จะโพสต์</p>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
                                                {Array.from({ length: 24 }, (_, i) => i + 1).map(h => (
                                                    <button key={h} onClick={() => toggleHour(h)}
                                                        style={{
                                                            padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                                                            fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                                                            background: selectedHours.includes(h) ? 'var(--accent)' : 'var(--surface2)',
                                                            color: selectedHours.includes(h) ? 'white' : 'var(--muted)',
                                                        }}>
                                                        {String(h).padStart(2, '0')}
                                                    </button>
                                                ))}
                                            </div>
                                            {selectedHours.length > 0 && (
                                                <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--accent)' }}>
                                                    จะโพสต์: {selectedHours.map(h => `${String(h).padStart(2, '0')}:00`).join(', ')} น.
                                                </p>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
                                            <div style={{ flex: 1 }}>
                                                <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>เริ่มทำงาน (โมง)</p>
                                                <StepperField value={workStart} onChange={setWorkStart} min={0} max={23} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>สิ้นสุด (โมง)</p>
                                                <StepperField value={workEnd} onChange={setWorkEnd} min={1} max={24} />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* 🤖 Mode */}
                                {sec.id === 'mode' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <SelectRow label="รูปแบบโพสต์" value={postMode} onChange={setPostMode} options={[
                                            { value: 'link', label: '🔗 Link Post' },
                                            { value: 'image', label: '🖼️ Image Post' },
                                            { value: 'news', label: '📰 News Post' },
                                            { value: 'auto', label: '🎲 Auto' },
                                        ]} />
                                        <Divider />
                                        <SelectRow label="แหล่งรูปภาพ" value={imageSource} onChange={setImageSource} options={[
                                            { value: 'ai', label: '🤖 AI สร้างรูป' },
                                            { value: 'shopee', label: '🛍️ Shopee' },
                                        ]} />
                                        <Divider />
                                        <ToggleRow label="ใส่สีพื้นหลัง" sub="เพิ่มลายสีสำหรับรูป Link" value={colorBg} onChange={setColorBg} />
                                    </div>
                                )}

                                {/* 🙈 Auto Hide */}
                                {sec.id === 'autohide' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <ToggleRow label="เปิดซ่อน Comment อัตโนมัติ" value={hideEnabled} onChange={setHideEnabled} />
                                        {hideEnabled && (
                                            <div style={{ padding: '0 0 8px' }}>
                                                <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>ประเภทที่ซ่อน (กดค้าง → Paste)</p>
                                                <PasteField value={hideTypes} onChange={setHideTypes} placeholder="เช่น spam, ads, offensive" />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 🔗 Link Prompt */}
                                {sec.id === 'linkprompt' && (
                                    <div>
                                        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--muted)' }}>Prompt สำหรับสร้างรูป Link Post ใช้ AI</p>
                                        <PasteField value={linkPrompt} onChange={setLinkPrompt} placeholder="กดค้าง → Paste prompt..." tall />
                                    </div>
                                )}

                                {/* 🖼️ Image Prompt */}
                                {sec.id === 'imageprompt' && (
                                    <div>
                                        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--muted)' }}>Prompt สำหรับสร้างรูป Image Post ใช้ AI</p>
                                        <PasteField value={imagePrompt} onChange={setImagePrompt} placeholder="กดค้าง → Paste prompt..." tall />
                                    </div>
                                )}

                                {/* 📰 News Prompt */}
                                {sec.id === 'newsprompt' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        <div>
                                            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Prompt วิเคราะห์ข่าว</p>
                                            <PasteField value={newsAnalysisPrompt} onChange={setNewsAnalysisPrompt} placeholder="กดค้าง → Paste prompt..." tall />
                                        </div>
                                        <div>
                                            <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Prompt สร้างโพสต์ข่าว</p>
                                            <PasteField value={newsGenPrompt} onChange={setNewsGenPrompt} placeholder="กดค้าง → Paste prompt..." tall />
                                        </div>
                                        <div style={{ display: 'flex', gap: 12 }}>
                                            <div style={{ flex: 1 }}>
                                                <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>จำนวน Variation</p>
                                                <StepperField value={newsVariationCount} onChange={setNewsVariationCount} min={1} max={5} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>ขนาดรูป</p>
                                                <select value={newsImageSize} onChange={e => setNewsImageSize(e.target.value)}
                                                    style={{ width: '100%', padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: 'var(--surface2)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}>
                                                    {['1:1', '4:3', '16:9', '9:16'].map(s => <option key={s} value={s}>{s}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* 🎨 AI Image */}
                                {sec.id === 'aiimage' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <SelectRow label="AI Model" value={aiModel} onChange={setAiModel} options={[
                                            { value: 'gemini-2.0-flash-exp', label: 'Gemini Flash Exp' },
                                            { value: 'gemini-2.0-flash', label: 'Gemini Flash' },
                                            { value: 'imagen-3.0', label: 'Imagen 3.0' },
                                        ]} />
                                        <Divider />
                                        <SelectRow label="ความละเอียด" value={aiResolution} onChange={setAiResolution} options={[
                                            { value: '2K', label: '2K (สูงสุด)' },
                                            { value: '1080p', label: '1080p' },
                                            { value: '720p', label: '720p' },
                                        ]} />
                                        <Divider />
                                        <SelectRow label="ขนาดรูป Link Post" value={linkImageSize} onChange={setLinkImageSize} options={[
                                            { value: '1:1', label: '1:1 (Square)' },
                                            { value: '4:3', label: '4:3' },
                                            { value: '16:9', label: '16:9 (Wide)' },
                                        ]} />
                                        <Divider />
                                        <SelectRow label="ขนาดรูป Image Post" value={imageImageSize} onChange={setImageImageSize} options={[
                                            { value: '1:1', label: '1:1 (Square)' },
                                            { value: '4:3', label: '4:3' },
                                            { value: '16:9', label: '16:9 (Wide)' },
                                            { value: '9:16', label: '9:16 (Story)' },
                                        ]} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Save */}
            <div style={{ padding: '16px' }}>
                {saveMsg && (
                    <p style={{ margin: '0 0 10px', textAlign: 'center', fontSize: 13, color: saveMsg.includes('✅') ? 'var(--green)' : 'var(--red)' }}>{saveMsg}</p>
                )}
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="tap-scale"
                    style={{
                        width: '100%', padding: '15px', borderRadius: 16, border: 'none', cursor: 'pointer',
                        background: saving ? 'var(--surface2)' : 'var(--accent)',
                        color: saving ? 'var(--muted)' : 'white',
                        fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                >
                    {saving ? <><SmallSpinner />กำลังบันทึก...</> : 'บันทึกการตั้งค่า'}
                </button>
            </div>

            {/* Delete */}
            <div style={{ padding: '0 16px 32px' }}>
                <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="tap-scale"
                    style={{
                        width: '100%', padding: '15px', borderRadius: 16, border: 'none', cursor: 'pointer',
                        background: '#fee2e2',
                        color: '#dc2626',
                        fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                >
                    ลบเพจออกจากระบบ
                </button>
            </div>

            {editField && createPortal(
                <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px', background: 'rgba(0,0,0,0.85)' }} onClick={() => setEditField(null)}>
                    <div style={{ width: '100%', maxWidth: 400, padding: 24, background: 'var(--surface)', borderRadius: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} className="anim-fade-in" onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{editField.label}</p>
                            <button onClick={() => setEditField(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
                            </button>
                        </div>
                        <PasteField value={editField.val} onChange={(v) => setEditField(f => f ? { ...f, val: v } : null)} placeholder="กดค้าง → Paste" tall />
                        <button onClick={() => setEditField(null)} style={{ width: '100%', marginTop: 14, padding: '13px', borderRadius: 14, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>ตกลง</button>
                    </div>
                </div>, document.body
            )}

            {showDeleteConfirm && createPortal(
                <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px', background: 'rgba(0,0,0,0.85)' }} onClick={() => setShowDeleteConfirm(false)}>
                    <div style={{ width: '100%', maxWidth: 320, padding: 24, background: 'var(--surface)', borderRadius: 24, textAlign: 'center' }} className="anim-fade-in" onClick={e => e.stopPropagation()}>
                        <p style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>ยืนยันลบเพจ?</p>
                        <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
                            คุณต้องการลบเพจ <b>{page.name}</b> ออกจากระบบหรือไม่? การตั้งค่าทั้งหมดจะหายไป
                        </p>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <button onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1, padding: 12, borderRadius: 12, border: 'none', background: 'var(--surface2)', color: 'var(--text)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>ยกเลิก</button>
                            <button onClick={handleDelete} disabled={deleting} style={{ flex: 1, padding: 12, borderRadius: 12, border: 'none', background: '#dc2626', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center' }}>
                                {deleting ? <SmallSpinner /> : 'ลบเลย'}
                            </button>
                        </div>
                    </div>
                </div>, document.body
            )}
        </div>
    )
}

// ---- Page List (Grid) ----
export default function PagesTab({ pages, onRefresh }: Props) {
    const [selected, setSelected] = useState<Page | null>(null)
    const [showImport, setShowImport] = useState(false)
    const [importToken, setImportToken] = useState('')
    const [importing, setImporting] = useState(false)
    const [importMsg, setImportMsg] = useState('')

    const handleImport = async () => {
        if (!importToken.trim()) return
        setImporting(true)
        try {
            const d = await importPages(importToken.trim())
            if (d.success) {
                setImportMsg(`✅ เพิ่มใหม่ ${d.imported} เพจ, อัพเดท ${d.updated} เพจ`)
                setTimeout(() => { setShowImport(false); setImportMsg(''); setImportToken(''); onRefresh() }, 2000)
            } else {
                setImportMsg('❌ ' + (d.error || 'ไม่สำเร็จ'))
            }
        } catch {
            setImportMsg('❌ เชื่อมต่อไม่ได้')
        } finally {
            setImporting(false)
        }
    }

    if (selected) return <PageDetail page={selected} onBack={() => setSelected(null)} onDeleted={() => { setSelected(null); onRefresh() }} />

    return (
        <div style={{ padding: '16px', paddingBottom: 90 }}>
            {/* Header */}
            <div style={{ marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>เพจทั้งหมด</h2>
            </div>

            {/* Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 12,
            }}>
                {pages.map((p) => {
                    // Derive interval label from page data if available
                    const scheduleLabel = p.schedule_interval
                        ? `ทุก ${p.schedule_interval} นาที`
                        : p.auto_schedule ? 'Auto On' : 'Auto Off'

                    // Facebook public picture endpoint — works for public pages without token
                    const fbPic = p.picture?.data?.url
                        || `https://graph.facebook.com/${p.id}/picture?type=large`

                    return (
                        <button
                            key={p.id}
                            onClick={() => setSelected(p)}
                            className="tap-scale"
                            style={{
                                border: 'none', background: 'transparent', padding: 0,
                                cursor: 'pointer', textAlign: 'center', display: 'flex',
                                flexDirection: 'column', alignItems: 'center', gap: 6,
                                minWidth: 0, overflow: 'hidden', width: '100%',
                            }}
                        >
                            {/* Thumbnail */}
                            <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
                                <div style={{
                                    width: '100%', height: '100%', borderRadius: 20,
                                    overflow: 'hidden', background: p.color || 'var(--accent)',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
                                }}>
                                    <img
                                        src={fbPic}
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        onError={(e) => {
                                            // fallback to color initial
                                            e.currentTarget.style.display = 'none'
                                        }}
                                    />
                                </div>
                                {/* Status dot */}
                                <div style={{
                                    position: 'absolute', bottom: 5, right: 5,
                                    width: 13, height: 13, borderRadius: '50%',
                                    background: p.auto_schedule ? '#22c55e' : '#d1d5db',
                                    border: '2px solid white',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                                }} />
                            </div>

                            {/* Name */}
                            <p style={{
                                margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--text)',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                width: '100%', textAlign: 'center',
                            }}>{p.name}</p>

                            {/* Schedule / status */}
                            <p style={{
                                margin: 0, fontSize: 10, color: 'var(--muted)',
                                lineHeight: 1.2,
                            }}>{scheduleLabel}</p>
                        </button>
                    )
                })}

                {/* Add Page card */}
                <button
                    onClick={() => setShowImport(true)}
                    className="tap-scale"
                    style={{
                        border: 'none', background: 'transparent', padding: 0,
                        cursor: 'pointer', textAlign: 'center', display: 'flex',
                        flexDirection: 'column', alignItems: 'center', gap: 6,
                        width: '100%', minWidth: 0, overflow: 'hidden',
                    }}
                >
                    <div style={{
                        width: '100%', aspectRatio: '1/1', borderRadius: 20,
                        border: '2px dashed #d1d5db',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxSizing: 'border-box',
                    }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: '50%',
                            background: '#f3f4f6', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            fontSize: 22, color: '#9ca3af', lineHeight: 1,
                        }}>+</div>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#9ca3af' }}>Add Page</p>
                </button>
            </div>

            {/* Import Modal — centered */}
            {showImport && createPortal(
                <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px', background: 'rgba(0,0,0,0.85)' }} onClick={() => { setShowImport(false); setImportToken(''); setImportMsg('') }}>
                    <div style={{ width: '100%', maxWidth: 400, padding: 24, background: 'var(--surface)', borderRadius: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} className="anim-fade-in" onClick={e => e.stopPropagation()}>

                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                            <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>เพิ่ม Facebook Pages</p>
                            <button onClick={() => { setShowImport(false); setImportToken(''); setImportMsg('') }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, lineHeight: 1 }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                                </svg>
                            </button>
                        </div>

                        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>ใส่ User Access Token จาก Facebook เพื่อดึงข้อมูล Pages ที่คุณเป็นแอดมิน</p>

                        <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>User Access Token</p>

                        {/* Paste-only field — no keyboard */}
                        <div
                            contentEditable
                            suppressContentEditableWarning
                            inputMode="none"
                            onPaste={(e) => {
                                e.preventDefault()
                                const text = e.clipboardData.getData('text/plain').trim()
                                if (text) setImportToken(text)
                            }}
                            onBeforeInput={(e) => e.preventDefault()}
                            onDrop={(e) => e.preventDefault()}
                            style={{
                                minHeight: 80, borderRadius: 12, padding: '10px 12px',
                                fontSize: 11, fontFamily: 'monospace',
                                background: 'var(--surface2)', border: '1px solid var(--border)',
                                color: 'var(--text)', outline: 'none',
                                wordBreak: 'break-all', lineHeight: 1.6,
                                WebkitUserSelect: 'text', userSelect: 'text',
                            } as React.CSSProperties}
                        >
                            {importToken && <span>{importToken}</span>}
                        </div>

                        {!importToken && (
                            <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--muted)' }}>
                                กดค้างในช่องด้านบน → Paste
                            </p>
                        )}

                        {importMsg && (
                            <p style={{ margin: '10px 0 0', fontSize: 13, color: importMsg.includes('✅') ? 'var(--green)' : 'var(--red)' }}>{importMsg}</p>
                        )}

                        <button onClick={handleImport} disabled={importing || !importToken.trim()}
                            style={{
                                width: '100%', marginTop: 16, padding: '14px',
                                borderRadius: 14, border: 'none',
                                background: 'var(--accent)', color: 'white',
                                fontSize: 15, fontWeight: 700, cursor: 'pointer',
                                fontFamily: 'inherit',
                                opacity: !importToken.trim() ? 0.4 : 1,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            }}>
                            {importing ? <><SmallSpinner />กำลังดึง...</> : 'นำเข้า Pages'}
                        </button>
                    </div>
                </div>, document.body
            )}
        </div>
    )
}
