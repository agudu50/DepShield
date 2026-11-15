import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ExternalLink, Github, LogOut, Moon, Search, Sun } from 'lucide-react'
import type { GitHubUserProfile } from '../../api'

export interface DashTab<T extends string> {
  id: T
  label: string
  icon: ReactNode
  badge?: { text: string; tone: 'alert' | 'live' | 'neutral' }
}

interface DashboardTopbarProps<T extends string> {
  tabs: DashTab<T>[]
  active: T
  onSelect: (id: T) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenPalette: () => void
  user: GitHubUserProfile | null
  onLogout: () => void
  onConnect: () => void
}

export default function DashboardTopbar<T extends string>({
  tabs,
  active,
  onSelect,
  theme,
  onToggleTheme,
  onOpenPalette,
  user,
  onLogout,
  onConnect,
}: DashboardTopbarProps<T>) {
  const navRef = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

  useEffect(() => {
    function measure() {
      const btn = navRef.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`)
      setIndicator(btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : { left: 0, width: 0 })
      btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <header className={`hbd-top ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="hbd-top-inner">
        <div className="hbd-brand">
          <img
            src={theme === 'light' ? '/depshield-logo-light.png' : '/depshield-logo-dark.png'}
            alt="DepShield"
            className="hbd-brand-logo"
          />
          <span className="hbd-brand-sep">/</span>
          <span className="hbd-brand-ws">Security workspace</span>
        </div>

        <nav className="hbd-tabs" aria-label="Dashboard sections" ref={navRef}>
          <span
            className="hbd-tab-indicator"
            style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width, opacity: indicator.width ? 1 : 0 }}
            aria-hidden="true"
          />
          {tabs.map((t, i) => (
            <button
              key={t.id}
              type="button"
              data-tab={t.id}
              className={active === t.id ? 'active' : ''}
              aria-current={active === t.id ? 'page' : undefined}
              onClick={() => onSelect(t.id)}
              title={`${t.label} (${i + 1})`}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.badge && <span className={`hbd-badge hbd-badge-${t.badge.tone}`}>{t.badge.text}</span>}
            </button>
          ))}
        </nav>

        <div className="hbd-actions">
          <button type="button" className="ss-nav-icon ss-nav-search" onClick={onOpenPalette} aria-label="Search commands">
            <Search size={15} />
            <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          <button
            type="button"
            className="ss-nav-icon"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {user ? (
            <div className="hbd-user" ref={menuRef}>
              <button
                type="button"
                className="hbd-user-btn"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <img src={user.avatar_url} alt="" />
                <span>@{user.login}</span>
              </button>
              {menuOpen && (
                <div className="hbd-menu" role="menu">
                  <div className="hbd-menu-head">
                    <img src={user.avatar_url} alt="" />
                    <div>
                      <strong>{user.name ?? user.login}</strong>
                      <span>
                        @{user.login} · {user.public_repos} public repos
                      </span>
                    </div>
                  </div>
                  <a role="menuitem" href={user.html_url} target="_blank" rel="noreferrer" className="hbd-menu-item">
                    <Github size={14} /> View GitHub profile <ExternalLink size={11} />
                  </a>
                  <button
                    role="menuitem"
                    type="button"
                    className="hbd-menu-item"
                    onClick={() => {
                      setMenuOpen(false)
                      onLogout()
                    }}
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button type="button" className="ss-nav-cta" onClick={onConnect}>
              <Github size={14} /> <span>Connect GitHub</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
