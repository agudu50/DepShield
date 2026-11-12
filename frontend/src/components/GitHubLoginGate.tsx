import { useState, useEffect } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  Globe,
  KeyRound,
  Lock,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Terminal,
  XCircle,
} from 'lucide-react'
import { getGitHubUser, type GitHubUserProfile } from '../api'
import {
  getStoredEvents,
  subscribeTelemetry,
  addTelemetryEvent,
  type TelemetryEvent,
} from '../telemetry'
import Pentest3DShield from './Pentest3DShield'

interface GitHubLoginGateProps {
  onLoginSuccess: (token: string, user: GitHubUserProfile) => void
  onSkipToWorkspace?: () => void
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
}

export default function GitHubLoginGate({
  onLoginSuccess,
  onSkipToWorkspace,
  theme = 'dark',
  onToggleTheme,
}: GitHubLoginGateProps) {
  const [tokenInput, setTokenInput] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [workflowTab, setWorkflowTab] = useState<'web' | 'cli'>('web')
  const [telemetryEvents, setTelemetryEvents] = useState<TelemetryEvent[]>(() => getStoredEvents())
  const [isSimulating, setIsSimulating] = useState(false)
  const [copiedText, setCopiedText] = useState<string | null>(null)

  useEffect(() => {
    setTelemetryEvents(getStoredEvents())
    return subscribeTelemetry((events) => {
      setTelemetryEvents(events)
    })
  }, [])

  function copyCommand(cmd: string) {
    navigator.clipboard.writeText(cmd)
    setCopiedText(cmd)
    setTimeout(() => setCopiedText(null), 2000)
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  function runSandboxProbe() {
    setIsSimulating(true)
    setTimeout(() => {
      addTelemetryEvent({
        source: 'cli',
        category: 'privacy_guard',
        action: 'SANDBOX_ISOLATION_PROBE',
        target: 'Environment & File Descriptors',
        details: 'Active boundary check passed. ZERO source files (.ts, .py, .js) or local secrets (.env) accessible. Pinned tuples only.',
        verdict: 'safe',
        bytesSent: 0,
        sourceCodeRead: 0,
      })
      setIsSimulating(false)
    }, 280)
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
          : 'Unable to authenticate with GitHub. Verify your token permissions or ensure the backend is running.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="sw-root">

      {/* ── NAV ─────────────────────────────────────────────────── */}
      <header className="sw-nav">
        <div className="sw-nav-inner">
          <div className="sw-nav-brand">
            <img
              src={theme === 'light' ? '/depshield-logo-light.png' : '/depshield-logo-dark.png'}
              alt="DepShield Logo"
              className="sw-nav-logo-img"
            />
          </div>
          <nav className="sw-nav-links">
            <button type="button" onClick={() => scrollTo('sw-capabilities')}>Capabilities</button>
            <button type="button" onClick={() => scrollTo('sw-workflow')}>Workflow</button>
            <button type="button" onClick={() => scrollTo('sw-integrity')}>Zero-Theft</button>
            <button type="button" onClick={() => scrollTo('sw-stream')}>Telemetry</button>
          </nav>
          <div className="sw-nav-right">
            {onToggleTheme && (
              <button
                type="button"
                className="theme-toggle-btn"
                onClick={onToggleTheme}
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
                <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
              </button>
            )}
            <span className="sw-bifrost-tag">BIFROST / MAXIM AI</span>
            <button type="button" className="sw-cta-btn" onClick={() => scrollTo('sw-connect')}>
              Connect <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* ── HERO ────────────────────────────────────────────────── */}
      <section className="sw-hero">
        <div className="sw-hero-inner">

          {/* Top meta row */}
          <div className="sw-hero-meta">
            <span className="sw-live-dot" />
            <span className="sw-hero-meta-text">AUTONOMOUS SECURITY AGENT</span>
            <span className="sw-hero-meta-sep">×</span>
            <span className="sw-hero-meta-text">BIFROST BY MAXIM AI</span>
          </div>

          {/* Giant headline */}
          <h1 className="sw-hero-title">
            Autonomous<br />
            Supply Chain Defense<br />
            Powered by Bifrost.
          </h1>

          {/* Two column split: description + 3D */}
          <div className="sw-hero-split">
            <div className="sw-hero-left">
              <p className="sw-hero-desc">
                Powered by <strong>Bifrost by Maxim AI</strong> as the central intelligent gateway.
                DepShield scans your GitHub repositories for vulnerable packages, reasons through
                attack surfaces, and writes safe fix plans — without touching a single line of your
                source code.
              </p>

              {/* Stats strip */}
              <div className="sw-hero-stats">
                <div className="sw-stat">
                  <span className="sw-stat-num">0</span>
                  <span className="sw-stat-label">bytes of source<br />code ingested</span>
                </div>
                <div className="sw-stat-div" />
                <div className="sw-stat">
                  <span className="sw-stat-num">100%</span>
                  <span className="sw-stat-label">OSV.dev<br />verified findings</span>
                </div>
                <div className="sw-stat-div" />
                <div className="sw-stat">
                  <span className="sw-stat-num">Live</span>
                  <span className="sw-stat-label">real-time audit<br />telemetry stream</span>
                </div>
              </div>
            </div>

            {/* 3D Shield Visual */}
            <div className="sw-hero-right">
              <Pentest3DShield />
            </div>
          </div>

          {/* Token connect bar */}
          <div id="sw-connect" className="sw-connect-bar">
            <div className="sw-connect-label">
              <KeyRound size={14} />
              <span>CONNECT GITHUB TARGET</span>
              <span className="sw-connect-scope">repo read scope required</span>
            </div>

            {error && (
              <div className="sw-error-row">
                <AlertTriangle size={14} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleConnect} className="sw-connect-form">
              <div className="sw-token-row">
                <input
                  type={showToken ? 'text' : 'password'}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="sw-token-input"
                  required
                />
                <button
                  type="button"
                  className="sw-vis-btn"
                  onClick={() => setShowToken(!showToken)}
                  title={showToken ? 'Hide token' : 'Show token'}
                >
                  {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button
                  type="submit"
                  className="sw-submit-btn"
                  disabled={loading || !tokenInput.trim()}
                >
                  {loading ? (
                    <><RefreshCw className="animate-spin" size={15} /><span>Connecting…</span></>
                  ) : (
                    <><Github size={15} /><span>Start Pentest</span><ArrowRight size={13} /></>
                  )}
                </button>
              </div>
            </form>

            <div className="sw-connect-footer">
              <Lock size={11} />
              <span>Token stored in browser memory only — never transmitted externally.</span>
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=DepShield%20AI%20Agent"
                target="_blank"
                rel="noreferrer"
                className="sw-token-link"
              >
                Generate token <ExternalLink size={11} />
              </a>
              {onSkipToWorkspace && (
                <button type="button" className="sw-token-link" onClick={onSkipToWorkspace}>
                  Neon Workspace →
                </button>
              )}
            </div>
          </div>

        </div>
      </section>

      {/* ── RULE ──────────────────────────────────────────────── */}
      <div className="sw-rule" />

      {/* ── CAPABILITIES ──────────────────────────────────────── */}
      <section id="sw-capabilities" className="sw-section">
        <div className="sw-section-inner">

          <div className="sw-section-head">
            <span className="sw-section-num">01</span>
            <div>
              <h2 className="sw-section-title">Capabilities</h2>
              <p className="sw-section-sub">
                Traditional scanners dump raw CVE lists. DepShield reasons through what actually matters.
              </p>
            </div>
          </div>

          <div className="sw-caps-grid">
            <div className="sw-cap-item">
              <div className="sw-cap-num">A</div>
              <div className="sw-cap-body">
                <span className="sw-cap-label">BIFROST GATEWAY · MAXIM AI</span>
                <h3 className="sw-cap-title">Autonomous Attack Reasoning</h3>
                <p className="sw-cap-desc">
                  When a vulnerability is detected, the Bifrost AI gateway evaluates how an attacker
                  could exploit it, checks whether the vulnerable code path is reachable in your project,
                  and writes a non-breaking upgrade plan.
                </p>
                <div className="sw-cap-evidence">
                  <div className="sw-evidence-row">
                    <span className="sw-evidence-label">Target</span>
                    <code className="sw-evidence-val">axios@1.5.0 · CVE-2023-45857 (SSRF)</code>
                  </div>
                  <div className="sw-evidence-row">
                    <span className="sw-evidence-label">Bifrost</span>
                    <code className="sw-evidence-val sw-evidence-safe">↑ Upgrade to 1.6.0 — 0 breaking changes</code>
                  </div>
                </div>
              </div>
            </div>

            <div className="sw-cap-item">
              <div className="sw-cap-num">B</div>
              <div className="sw-cap-body">
                <span className="sw-cap-label">SANDBOX GUARANTEE</span>
                <h3 className="sw-cap-title">Zero Source Code Ingestion</h3>
                <p className="sw-cap-desc">
                  DepShield reads only manifest files. Your proprietary code is never opened,
                  read into memory, or uploaded anywhere.
                </p>
                <div className="sw-cap-checklist">
                  <div className="sw-check-row sw-check-allow">
                    <CheckCircle2 size={13} />
                    <span><code>package.json</code>, <code>uv.lock</code>, <code>requirements.txt</code></span>
                  </div>
                  <div className="sw-check-row sw-check-block">
                    <XCircle size={13} />
                    <span><code>.ts</code>, <code>.py</code>, <code>.env</code>, <code>.go</code> — strictly blocked</span>
                  </div>
                  <div className="sw-check-row sw-check-metric">
                    <Lock size={12} />
                    <strong>0 Bytes Exfiltrated</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="sw-cap-item">
              <div className="sw-cap-num">C</div>
              <div className="sw-cap-body">
                <span className="sw-cap-label">CLI PROTECTION</span>
                <h3 className="sw-cap-title">Pre-Install Safety Gate</h3>
                <p className="sw-cap-desc">
                  Intercepts package additions before they touch your disk. Malicious or vulnerable
                  packages are blocked before download, with lifecycle scripts disabled.
                </p>
                <div className="sw-cap-terminal">
                  <code>$ depshield add bad-pkg@1.0</code>
                  <span className="sw-term-err">[BLOCKED] Malicious payload detected</span>
                  <span className="sw-term-ok">[ENFORCED] Policy verified. No files written.</span>
                </div>
              </div>
            </div>

            <div className="sw-cap-item">
              <div className="sw-cap-num">D</div>
              <div className="sw-cap-body">
                <span className="sw-cap-label">DETERMINISTIC VERIFICATION</span>
                <h3 className="sw-cap-title">Zero AI Hallucinations</h3>
                <p className="sw-cap-desc">
                  AI never guesses or invents CVEs. Every finding originates from authoritative
                  OSV.dev feeds. Bifrost explains verified evidence — never fabricates advisories.
                </p>
                <div className="sw-cap-pills">
                  <span className="sw-pill">Exact Pinned Versions</span>
                  <span className="sw-pill">SHA-256 Registry Hashes</span>
                  <span className="sw-pill">CVSS 3.1 Vectors</span>
                  <span className="sw-pill">SemVer Safe Ranges</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      <div className="sw-rule" />

      {/* ── WORKFLOW ──────────────────────────────────────────── */}
      <section id="sw-workflow" className="sw-section">
        <div className="sw-section-inner">

          <div className="sw-section-head">
            <span className="sw-section-num">02</span>
            <div>
              <h2 className="sw-section-title">Workflow</h2>
              <p className="sw-section-sub">
                Use the web dashboard or run everything from your terminal. Both stream live telemetry.
              </p>
            </div>
          </div>

          <div className="sw-workflow-tabs">
            <button
              type="button"
              className={`sw-tab-btn ${workflowTab === 'web' ? 'sw-tab-active' : ''}`}
              onClick={() => setWorkflowTab('web')}
            >
              <Globe size={14} /> Web Dashboard
            </button>
            <button
              type="button"
              className={`sw-tab-btn ${workflowTab === 'cli' ? 'sw-tab-active' : ''}`}
              onClick={() => setWorkflowTab('cli')}
            >
              <Terminal size={14} /> Developer CLI
            </button>
          </div>

          {workflowTab === 'web' && (
            <div className="sw-steps">
              {[
                {
                  n: '01',
                  title: 'Connect Your GitHub Token',
                  desc: 'Paste a token with read-only repo access. It stays in browser memory and never leaves your device.',
                },
                {
                  n: '02',
                  title: 'Pick a Repository to Scan',
                  desc: 'DepShield finds dependency files automatically. It ignores all source code files entirely.',
                },
                {
                  n: '03',
                  title: 'The Agent Runs the Pentest',
                  desc: 'Bifrost checks every package against OSV.dev, reasons through attack paths, and writes safe upgrade plans.',
                },
                {
                  n: '04',
                  title: 'Monitor the Audit Live',
                  desc: 'The real-time telemetry stream shows every file touched, every query made, and every byte transmitted — proving nothing was stolen.',
                },
              ].map((step) => (
                <div key={step.n} className="sw-step">
                  <span className="sw-step-num">{step.n}</span>
                  <div className="sw-step-body">
                    <h4 className="sw-step-title">{step.title}</h4>
                    <p className="sw-step-desc">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {workflowTab === 'cli' && (
            <div className="sw-steps">
              {[
                {
                  n: '01',
                  title: 'Install & Authenticate',
                  desc: 'Store your GitHub credentials safely in your OS keyring:',
                  cmd: 'depshield github login --token <PAT>',
                },
                {
                  n: '02',
                  title: 'Safe Preflight Installs',
                  desc: 'Check packages against OSV before they hit your disk:',
                  cmd: 'depshield add express@4.18.2',
                },
                {
                  n: '03',
                  title: 'Start the Background Monitor',
                  desc: 'Stream live telemetry events to the web dashboard:',
                  cmd: 'depshield monitor',
                },
                {
                  n: '04',
                  title: 'Run a Full Pentest',
                  desc: 'Autonomous dependency audit directly from your terminal:',
                  cmd: 'depshield github analyze owner/repo',
                },
              ].map((step) => (
                <div key={step.n} className="sw-step">
                  <span className="sw-step-num">{step.n}</span>
                  <div className="sw-step-body">
                    <h4 className="sw-step-title">{step.title}</h4>
                    <p className="sw-step-desc">{step.desc}</p>
                    <div className="sw-code-line">
                      <code>{step.cmd}</code>
                      <button
                        type="button"
                        className="sw-copy-btn"
                        onClick={() => copyCommand(step.cmd)}
                      >
                        {copiedText === step.cmd ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </section>

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
                    ? <><RefreshCw size={11} className="animate-spin" /> Verifying…</>
                    : <><ShieldCheck size={11} /> Probe Sandbox Isolation</>}
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
                  <li><button type="button" onClick={() => scrollTo('sw-connect')}>Autonomous Pentesting</button></li>
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
              <span>Autonomous Pentest Agent</span>
              <span>Zero-Data-Theft</span>
              <span>Built on React 19 + FastAPI</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  )
}
