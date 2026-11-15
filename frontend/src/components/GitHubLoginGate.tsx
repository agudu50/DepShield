import { useCallback, useState, useEffect, useRef } from 'react'
import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Github,
  Globe,
  KeyRound,
  Layers,
  Lock,
  Menu,
  Moon,
  Package,
  Rainbow,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  X,
  XCircle,
} from 'lucide-react'
import { checkBifrostHealth, getGitHubUser, type GitHubUserProfile } from '../api'
import { bifrostHealthToEvent } from '../bifrostProbe'
import CommandPalette, { type PaletteItem } from './CommandPalette'
import ConnectModal from './ConnectModal'
import { useScrollReveal } from '../landingMotion'
import PromptRing from './PromptRing'
import FeatureStory from './FeatureStory'
import LanyardBadge from './LanyardBadge'
import SourcesStrip from './SourcesStrip'
import WorkflowSection from './WorkflowSection'
import SiteMetrics from './SiteMetrics'
import '../landing-seesaw.css'
import '../landing-3d.css'

const NAV_LINKS = [
  { id: 'sw-capabilities', label: 'Product' },
  { id: 'sw-stack', label: 'Built on' },
  { id: 'sw-workflow', label: 'Workflow' },
  { id: 'sw-integrity', label: 'Zero-Theft' },
  { id: 'sw-stream', label: 'Telemetry' },
]

const STACK = [
  { name: 'Bifrost by Maxim AI', tag: 'AI gateway', desc: 'OpenAI-compatible gateway that routes every explanation to your configured model.', icon: Rainbow, url: 'https://github.com/maximhq/bifrost' },
  { name: 'OSV.dev', tag: 'Advisory feed', desc: 'Google’s open vulnerability database, the single source of truth for findings.', icon: Database, url: 'https://osv.dev' },
  { name: 'GitHub', tag: 'Targets', desc: 'Read-only manifest discovery across your repositories and branches.', icon: Github, url: 'https://github.com' },
  { name: 'npm', tag: 'Ecosystem', desc: 'package.json, package-lock.json and npm-shrinkwrap.json parsing.', icon: Package, url: 'https://www.npmjs.com' },
  { name: 'PyPI', tag: 'Ecosystem', desc: 'requirements.txt, pyproject.toml, uv.lock, poetry.lock and Pipfile.lock.', icon: Boxes, url: 'https://pypi.org' },
  { name: 'Neon', tag: 'Workspace', desc: 'Postgres with row-level security for multi-tenant scan history.', icon: Layers, url: 'https://neon.tech' },
]
import {
  getStoredEvents,
  subscribeTelemetry,
  addTelemetryEvent,
  type TelemetryEvent,
} from '../telemetry'

interface GitHubLoginGateProps {
  onLoginSuccess: (token: string, user: GitHubUserProfile) => void
  onSkipToWorkspace?: () => void
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
  /** Shown in the Connect modal on arrival, e.g. when a saved session expired. */
  initialError?: string | null
}

export default function GitHubLoginGate({
  onLoginSuccess,
  onSkipToWorkspace,
  theme = 'dark',
  onToggleTheme,
  initialError,
}: GitHubLoginGateProps) {
  const [tokenInput, setTokenInput] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [workflowTab, setWorkflowTab] = useState<'web' | 'cli'>('web')
  const [telemetryEvents, setTelemetryEvents] = useState<TelemetryEvent[]>(() => getStoredEvents())
  const [isSimulating, setIsSimulating] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })
  const pillRef = useRef<HTMLElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const closeConnect = useCallback(() => setConnectOpen(false), [])

  useScrollReveal(rootRef)

  useEffect(() => {
    if (!initialError) return
    setError(initialError)
    setConnectOpen(true)
  }, [initialError])

  function openConnect() {
    setError('')
    setMenuOpen(false)
    setConnectOpen(true)
  }

  // Scroll spy: the active link is the last section whose top has passed under the nav.
  useEffect(() => {
    let frame = 0
    function update() {
      frame = 0
      setScrolled(window.scrollY > 8)
      let current: string | null = null
      for (const { id } of NAV_LINKS) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 140) current = id
      }
      setActiveSection(current)
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // Slide the pill highlight under the active link.
  useEffect(() => {
    function measure() {
      const btn = activeSection
        ? pillRef.current?.querySelector<HTMLElement>(`[data-nav-id="${activeSection}"]`)
        : null
      setIndicator(btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : { left: 0, width: 0 })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [activeSection])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    const closeOnResize = () => window.innerWidth > 900 && setMenuOpen(false)
    window.addEventListener('keydown', close)
    window.addEventListener('resize', closeOnResize)
    return () => {
      window.removeEventListener('keydown', close)
      window.removeEventListener('resize', closeOnResize)
    }
  }, [menuOpen])

  useEffect(() => {
    setTelemetryEvents(getStoredEvents())
    return subscribeTelemetry((events) => {
      setTelemetryEvents(events)
    })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

  const paletteItems: PaletteItem[] = [
    { id: 'connect', group: 'Navigate', label: 'Connect GitHub token', hint: 'Start an audit', icon: <KeyRound size={14} />, run: () => openConnect() },
    { id: 'caps', group: 'Navigate', label: 'Product', hint: 'What it does', icon: <Sparkles size={14} />, run: () => scrollTo('sw-capabilities') },
    { id: 'team', group: 'Navigate', label: 'Add DepShield to your team', icon: <Github size={14} />, run: () => scrollTo('hb-cta') },
    { id: 'stack', group: 'Navigate', label: 'Built on', hint: 'Bifrost, OSV, GitHub…', icon: <Layers size={14} />, run: () => scrollTo('sw-stack') },
    { id: 'workflow', group: 'Navigate', label: 'Workflow', icon: <Globe size={14} />, run: () => scrollTo('sw-workflow') },
    { id: 'integrity', group: 'Navigate', label: 'Zero-Theft Guarantee', icon: <Lock size={14} />, run: () => scrollTo('sw-integrity') },
    { id: 'stream', group: 'Navigate', label: 'Live telemetry stream', icon: <Activity size={14} />, run: () => scrollTo('sw-stream') },
    { id: 'probe', group: 'Actions', label: 'Probe Bifrost gateway', hint: 'Real round-trip', icon: <ShieldCheck size={14} />, run: () => { scrollTo('sw-stream'); void runSandboxProbe() } },
    { id: 'cli', group: 'Actions', label: 'Show CLI install steps', icon: <Terminal size={14} />, run: () => { setWorkflowTab('cli'); scrollTo('sw-workflow') } },
    ...(onToggleTheme ? [{ id: 'theme', group: 'Actions', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`, icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />, run: onToggleTheme }] : []),
    ...(onSkipToWorkspace ? [{ id: 'workspace', group: 'Actions', label: 'Open Neon workspace', icon: <Database size={14} />, run: onSkipToWorkspace }] : []),
    ...['git clone https://github.com/agudu50/DepShield.git', 'depshield add express@4.18.2', 'depshield github analyze owner/repo', 'depshield monitor'].map((cmd) => ({
      id: `copy-${cmd}`, group: 'Copy command', label: cmd, icon: <Copy size={14} />, run: () => copyCommand(cmd),
    })),
  ]


  function copyCommand(cmd: string) {
    void navigator.clipboard?.writeText(cmd).catch(() => {})
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  async function runSandboxProbe() {
    setIsSimulating(true)
    try {
      addTelemetryEvent(bifrostHealthToEvent(await checkBifrostHealth()))
    } finally {
      setIsSimulating(false)
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    const cleanToken = tokenInput.trim().replace(/[\r\n\t]/g, '')
    if (!cleanToken) {
      setError('Please provide a valid GitHub Personal Access Token.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const user = await getGitHubUser(cleanToken)
      onLoginSuccess(cleanToken, user)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'We couldn’t sign you in with GitHub. Please check your token and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="sw-root hb-root" ref={rootRef}>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
      <ConnectModal
        open={connectOpen}
        onClose={closeConnect}
        token={tokenInput}
        onTokenChange={setTokenInput}
        showToken={showToken}
        onToggleShow={() => setShowToken((s) => !s)}
        loading={loading}
        error={error}
        onSubmit={handleConnect}
        onSkipToWorkspace={onSkipToWorkspace}
      />

      {/* ── NAV ─────────────────────────────────────────────────── */}
      <header className={`sw-nav ss-nav ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="sw-nav-inner ss-nav-inner">
          <button
            type="button"
            className="sw-nav-brand ss-nav-brand"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="DepShield, back to top"
          >
            <img
              src={theme === 'light' ? '/depshield-logo-light.png' : '/depshield-logo-dark.png'}
              alt="DepShield"
              className="sw-nav-logo-img"
            />
          </button>

          <nav className="ss-nav-pill" aria-label="Page sections" ref={pillRef}>
            <span
              className="ss-nav-indicator"
              style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width, opacity: indicator.width ? 1 : 0 }}
              aria-hidden="true"
            />
            {NAV_LINKS.map((l) => (
              <button
                key={l.id}
                type="button"
                data-nav-id={l.id}
                className={activeSection === l.id ? 'active' : ''}
                aria-current={activeSection === l.id ? 'location' : undefined}
                onClick={() => scrollTo(l.id)}
              >
                {l.label}
              </button>
            ))}
          </nav>

          <div className="ss-nav-right">
            <button type="button" className="ss-nav-icon ss-nav-search" onClick={() => setPaletteOpen(true)} aria-label="Search (Ctrl+K)">
              <Search size={15} />
              <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
            </button>
            {onToggleTheme && (
              <button
                type="button"
                className="ss-nav-icon"
                onClick={onToggleTheme}
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              >
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              </button>
            )}
            <a className="ss-powered" href="https://github.com/maximhq/bifrost" target="_blank" rel="noreferrer">
              <Rainbow size={13} />
              <span>
                Powered by <strong>Bifrost</strong>
              </span>
            </a>
            <button type="button" className="ss-nav-cta" onClick={openConnect} aria-haspopup="dialog">
              <Github size={14} />
              <span>Connect</span>
              <ArrowRight size={13} className="ss-nav-cta-arrow" />
            </button>
            <button
              type="button"
              className="ss-nav-icon ss-nav-burger"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-controls="ss-mobile-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X size={17} /> : <Menu size={17} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div id="ss-mobile-menu" className="ss-mobile-menu">
            {NAV_LINKS.map((l, i) => (
              <button
                key={l.id}
                type="button"
                className={activeSection === l.id ? 'active' : ''}
                style={{ animationDelay: `${i * 30}ms` }}
                onClick={() => {
                  setMenuOpen(false)
                  scrollTo(l.id)
                }}
              >
                <span>{l.label}</span>
                <ArrowRight size={14} />
              </button>
            ))}
            <button
              type="button"
              className="ss-mobile-cta"
              onClick={openConnect}
              aria-haspopup="dialog"
            >
              <Github size={15} /> Connect GitHub
            </button>
          </div>
        )}
      </header>

      {/* ── HERO (editorial, monochrome, 3D task ring) ─────────── */}
      <section className="hb-hero">
        <span className="hb-hero-grid" aria-hidden="true" />
        <div className="hb-hero-inner">
          <span className="hb-eyebrow ss-intro" style={{ '--i': 0 } as React.CSSProperties}>
            <span className="hb-eyebrow-dot" /> DepShield Agent · Powered by Bifrost
          </span>

          <h1 className="hb-hero-title">
            <span className="ss-line"><span className="ss-intro" style={{ '--i': 1 } as React.CSSProperties}>Know what’s in your dependencies</span></span>
            <span className="ss-line"><span className="ss-intro hb-muted" style={{ '--i': 2 } as React.CSSProperties}><em>before attackers do.</em></span></span>
          </h1>

          <p className="hb-hero-sub ss-intro" style={{ '--i': 3 } as React.CSSProperties}>
            An autonomous security agent that reads only your manifests, checks every pinned package
            against OSV.dev, and has Bifrost explain what matters, without touching your source code.
          </p>

          <div className="hb-hero-ctas ss-intro" style={{ '--i': 4 } as React.CSSProperties}>
            <button type="button" className="hb-btn hb-btn-primary" onClick={openConnect} aria-haspopup="dialog">
              <Github size={16} /> Connect GitHub <ArrowRight size={15} className="hb-btn-arrow" />
            </button>
            <button
              type="button"
              className="hb-btn hb-btn-ghost"
              onClick={() => {
                setWorkflowTab('cli')
                scrollTo('sw-workflow')
              }}
            >
              <Terminal size={15} /> Use the CLI
            </button>
          </div>
        </div>

        <div className="hb-hero-ring ss-intro" style={{ '--i': 5 } as React.CSSProperties}>
          <PromptRing />
          <p className="hb-ring-hint">Drag to rotate · ← → when focused</p>
        </div>
      </section>

      {/* ── SOURCES STRIP ─────────────────────────────────────── */}
      <SourcesStrip />

      {/* ── PUBLIC METRICS ────────────────────────────────────── */}
      <SiteMetrics />

      {/* ── PRODUCT STORY ─────────────────────────────────────── */}
      <section id="sw-capabilities" className="sw-section hb-section">
        <div className="sw-section-inner">
          <div className="hb-section-head">
            <span className="hb-kicker">What it does</span>
            <h2 className="hb-section-title">
              A security engineer that never
              <br />
              <em>reads your code.</em>
            </h2>
          </div>
          <FeatureStory />
        </div>
      </section>

      <div className="sw-rule" />

{/* ── BUILT ON (gallery cards) ───────────────────────────── */}
      <section id="sw-stack" className="sw-section">
        <div className="sw-section-inner">
          <div className="sw-section-head">
            <span className="sw-section-num">✦</span>
            <div>
              <h2 className="sw-section-title">Built on</h2>
              <p className="sw-section-sub">
                Every finding traces back to one of these sources. Nothing in between invents data.
              </p>
            </div>
          </div>
          <div className="ss-gallery">
            {STACK.map(({ name, tag, desc, icon: Icon, url }) => (
              <a key={name} href={url} target="_blank" rel="noreferrer" className="ss-gallery-card ss-spot">
                <span className="ss-gallery-logo"><Icon size={22} /></span>
                <span className="ss-gallery-text">
                  <span className="ss-gallery-title">
                    {name}
                    <ExternalLink size={12} className="ss-gallery-ext" />
                  </span>
                  <span className="ss-gallery-desc">{desc}</span>
                </span>
                <span className="ss-gallery-tag">{tag}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <div className="sw-rule" />

      {/* ── WORKFLOW ──────────────────────────────────────────── */}
      <WorkflowSection tab={workflowTab} onTab={setWorkflowTab} onConnect={openConnect} />

      <div className="sw-rule" />

      {/* ── INTEGRITY + STREAM ──────────────────────────────── */}
      <section id="sw-integrity" className="sw-section">
        <div className="sw-section-inner">

          <div className="sw-section-head">
            <span className="sw-section-num">03</span>
            <div>
              <h2 className="sw-section-title">Zero-Theft Guarantee</h2>
              <p className="sw-section-sub">
                You should never have to wonder if an AI is reading your private code behind the scenes.
              </p>
            </div>
          </div>

          <div className="sw-integrity-grid">

            <div className="sw-guardrails">
              {[
                {
                  icon: <CheckCircle2 size={15} />,
                  kind: 'allow' as const,
                  title: 'What DepShield reads',
                  body: 'Only manifest files: package.json, package-lock.json, requirements.txt, pyproject.toml, uv.lock.',
                },
                {
                  icon: <XCircle size={15} />,
                  kind: 'block' as const,
                  title: 'What DepShield never touches',
                  body: 'All .ts, .py, .js, .go, .env secrets, and git objects — never opened, read into memory, or uploaded.',
                },
                {
                  icon: <Database size={15} />,
                  kind: 'allow' as const,
                  title: 'Stateless OSV.dev queries',
                  body: 'Outbound queries send only (package_name, version) tuples. No code, no commit messages, no repo paths.',
                },
                {
                  icon: <Lock size={15} />,
                  kind: 'allow' as const,
                  title: 'Token isolation',
                  body: 'CLI uses your OS keyring (Windows Credential Locker, macOS Keychain). Web app uses browser session memory only.',
                },
              ].map((g, i) => (
                <div key={i} className="sw-guardrail">
                  <div className={`sw-guardrail-icon sw-gi-${g.kind}`}>{g.icon}</div>
                  <div>
                    <strong>{g.title}</strong>
                    <p>{g.body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div id="sw-stream" className="sw-console">
              <div className="sw-console-header">
                <div className="sw-console-dots">
                  <span className="sw-dot sw-dot-r" />
                  <span className="sw-dot sw-dot-y" />
                  <span className="sw-dot sw-dot-g" />
                </div>
                <span className="sw-console-title">
                  <Terminal size={12} /> depshield-telemetry-daemon
                </span>
                <button
                  type="button"
                  className="sw-sim-btn"
                  onClick={runSandboxProbe}
                  disabled={isSimulating}
                >
                  {isSimulating
                    ? <><RefreshCw size={11} className="animate-spin" /> Probing…</>
                    : <><ShieldCheck size={11} /> Probe Bifrost Gateway</>}
                </button>
              </div>

              <div className="sw-console-body">
                {telemetryEvents.length === 0 ? (
                  <div className="sw-console-empty" style={{ padding: '24px 16px', textAlign: 'center' }}>
                    <ShieldCheck size={26} className="text-emerald" style={{ display: 'inline-block', marginBottom: 8 }} />
                    <div style={{ color: '#ffffff', fontWeight: 600, fontSize: '0.85rem' }}>Sandbox Boundary Active & Verified</div>
                    <p style={{ color: '#888888', fontSize: '0.78rem', marginTop: 4, lineHeight: 1.5 }}>
                      No repository scans on record yet. Click &ldquo;Probe Sandbox Isolation&rdquo; to test local guardrails, or connect your GitHub token above to audit real repositories.
                    </p>
                  </div>
                ) : (
                  telemetryEvents.slice(0, 5).map((evt) => (
                    <div key={evt.id} className="sw-console-event">
                      <div className="sw-evt-header">
                        <span className="sw-evt-ts">{evt.timestamp}</span>
                        <span className="sw-evt-src">[{evt.source.toUpperCase()}]</span>
                        <span className="sw-evt-action">{evt.action}</span>
                        <span className={`sw-evt-verdict sw-verdict-${evt.verdict.toLowerCase()}`}>
                          {evt.verdict.toUpperCase()}
                        </span>
                      </div>
                      <div className="sw-evt-target">Target: <code>{evt.target}</code></div>
                      <p className="sw-evt-detail">{evt.details}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="sw-console-footer">
                <div className="sw-console-metric">
                  <ShieldCheck size={13} className="sw-metric-icon" />
                  <span>Source Code Exfiltrated: <strong>0 Bytes</strong></span>
                </div>
                <div className="sw-console-metric">
                  <Activity size={13} className="sw-metric-live" />
                  <span>Status: <strong>Verified Sandboxed</strong></span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      <div className="sw-rule" />

      {/* ── CLOSING CTA: lanyard badge ────────────────────────── */}
      <section id="hb-cta" className="hb-cta">
        <div className="hb-cta-inner">
          <div className="hb-cta-copy">
            <span className="hb-kicker">Get started</span>
            <h2 className="hb-cta-title">
              Add DepShield
              <br />
              <em>to your team.</em>
            </h2>
            <p className="hb-cta-body">
              Connect a GitHub token, pick a repository, and get an OSV-grounded audit in minutes. Bring
              any model through Bifrost, including free ones.
            </p>
            <div className="hb-hero-ctas">
              <button type="button" className="hb-btn hb-btn-primary" onClick={openConnect} aria-haspopup="dialog">
                <Github size={16} /> Connect GitHub <ArrowRight size={15} className="hb-btn-arrow" />
              </button>
              {onSkipToWorkspace && (
                <button type="button" className="hb-btn hb-btn-ghost" onClick={onSkipToWorkspace}>
                  <Database size={15} /> Open workspace
                </button>
              )}
            </div>
          </div>
          <LanyardBadge theme={theme} />
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────── */}
      <footer className="sw-footer">
        <div className="sw-footer-inner">
          <div className="sw-footer-top">
            <div className="sw-footer-brand">
              <img
                src={theme === 'light' ? '/depshield-logo-light.png' : '/depshield-logo-dark.png'}
                alt="DepShield Logo"
                className="sw-footer-logo-img"
              />
            </div>
            <div className="sw-footer-cols">
              <div className="sw-footer-col">
                <span className="sw-footer-col-head">Capabilities</span>
                <ul>
                  <li><button type="button" onClick={() => scrollTo('sw-connect')}>Vulnerability Auditing</button></li>
                  <li><button type="button" onClick={() => scrollTo('sw-capabilities')}>OSV.dev Matching</button></li>
                  <li><button type="button" onClick={() => scrollTo('sw-stream')}>Live Telemetry Stream</button></li>
                  <li><button type="button" onClick={() => scrollTo('sw-workflow')}>Preflight Install Gate</button></li>
                </ul>
              </div>
              <div className="sw-footer-col">
                <span className="sw-footer-col-head">Bifrost Gateway</span>
                <ul>
                  <li><a href="https://github.com/maximhq/bifrost" target="_blank" rel="noreferrer">Maxim AI Docs <ExternalLink size={10} /></a></li>
                  <li><a href="http://localhost:8080" target="_blank" rel="noreferrer">Local Bifrost Dashboard <ExternalLink size={10} /></a></li>
                  <li><button type="button" onClick={() => scrollTo('sw-integrity')}>Zero Code Leakage</button></li>
                </ul>
              </div>
              <div className="sw-footer-col">
                <span className="sw-footer-col-head">CLI Commands</span>
                <ul>
                  <li><code>pip install -e ./cli</code></li>
                  <li><code>depshield github login</code></li>
                  <li><code>depshield add &lt;pkg&gt;</code></li>
                  <li><code>depshield monitor</code></li>
                  <li><code>depshield scan</code></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="sw-footer-bottom">
            <p>© {new Date().getFullYear()} DepShield AI — Powered by <strong>Bifrost by Maxim AI</strong></p>
            <div className="sw-footer-tags">
              <span>Autonomous Vulnerability Audit Agent</span>
              <span>Zero-Data-Theft</span>
              <span>Built on React 19 + FastAPI</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  )
}
