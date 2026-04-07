import { useEffect, useState } from 'react'
import { fetchPages } from './api'
import type { Page } from './api'
import HomeTab from './tabs/HomeTab'
import QuotesTab from './tabs/QuotesTab'
import LogsTab from './tabs/LogsTab'
import PagesTab from './tabs/PagesTab'
import EarningsTab from './tabs/EarningsTab'

type Tab = 'home' | 'quotes' | 'logs' | 'pages' | 'earnings'

// Init Telegram WebApp
if (window.Telegram?.WebApp) {
  const tg = window.Telegram.WebApp
  tg.ready()
  tg.expand()
  tg.disableVerticalSwipes?.()
  tg.setHeaderColor?.('#f5f5f7')
  tg.setBackgroundColor?.('#f5f5f7')
  tg.setBottomBarColor?.('#ffffff')
}

// Nav Icons
const IconHome = ({ active }: { active: boolean }) => active ? (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.71 2.29a1 1 0 00-1.42 0l-9 9a1 1 0 001.42 1.42L4 12.41V21a1 1 0 001 1h4a1 1 0 001-1v-4h4v4a1 1 0 001 1h4a1 1 0 001-1v-8.59l.29.3a1 1 0 001.42-1.42l-9-9z" />
  </svg>
) : (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconQuote = ({ active }: { active: boolean }) => active ? (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97z" clipRule="evenodd" />
  </svg>
) : (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconLog = ({ active }: { active: boolean }) => active ? (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" d="M5.625 1.5H9a3.75 3.75 0 013.75 3.75v1.875c0 1.036.84 1.875 1.875 1.875H16.5a3.75 3.75 0 013.75 3.75v7.875c0 1.035-.84 1.875-1.875 1.875H5.625a1.875 1.875 0 01-1.875-1.875V3.375c0-1.036.84-1.875 1.875-1.875zm5.845 17.03a.75.75 0 001.06 0l3-3a.75.75 0 10-1.06-1.06l-1.72 1.72V12a.75.75 0 00-1.5 0v4.19l-1.72-1.72a.75.75 0 00-1.06 1.06l3 3z" clipRule="evenodd" />
  </svg>
) : (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconPages = ({ active }: { active: boolean }) => active ? (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.25 5.337c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.036 1.007-1.875 2.25-1.875S15 2.34 15 3.375c0 .369-.128.714-.349 1.003-.215.283-.401.604-.401.959 0 .332.278.598.61.578 1.91-.114 3.79-.342 5.632-.676a.75.75 0 01.878.645 49.17 49.17 0 01.376 5.452.657.657 0 01-.66.664c-.354 0-.675-.186-.958-.401a1.647 1.647 0 00-1.003-.349c-1.035 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .714-.128 1.003-.349.283-.215.604-.401.959-.401.31 0 .557.262.534.571a48.774 48.774 0 01-.595 4.845.75.75 0 01-.61.61c-1.82.317-3.673.533-5.555.642a.58.58 0 01-.611-.581c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.035-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.714.349 1.003.215.283.401.604.401.959a.641.641 0 01-.658.643 49.118 49.118 0 01-4.708-.36.75.75 0 01-.645-.878c.293-1.614.504-3.257.629-4.924A.53.53 0 005.337 15c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.036 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.369 0 .714.128 1.003.349.283.215.604.401.959.401a.656.656 0 00.659-.663 47.703 47.703 0 00-.31-4.82.75.75 0 01.83-.832c1.343.155 2.703.254 4.077.294a.64.64 0 00.657-.642z" />
  </svg>
) : (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconEarnings = ({ active }: { active: boolean }) => active ? (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 7.5a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5z" />
    <path fillRule="evenodd" d="M1.5 4.875C1.5 3.839 2.34 3 3.375 3h17.25c1.035 0 1.875.84 1.875 1.875v9.75c0 1.036-.84 1.875-1.875 1.875H3.375A1.875 1.875 0 011.5 14.625v-9.75zM8.25 9.75a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0zM18.75 9a.75.75 0 00-.75.75v.008c0 .414.336.75.75.75h.008a.75.75 0 00.75-.75V9.75a.75.75 0 00-.75-.75h-.008zM4.5 9.75A.75.75 0 015.25 9h.008a.75.75 0 01.75.75v.008a.75.75 0 01-.75.75H5.25a.75.75 0 01-.75-.75V9.75z" clipRule="evenodd" />
    <path d="M2.25 18a.75.75 0 000 1.5c5.4 0 10.63.722 15.6 2.075 1.19.324 2.4-.558 2.4-1.82V18.75a.75.75 0 00-.75-.75H2.25z" />
  </svg>
) : (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// Custom NavItem (no antd-mobile dependency)
function NavItem({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 5, paddingTop: 12, paddingBottom: 6,
        background: 'none', border: 'none', cursor: 'pointer',
        color: active ? 'var(--accent)' : 'rgba(0,0,0,0.4)',
        WebkitTapHighlightColor: 'transparent', transition: 'color 0.15s',
        position: 'relative',
      }}
    >
      {active && (
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 36, height: 3, borderRadius: '0 0 3px 3px',
          background: 'var(--accent)',
          boxShadow: '0 0 8px rgba(37,99,235,0.4)',
        }} />
      )}
      {icon}
      <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, fontFamily: 'inherit' }}>{label}</span>
    </button>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [pages, setPages] = useState<Page[]>([])
  const [loadingPages, setLoadingPages] = useState(true)

  const loadPages = () => {
    setLoadingPages(true)
    void fetchPages().then(setPages).finally(() => setLoadingPages(false))
  }

  useEffect(() => {
    let active = true

    void fetchPages()
      .then((nextPages) => {
        if (active) setPages(nextPages)
      })
      .finally(() => {
        if (active) setLoadingPages(false)
      })

    return () => {
      active = false
    }
  }, [])

  const NAV_H = 88 // px — height of the fixed bottom nav compatible with safe-area

  return (
    // Outer: fills screen, centers app — on desktop shows neutral bg on sides
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'stretch', height: '100dvh', background: '#d1d1d6' }}>
      {/* Inner: phone-width container, max 480px */}
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 480, height: '100dvh', background: 'var(--bg)', position: 'relative' }}>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: NAV_H }}>
          <div style={{ display: tab === 'home' ? 'block' : 'none' }}>
            <HomeTab pages={pages} loadingPages={loadingPages} onRefreshPages={loadPages} />
          </div>
          <div style={{ display: tab === 'quotes' ? 'block' : 'none' }}>
            <QuotesTab />
          </div>
          <div style={{ display: tab === 'logs' ? 'block' : 'none' }}>
            <LogsTab pages={pages} />
          </div>
          <div style={{ display: tab === 'pages' ? 'block' : 'none' }}>
            <PagesTab pages={pages} onRefresh={loadPages} />
          </div>
          <div style={{ display: tab === 'earnings' ? 'block' : 'none' }}>
            <EarningsTab pages={pages} />
          </div>
        </div>

        {/* Fixed bottom nav — z-index: 40 so popup z-index: 1000 covers it */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(0,0,0,0.08)',
          paddingBottom: 'env(safe-area-inset-bottom, 8px)',
          display: 'flex',
          zIndex: 40,
        }}>
          <NavItem label="หน้าหลัก" icon={<IconHome active={tab === 'home'} />} active={tab === 'home'} onClick={() => setTab('home')} />
          <NavItem label="ข้อความ" icon={<IconQuote active={tab === 'quotes'} />} active={tab === 'quotes'} onClick={() => setTab('quotes')} />
          <NavItem label="ประวัติ" icon={<IconLog active={tab === 'logs'} />} active={tab === 'logs'} onClick={() => setTab('logs')} />
          <NavItem label="เพจ" icon={<IconPages active={tab === 'pages'} />} active={tab === 'pages'} onClick={() => setTab('pages')} />
          <NavItem label="รายได้" icon={<IconEarnings active={tab === 'earnings'} />} active={tab === 'earnings'} onClick={() => setTab('earnings')} />
        </div>

      </div>
    </div>
  )
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void
        expand: () => void
        requestFullscreen?: () => void
        disableVerticalSwipes?: () => void
        setHeaderColor?: (color: string) => void
        setBackgroundColor?: (color: string) => void
        setBottomBarColor?: (color: string) => void
        initDataUnsafe?: { user?: { first_name: string } }
      }
    }
  }
}
