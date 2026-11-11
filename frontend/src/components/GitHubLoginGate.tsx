import { useState } from 'react'
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
  Play,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react'
import { getGitHubUser, type GitHubUserProfile } from '../api'
import Pentest3DShield from './Pentest3DShield'

interface GitHubLoginGateProps {
  onLoginSuccess: (token: string, user: GitHubUserProfile) => void
  onSkipToWorkspace?: () => void
}

interface SimulatedEvent {
  id: string
  time: string
  source: 'CLI' | 'AGENT' | 'GATEWAY'
  action: string
  target: string
  verdict: 'SAFE' | 'BLOCKED' | 'WARNING'
  details: string
}

const PREVIEW_EVENTS: SimulatedEvent[] = [
  {
    id: 'p1',
    time: '12:00:01.102',
    source: 'CLI',
    action: 'DESCRIPTOR_READ',
    target: 'package.json',
    verdict: 'SAFE',
    details: 'Read dependency names and pinned versions only. 0 lines of app code or .env accessed.',
  },
  {
    id: 'p2',
    time: '12:00:01.350',
    source: 'GATEWAY',
    action: 'OSV_QUERY',
    target: 'https://api.osv.dev/v1/query',
    verdict: 'SAFE',
    details: 'Checking axios@1.5.0 against OSV.dev vulnerability database. Payload: 48 bytes (No source code).',
  },
  {
    id: 'p3',
    time: '12:00:01.810',
    source: 'AGENT',
    action: 'PREFLIGHT_GATE',
    target: 'CVE-2023-45857',
    verdict: 'WARNING',
    details: 'High severity advisory matched. Bifrost AI Agent verified non-breaking upgrade path to axios@1.6.0.',
  },
  {
    id: 'p4',
    time: '12:00:02.100',
    source: 'CLI',
    action: 'EXFILTRATION_PROOF',
    target: 'Memory & Network Boundary',
    verdict: 'SAFE',
    details: 'Verified 0 bytes of proprietary source code transmitted. All tokens stored in OS keyring.',
  },
]

export default function GitHubLoginGate({ onLoginSuccess, onSkipToWorkspace }: GitHubLoginGateProps) {
  const [tokenInput, setTokenInput] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Workflow tab: 'web' | 'cli'
  const [workflowTab, setWorkflowTab] = useState<'web' | 'cli'>('web')

  // Telemetry stream preview state
  const [previewEvents, setPreviewEvents] = useState<SimulatedEvent[]>(PREVIEW_EVENTS)
  const [isSimulating, setIsSimulating] = useState(false)
  const [copiedText, setCopiedText] = useState<string | null>(null)

  function copyCommand(cmd: string) {
    navigator.clipboard.writeText(cmd)
    setCopiedText(cmd)
    setTimeout(() => setCopiedText(null), 2000)
  }

  function scrollToSection(id: string) {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  function runSimulatedStep() {
    setIsSimulating(true)
    const now = new Date()
    const ts = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0')

    const newSamples: SimulatedEvent[] = [
      {
        id: `sim-${Date.now()}-1`,
        time: ts,
        source: 'CLI',
        action: 'LOCKFILE_SNAPSHOT',
        target: 'uv.lock / package-lock.json',
        verdict: 'SAFE',
        details: 'Verified SHA-256 integrity hashes. Zero private logic or credentials touched.',
      },
      {
        id: `sim-${Date.now()}-2`,
        time: ts,
        source: 'AGENT',
        action: 'REPUTATION_PREFLIGHT',
        target: 'event-stream@3.3.6',
        verdict: 'BLOCKED',
        details: 'Preflight safety check blocked installation: malicious flatmap-stream payload detected.',
      },
      {
        id: `sim-${Date.now()}-3`,
        time: ts,
        source: 'GATEWAY',
        action: 'OSV_BATCH_MATCH',
        target: 'https://api.osv.dev/v1/querybatch',
        verdict: 'SAFE',
        details: 'Audited 18 pinned packages against OSV database. Total outbound payload: 320 bytes.',
      },
    ]

    const pick = newSamples[Math.floor(Math.random() * newSamples.length)]
    setTimeout(() => {
      setPreviewEvents((prev) => [pick, ...prev.slice(0, 5)])
      setIsSimulating(false)
    }, 400)
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
    <div className="landing-page-root">
      {/* 1. Global Modern Landing Navbar */}
      <header className="landing-nav-header">
        <div className="landing-nav-container">
          <div className="landing-brand-group">
            <div className="landing-brand-mark">
              <Shield size={22} />
            </div>
            <div className="landing-brand-text">
              <span className="landing-brand-title">DepShield AI</span>
              <span className="landing-brand-sub">Powered by Bifrost by Maxim AI</span>
            </div>
          </div>

          <nav className="landing-nav-links">
            <button type="button" onClick={() => scrollToSection('features')} className="nav-link-btn">
              Features
            </button>
            <button type="button" onClick={() => scrollToSection('how-it-works')} className="nav-link-btn">
              How It Works
            </button>
            <button type="button" onClick={() => scrollToSection('security-guarantee')} className="nav-link-btn">
              Zero Data Theft
            </button>
            <button type="button" onClick={() => scrollToSection('live-telemetry')} className="nav-link-btn">
              Live Stream
            </button>
          </nav>

          <div className="landing-nav-cta">
            <div className="nav-status-pill">
              <span className="live-pulse" />
              <span>Bifrost Gateway Ready</span>
            </div>
            <button
              type="button"
              className="primary-button nav-signin-btn"
              onClick={() => scrollToSection('auth-card')}
            >
              <Github size={15} />
              <span>Connect Target</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. Hero Section with 3D Holographic Pentest Radar */}
      <section className="landing-hero-section">
        <div className="hero-content-split">
          {/* Left Column: Mission, Value Prop, CTAs */}
          <div className="hero-text-block">
            <div className="theme-pill">
              <Sparkles size={14} />
              <span>Theme: Build an Agent That Pentests a Target on Its Own</span>
            </div>

            <h1 className="hero-main-title">
              Build an Agent That Pentests a Target on Its Own
            </h1>

            <p className="hero-description">
              DepShield is an autonomous security agent powered by <strong>Bifrost by Maxim AI</strong>.
              Point it at any software target: the agent automatically discovers package building blocks,
              probes for real-world exploits, and writes verified, non-breaking fix plans with <strong>zero data theft</strong>.
            </p>

            <div className="hero-cta-row">
              <button
                type="button"
                className="primary-button hero-primary-btn"
                onClick={() => scrollToSection('auth-card')}
              >
                <span>Pentest a Repository</span>
                <ArrowRight size={16} />
              </button>
              <button
                type="button"
                className="secondary-button hero-secondary-btn"
                onClick={() => {
                  setWorkflowTab('cli')
                  scrollToSection('how-it-works')
                }}
              >
                <Terminal size={16} />
                <span>Run in Terminal CLI</span>
              </button>
            </div>

            {/* Quick Metrics Strip */}
            <div className="hero-stats-strip">
              <div className="hero-stat-item">
                <strong>100%</strong>
                <span>OSV.dev Deterministic Feeds</span>
              </div>
              <div className="hero-stat-sep" />
              <div className="hero-stat-item">
                <strong>0 Bytes</strong>
                <span>Source Code Ingestion</span>
              </div>
              <div className="hero-stat-sep" />
              <div className="hero-stat-item">
                <strong>Bifrost</strong>
                <span>Maxim AI Gateway Reasoning</span>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive 3D Pentest Shield Target */}
          <div className="hero-3d-visual-block">
            <Pentest3DShield />
          </div>
        </div>
      </section>

      {/* 3. Authentication & Target Connect Card */}
      <section id="auth-card" className="landing-auth-section">
        <div className="auth-card-container">
          <div className="auth-card-intro">
            <span className="eyebrow">Connect & Audit</span>
            <h2>Select Your Target to Begin Pentesting</h2>
            <p>
              Provide a read-only GitHub Personal Access Token to let DepShield scan dependency manifests.
              Your token is stored safely in browser memory only and never sent to third parties.
            </p>
          </div>

          <div className="auth-card-box">
            <div className="auth-box-header">
              <div className="gh-icon-bubble">
                <Github size={26} />
              </div>
              <div>
                <h3>Connect GitHub Repository Target</h3>
                <p>Read-only <code>repo</code> or <code>public_repo</code> access required.</p>
              </div>
            </div>

            {error && (
              <div className="alert-banner alert-error" role="alert">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleConnect} className="login-form">
              <div className="form-group">
                <label htmlFor="gh-token">
                  <span>Personal Access Token</span>
                  <span className="label-badge">repo scope</span>
                </label>
                <div className="token-field-wrap">
                  <KeyRound size={16} className="field-icon" />
                  <input
                    id="gh-token"
                    type={showToken ? 'text' : 'password'}
                    placeholder="ghp_... or github_pat_..."
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    className="token-field"
                    required
                  />
                  <button
                    type="button"
                    className="toggle-vis-btn"
                    onClick={() => setShowToken(!showToken)}
                    title={showToken ? 'Hide token' : 'Show token'}
                  >
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button type="submit" className="primary-button login-submit-btn" disabled={loading || !tokenInput.trim()}>
                {loading ? (
                  <>
                    <RefreshCw className="animate-spin" size={18} />
                    <span>Connecting to GitHub...</span>
                  </>
                ) : (
                  <>
                    <Github size={18} />
                    <span>Connect Target & Enter Dashboard</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>

            <div className="login-help-section">
              <div className="help-box">
                <span className="help-title">Need a GitHub token?</span>
                <p>Create a token with <code>repo</code> or <code>public_repo</code> read access:</p>
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo&description=DepShield%20AI%20Agent"
                  target="_blank"
                  rel="noreferrer"
                  className="token-link"
                >
                  <span>Generate Token on GitHub</span>
                  <ExternalLink size={13} />
                </a>
              </div>

              {onSkipToWorkspace && (
                <div className="alternate-auth">
                  <span>Or manage organizations directly:</span>
                  <button type="button" className="text-button" onClick={onSkipToWorkspace}>
                    Open Neon Workspace Login →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 4. Core Capabilities Grid */}
      <section id="features" className="landing-section">
        <div className="section-heading-centered">
          <span className="eyebrow">Autonomous Capabilities</span>
          <h2>Built for Autonomous Penetration Testing & Defense</h2>
          <p>
            Traditional scanners only report raw bugs. DepShield uses Bifrost by Maxim AI to evaluate real-world exploit reachability,
            preflight new installs, and keep code private.
          </p>
        </div>

        <div className="login-features-grid">
          <div className="feature-item">
            <div className="feature-icon">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h4>Zero Source Code Ingestion</h4>
              <p>Only package names and versions from <code>package.json</code> or lockfiles are read. Your application source code is completely ignored.</p>
            </div>
          </div>

          <div className="feature-item">
            <div className="feature-icon">
              <Activity size={20} />
            </div>
            <div>
              <h4>Live Audit Telemetry</h4>
              <p>Watch every file access, hash verification, and OSV lookup in real time directly from the dashboard activity stream.</p>
            </div>
          </div>

          <div className="feature-item">
            <div className="feature-icon">
              <Sparkles size={20} />
            </div>
            <div>
              <h4>Grounded Bifrost Explanations</h4>
              <p>Vulnerabilities are deterministically verified against OSV.dev before the Bifrost AI Gateway explains the attack surface.</p>
            </div>
          </div>

          <div className="feature-item">
            <div className="feature-icon">
              <Terminal size={20} />
            </div>
            <div>
              <h4>Safe Install Preflight CLI</h4>
              <p>Blocks malicious or vulnerable packages before download with lifecycle scripts disabled (<code>--ignore-scripts</code>).</p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. How to Use: Web App vs. CLI Interactive Guide */}
      <section id="how-it-works" className="landing-section">
        <div className="workflow-guide-section">
          <div className="section-heading-centered">
            <span className="eyebrow">Interactive Deployment Guide</span>
            <h2>How to Use DepShield: Web App or Developer CLI</h2>
            <p>
              Choose your preferred workflow. Both interfaces stream deterministic audit telemetry
              and adhere to strict zero-exfiltration security guardrails.
            </p>
          </div>

          {/* Workflow Selector Tabs */}
          <div className="workflow-toggle-bar">
            <button
              type="button"
              className={`workflow-tab-btn ${workflowTab === 'web' ? 'active' : ''}`}
              onClick={() => setWorkflowTab('web')}
            >
              <Globe size={18} />
              <span>Web App (Browser Dashboard)</span>
            </button>

            <button
              type="button"
              className={`workflow-tab-btn ${workflowTab === 'cli' ? 'active' : ''}`}
              onClick={() => setWorkflowTab('cli')}
            >
              <Terminal size={18} />
              <span>Developer CLI (Terminal & Real-time Monitor)</span>
            </button>
          </div>

          {/* Workflow Content: Web App */}
          {workflowTab === 'web' && (
            <div className="workflow-steps-grid">
              <div className="workflow-step-card">
                <div className="step-num-pill">01</div>
                <div className="step-content">
                  <h4>Connect GitHub PAT</h4>
                  <p>
                    Provide a token with read-only <code>repo</code> scope. Tokens are retained client-side
                    in browser memory and never transmitted to external third parties.
                  </p>
                </div>
              </div>

              <div className="workflow-step-card">
                <div className="step-num-pill">02</div>
                <div className="step-content">
                  <h4>Select Target Repository</h4>
                  <p>
                    DepShield auto-discovers dependency manifests (<code>package.json</code>, <code>uv.lock</code>, etc.)
                    while completely ignoring proprietary source code files.
                  </p>
                </div>
              </div>

              <div className="workflow-step-card">
                <div className="step-num-pill">03</div>
                <div className="step-content">
                  <h4>Autonomous Agent Pentest</h4>
                  <p>
                    The AI Security Agent queries exact package versions against OSV.dev and provides
                    reachability analysis, blast radius, and verified upgrade paths via Bifrost.
                  </p>
                </div>
              </div>

              <div className="workflow-step-card">
                <div className="step-num-pill">04</div>
                <div className="step-content">
                  <h4>Monitor Telemetry in Real-Time</h4>
                  <p>
                    Verify that zero code was leaked using the real-time activity stream, displaying exact
                    outbound payload sizes and touched descriptors.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Workflow Content: CLI Terminal */}
          {workflowTab === 'cli' && (
            <div className="workflow-steps-grid">
              <div className="workflow-step-card">
                <div className="step-num-pill">01</div>
                <div className="step-content">
                  <h4>Install & Authenticate</h4>
                  <p>Store your GitHub credentials safely in your local OS keyring:</p>
                  <div className="cli-code-snippet">
                    <code>depshield github login --token &lt;PAT&gt;</code>
                    <button
                      type="button"
                      className="copy-snippet-btn"
                      onClick={() => copyCommand('depshield github login --token <PAT>')}
                    >
                      {copiedText === 'depshield github login --token <PAT>' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="workflow-step-card">
                <div className="step-num-pill">02</div>
                <div className="step-content">
                  <h4>Run Safe Preflight Installs</h4>
                  <p>Check candidate packages against OSV before downloading:</p>
                  <div className="cli-code-snippet">
                    <code>depshield add express@4.18.2</code>
                    <button
                      type="button"
                      className="copy-snippet-btn"
                      onClick={() => copyCommand('depshield add express@4.18.2')}
                    >
                      {copiedText === 'depshield add express@4.18.2' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="workflow-step-card">
                <div className="step-num-pill">03</div>
                <div className="step-content">
                  <h4>Start Background File Monitor</h4>
                  <p>Poll lockfiles and stream live telemetry events to the dashboard:</p>
                  <div className="cli-code-snippet">
                    <code>depshield monitor</code>
                    <button
                      type="button"
                      className="copy-snippet-btn"
                      onClick={() => copyCommand('depshield monitor')}
                    >
                      {copiedText === 'depshield monitor' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="workflow-step-card">
                <div className="step-num-pill">04</div>
                <div className="step-content">
                  <h4>Terminal Target Pentest</h4>
                  <p>Perform autonomous audits directly from your command line:</p>
                  <div className="cli-code-snippet">
                    <code>depshield github analyze owner/repo</code>
                    <button
                      type="button"
                      className="copy-snippet-btn"
                      onClick={() => copyCommand('depshield github analyze owner/repo')}
                    >
                      {copiedText === 'depshield github analyze owner/repo' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 6. Security & Zero Data Theft Guarantee Section */}
      <section id="security-guarantee" className="landing-section">
        <div className="transparency-assurance-section">
          <div className="transparency-grid">
            {/* Left: Security Guardrails Breakdown */}
            <div className="transparency-info">
              <div className="assurance-badge">
                <ShieldCheck size={18} />
                <span>Zero Data Theft Guarantee</span>
              </div>

              <h3>How We Guarantee Your Code Never Leaves Your Machine</h3>
              <p className="assurance-text">
                Developers and security engineers should never have to wonder whether an AI agent is reading
                private code or exfiltrating data behind the scenes. DepShield is engineered with strict,
                deterministic sandboxing:
              </p>

              <div className="guardrails-detailed-list">
                <div className="guardrail-detail-row">
                  <div className="guardrail-icon-box allow">
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <strong>What DepShield Reads: Only Dependency Descriptors</strong>
                    <p>
                      Strictly parses manifest files (<code>package.json</code>, <code>package-lock.json</code>, <code>requirements.txt</code>, <code>pyproject.toml</code>, <code>uv.lock</code>).
                    </p>
                  </div>
                </div>

                <div className="guardrail-detail-row">
                  <div className="guardrail-icon-box block">
                    <XCircle size={18} />
                  </div>
                  <div>
                    <strong>What DepShield Strictly Bypasses: Zero Source Code Access</strong>
                    <p>
                      All <code>.ts</code>, <code>.py</code>, <code>.js</code>, <code>.go</code>, <code>.env</code> secrets, and git objects are never opened, read into memory, or uploaded.
                    </p>
                  </div>
                </div>

                <div className="guardrail-detail-row">
                  <div className="guardrail-icon-box allow">
                    <Database size={18} />
                  </div>
                  <div>
                    <strong>Stateless OSV.dev Egress Queries</strong>
                    <p>
                      Outbound queries transmit only <code>(package_name, version)</code> tuples to the public OSV database. No code, commit messages, or repository paths are included.
                    </p>
                  </div>
                </div>

                <div className="guardrail-detail-row">
                  <div className="guardrail-icon-box allow">
                    <Lock size={18} />
                  </div>
                  <div>
                    <strong>Local Keyring & In-Memory Token Isolation</strong>
                    <p>
                      The CLI uses your OS credential store (Windows Credential Locker, macOS Keychain). The web app uses browser session memory. No shared token databases.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Live Interactive Telemetry Console Simulator */}
            <div id="live-telemetry" className="live-preview-console-card">
              <div className="console-header">
                <div className="console-title">
                  <Terminal size={16} />
                  <span>Live Audit Telemetry Stream (Preview)</span>
                </div>
                <button
                  type="button"
                  className="secondary-button sim-step-btn"
                  onClick={runSimulatedStep}
                  disabled={isSimulating}
                >
                  {isSimulating ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Auditing...</span>
                    </>
                  ) : (
                    <>
                      <Play size={13} />
                      <span>Simulate Event</span>
                    </>
                  )}
                </button>
              </div>

              <div className="console-body">
                {previewEvents.map((evt) => (
                  <div key={evt.id} className="console-event-row">
                    <div className="console-event-header">
                      <span className="console-ts">{evt.time}</span>
                      <span className="console-src">[{evt.source}]</span>
                      <span className="console-act">{evt.action}</span>
                      <span className={`console-verdict verdict-${evt.verdict.toLowerCase()}`}>
                        {evt.verdict}
                      </span>
                    </div>
                    <div className="console-target">
                      <span>Target: </span>
                      <code>{evt.target}</code>
                    </div>
                    <div className="console-details">
                      <p>{evt.details}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="console-footer">
                <div className="footer-metric">
                  <ShieldCheck size={14} className="metric-safe-icon" />
                  <span>Source Code Exfiltrated: <strong>0 Bytes</strong></span>
                </div>
                <div className="footer-metric">
                  <Activity size={14} className="metric-live-icon" />
                  <span>Stream Status: <strong>Verified Sandboxed</strong></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Comprehensive Modern Website Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-container">
          <div className="footer-columns-grid">
            {/* Column 1: Brand & Theme Mission */}
            <div className="footer-col brand-col">
              <div className="footer-brand">
                <div className="brand-mark">
                  <Shield size={20} />
                </div>
                <span className="footer-brand-title">DepShield AI</span>
              </div>
              <p className="footer-tagline">
                Autonomous dependency security agent built for the hackathon theme: <em>Build an Agent That Pentests a Target on Its Own</em>.
              </p>
              <div className="footer-status-badge">
                <span className="status-indicator-dot" />
                <span>Bifrost by Maxim AI Engine: Active</span>
              </div>
            </div>

            {/* Column 2: Product Capabilities */}
            <div className="footer-col">
              <h5>Agent Capabilities</h5>
              <ul className="footer-links-list">
                <li><button type="button" onClick={() => scrollToSection('auth-card')}>Autonomous Audits</button></li>
                <li><button type="button" onClick={() => scrollToSection('features')}>Grounded OSV Matching</button></li>
                <li><button type="button" onClick={() => scrollToSection('live-telemetry')}>Live Activity Stream</button></li>
                <li><button type="button" onClick={() => scrollToSection('how-it-works')}>Preflight Install Gates</button></li>
              </ul>
            </div>

            {/* Column 3: Bifrost Gateway */}
            <div className="footer-col">
              <h5>Bifrost Gateway</h5>
              <ul className="footer-links-list">
                <li><a href="https://github.com/maximhq/bifrost" target="_blank" rel="noreferrer">Maxim AI Bifrost Docs <ExternalLink size={12} /></a></li>
                <li><a href="http://localhost:8080" target="_blank" rel="noreferrer">Local Bifrost Dashboard <ExternalLink size={12} /></a></li>
                <li><button type="button" onClick={() => scrollToSection('security-guarantee')}>Zero Code Leakage</button></li>
                <li><button type="button" onClick={() => scrollToSection('features')}>Deterministic Evidence</button></li>
              </ul>
            </div>

            {/* Column 4: Developer Tools */}
            <div className="footer-col">
              <h5>Developer Tools</h5>
              <ul className="footer-links-list">
                <li><code>depshield github login</code></li>
                <li><code>depshield add &lt;pkg&gt;</code></li>
                <li><code>depshield monitor</code></li>
                <li><code>depshield scan</code></li>
              </ul>
            </div>
          </div>

          <div className="footer-bottom-bar">
            <p className="footer-copy">
              &copy; {new Date().getFullYear()} DepShield AI. Powered by <strong>Bifrost by Maxim AI</strong>. Built with React 19, FastAPI, and OSV.dev.
            </p>
            <div className="footer-bottom-tags">
              <span className="footer-tag">Hackathon Project</span>
              <span className="footer-tag">Zero-Data-Theft Verified</span>
              <span className="footer-tag">Flat Seesaw Design</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
