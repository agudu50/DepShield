import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  FileCode,
  Github,
  LoaderCircle,
  LogOut,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import {
  getGitHubUser,
  scanManifest,
  type Ecosystem,
  type GitHubAnalysisReport,
  type GitHubUserProfile,
  type ScanResponse,
} from './api'
import GitHubAgentPanel from './components/GitHubAgentPanel'
import GitHubLoginGate from './components/GitHubLoginGate'
import LiveAuditMonitor from './components/LiveAuditMonitor'
import WorkspacePanel from './WorkspacePanel'
import './App.css'

const STORAGE_KEY = 'depshield_github_pat'

const npmExample = JSON.stringify({ dependencies: { lodash: '4.17.15', express: '^4.18.2' } }, null, 2)
const pythonExample = 'jinja2==2.11.3\nrequests==2.31.0\nurllib3>=1.26.5'
const npmLockExample = JSON.stringify(
  {
    name: 'my-project',
    lockfileVersion: 3,
    packages: {
      '': { name: 'my-project' },
      'node_modules/lodash': { version: '4.17.15' },
      'node_modules/express': { version: '4.18.2' },
    },
  },
  null,
  2,
)
const pythonLockExample = '[[package]]\nname = "requests"\nversion = "2.31.0"\n\n[[package]]\nname = "jinja2"\nversion = "2.11.3"'

type DashboardTab = 'agent' | 'findings' | 'telemetry' | 'scanner' | 'workspace' | 'reports'

export default function App() {
  const [token, setToken] = useState<string>(() => localStorage.getItem(STORAGE_KEY) || '')
  const [user, setUser] = useState<GitHubUserProfile | null>(null)
  const [loadingUser, setLoadingUser] = useState(Boolean(token))
  const [showWorkspaceOnly, setShowWorkspaceOnly] = useState(false)

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<DashboardTab>('agent')

  // Agent Report state
  const [agentReport, setAgentReport] = useState<GitHubAnalysisReport | null>(null)

  // Manual Scan state
  const [projectName, setProjectName] = useState('')
  const [ecosystem, setEcosystem] = useState<Ecosystem>('npm')
  const [manifestType, setManifestType] = useState<'manifest' | 'lockfile'>('manifest')
  const [manifest, setManifest] = useState(npmExample)
  const [scan, setScan] = useState<ScanResponse | null>(null)
  const [scanError, setScanError] = useState('')
  const [isScanning, setIsScanning] = useState(false)

  // Verify stored token on initial load
  useEffect(() => {
    if (!token) {
      setUser(null)
      setLoadingUser(false)
      return
    }

    let active = true
    setLoadingUser(true)

    getGitHubUser(token)
      .then((profile) => {
        if (!active) return
        setUser(profile)
      })
      .catch(() => {
        if (!active) return
        localStorage.removeItem(STORAGE_KEY)
        setToken('')
        setUser(null)
      })
      .finally(() => {
        if (active) setLoadingUser(false)
      })

    return () => {
      active = false
    }
  }, [token])

  function handleLoginSuccess(newToken: string, newUser: GitHubUserProfile) {
    localStorage.setItem(STORAGE_KEY, newToken)
    setToken(newToken)
    setUser(newUser)
    setShowWorkspaceOnly(false)
    setActiveTab('agent')
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE_KEY)
    setToken('')
    setUser(null)
    setAgentReport(null)
    setShowWorkspaceOnly(false)
  }

  async function submitScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsScanning(true)
    setScanError('')
    try {
      const result = await scanManifest({
        project_name: projectName.trim() || 'My project',
        ecosystem,
        manifest_type: manifestType,
        manifest,
      })
      setScan(result)
      setActiveTab('findings')
    } catch (error) {
      setScanError(
        error instanceof Error
          ? error.message
          : 'The scan could not be completed. Ensure the DepShield backend is running at http://localhost:8000.',
      )
    } finally {
      setIsScanning(false)
    }
  }

  function changeEcosystem(value: Ecosystem) {
    setEcosystem(value)
    setManifest(
      value === 'npm'
        ? manifestType === 'lockfile'
          ? npmLockExample
          : npmExample
        : manifestType === 'lockfile'
          ? pythonLockExample
          : pythonExample,
    )
  }

  function changeManifestType(value: 'manifest' | 'lockfile') {
    setManifestType(value)
    setManifest(
      ecosystem === 'npm'
        ? value === 'lockfile'
          ? npmLockExample
          : npmExample
        : value === 'lockfile'
          ? pythonLockExample
          : pythonExample,
    )
  }

  // Combined metrics calculation
  const totalDeps = agentReport?.dependency_count ?? scan?.dependency_count ?? 0
  const checkedDeps = agentReport?.checked_count ?? scan?.checked_count ?? 0
  const matchedVulns = agentReport?.vulnerability_count ?? scan?.vulnerability_count ?? 0
  const unpinnedCount = agentReport?.unpinned_count ?? scan?.unpinned_count ?? 0

  // Combine findings from Agent or Manual Scan
  const agentFindings =
    agentReport?.dependencies.flatMap((dep) =>
      dep.vulnerabilities.map((v) => ({
        packageName: dep.name,
        version: dep.version,
        key: `${dep.name}-${dep.version}-${v.id}`,
        id: v.id,
        severity: 'Advisory',
        aliases: v.aliases,
        summary: v.summary,
        status: dep.status,
      })),
    ) ?? []

  const manualFindings =
    scan?.dependencies.flatMap((dep) =>
      dep.vulnerabilities.map((v) => ({
        packageName: dep.name,
        version: dep.version,
        key: `${dep.name}-${dep.version}-${v.id}`,
        id: v.id,
        severity: 'Advisory',
        aliases: v.aliases,
        summary: v.summary,
        status: dep.status,
      })),
    ) ?? []

  const allFindings = agentFindings.length > 0 ? agentFindings : manualFindings

  // If loading stored session
  if (loadingUser) {
    return (
      <div className="app-shell loading-shell">
        <div className="loading-box">
          <LoaderCircle size={36} className="spin text-cyan" />
          <p>Connecting to DepShield Security Engine...</p>
        </div>
      </div>
    )
  }

  // Screen 1: NOT LOGGED IN -> Show Clean Login Gate
  if (!user && !showWorkspaceOnly) {
    return (
      <div className="app-shell">
        <GitHubLoginGate
          onLoginSuccess={handleLoginSuccess}
          onSkipToWorkspace={() => setShowWorkspaceOnly(true)}
        />
      </div>
    )
  }

  // Screen 2: LOGGED IN -> Show the Complete, Well-Structured Dashboard
  return (
    <div className="app-shell">
      {/* Topbar Header */}
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-mark">
            <Shield size={20} />
          </div>
          <div>
            <p className="eyebrow">Bifrost by Maxim AI</p>
            <h1>DepShield AI</h1>
          </div>
        </div>

        {/* Dashboard Section Navigation Tabs */}
        <nav className="topnav" aria-label="Dashboard navigation">
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'agent' ? 'active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            <Sparkles size={15} />
            <span>AI Agent & Repos</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'findings' ? 'active' : ''}`}
            onClick={() => setActiveTab('findings')}
          >
            <ShieldAlert size={15} />
            <span>Findings</span>
            {matchedVulns > 0 && <span className="tab-pill alert">{matchedVulns}</span>}
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'telemetry' ? 'active' : ''}`}
            onClick={() => setActiveTab('telemetry')}
          >
            <Activity size={15} />
            <span>Live Audit Stream</span>
            <span className="tab-pill live-pulse-pill">LIVE</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'scanner' ? 'active' : ''}`}
            onClick={() => setActiveTab('scanner')}
          >
            <FileCode size={15} />
            <span>Manual Scanner</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'workspace' ? 'active' : ''}`}
            onClick={() => setActiveTab('workspace')}
          >
            <Users size={15} />
            <span>Workspace</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
            onClick={() => setActiveTab('reports')}
          >
            <BarChart3 size={15} />
            <span>Reports</span>
          </button>
        </nav>

        {/* Right Tools & Connected Profile Bar */}
        <div className="topbar-right-wrap">
          <div
            className="topbar-security-pill"
            title="Deterministic isolation: only manifests read, zero source code access"
            onClick={() => setActiveTab('telemetry')}
            role="button"
            tabIndex={0}
          >
            <ShieldCheck size={14} className="text-emerald" />
            <span>Zero Code Retention</span>
            <span className="pill-dot-active" />
          </div>

          <div className="user-profile-widget">
          {user ? (
            <div className="profile-pill">
              <img src={user.avatar_url} alt={user.login} className="profile-thumb" />
              <div className="profile-text">
                <span className="profile-name">@{user.login}</span>
                <span className="profile-sub">{user.public_repos} repos</span>
              </div>
              <button
                type="button"
                className="icon-logout-btn"
                onClick={handleLogout}
                title="Disconnect GitHub account"
              >
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="secondary-button btn-small"
              onClick={() => setShowWorkspaceOnly(false)}
            >
              <Github size={14} /> Connect GitHub
            </button>
          )}
        </div>
      </div>
      </header>

      {/* Main Dashboard Panel */}
      <main className="main-panel">
        {/* Top Summary Stats Bar */}
        <section className="stats-grid" aria-label="Security Overview Statistics">
          <div className="stat-card">
            <span className="stat-label">Connected Repositories</span>
            <div className="stat-value-row">
              <strong>{user ? user.public_repos : '—'}</strong>
              <span className="delta">{user ? `@${user.login}` : 'GitHub linked'}</span>
            </div>
          </div>

          <div className="stat-card">
            <span className="stat-label">Dependencies Audited</span>
            <div className="stat-value-row">
              <strong>{totalDeps > 0 ? totalDeps : '—'}</strong>
              <span className="delta">{agentReport?.ecosystem ?? scan?.ecosystem ?? 'Awaiting audit'}</span>
            </div>
          </div>

          <div className="stat-card">
            <span className="stat-label">Advisories Matched</span>
            <div className="stat-value-row">
              <strong className={matchedVulns > 0 ? 'text-alert' : ''}>{matchedVulns}</strong>
              <span className={matchedVulns > 0 ? 'delta alert' : 'delta'}>OSV.dev authoritative</span>
            </div>
          </div>

          <div className="stat-card">
            <span className="stat-label">Exact Pinned Checked</span>
            <div className="stat-value-row">
              <strong>{checkedDeps > 0 ? checkedDeps : '—'}</strong>
              <span className="delta">
                {unpinnedCount > 0 ? `${unpinnedCount} unpinned` : checkedDeps > 0 ? '100% verified' : 'Lockfile needed'}
              </span>
            </div>
          </div>
        </section>

        {/* Tab 1: AI Agent & GitHub Repositories */}
        {activeTab === 'agent' && (
          <div className="tab-pane">
            {user && (
              <GitHubAgentPanel
                token={token}
                user={user}
                report={agentReport}
                setReport={setAgentReport}
              />
            )}
          </div>
        )}

        {/* Tab 2: Findings */}
        {activeTab === 'findings' && (
          <div className="tab-pane">
            <section className="panel findings-panel">
              <div className="panel-header">
                <div>
                  <h3>Verified OSV Advisories</h3>
                  <p className="scan-help">
                    Vulnerabilities matched deterministically from authoritative OSV.dev feeds.
                  </p>
                </div>
                <span className={`panel-tag ${allFindings.length > 0 ? 'alert' : 'success'}`}>
                  {allFindings.length > 0 ? `${allFindings.length} Active Advisories` : 'Clean / Clear'}
                </span>
              </div>

              {allFindings.length > 0 ? (
                <div className="findings-expanded-list">
                  {allFindings.map((finding) => (
                    <article className="finding-expanded-item" key={finding.key}>
                      <div className="finding-topline">
                        <div className="finding-title-row">
                          <AlertTriangle size={18} className="text-alert" />
                          <h4>{finding.packageName}</h4>
                          <code className="version-pill">{finding.version}</code>
                        </div>
                        <a
                          href={`https://osv.dev/vulnerability/${finding.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="osv-link-badge"
                        >
                          <span>{finding.id}</span>
                          <ExternalLink size={12} />
                        </a>
                      </div>

                      <p className="finding-summary-text">{finding.summary}</p>

                      <div className="finding-meta-row">
                        {finding.aliases.length > 0 && (
                          <div className="alias-tags">
                            <span className="meta-label">Aliases:</span>
                            {finding.aliases.map((alias) => (
                              <span key={alias} className="alias-chip">
                                {alias}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="remediation-guidance">
                          <span className="meta-label">Remediation:</span>
                          <small>Upgrade package to patched version or review agent guidance.</small>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-findings-state">
                  <ShieldCheck size={48} className="text-green" />
                  <h4>No Advisory Matches on Record</h4>
                  <p>
                    {agentReport || scan
                      ? 'All checked pinned dependencies are currently clear of known OSV advisories.'
                      : 'Run an AI Security Agent audit on one of your GitHub repositories or run a manual scan to inspect findings.'}
                  </p>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setActiveTab('agent')}
                  >
                    <Sparkles size={16} /> Audit a Repository
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Tab 3: Real-Time Audit & Telemetry Monitor */}
        {activeTab === 'telemetry' && (
          <div className="tab-pane">
            <LiveAuditMonitor />
          </div>
        )}

        {/* Tab 4: Manual Manifest Scanner */}
        {activeTab === 'scanner' && (
          <div className="tab-pane">
            <section className="panel scan-panel">
              <div className="panel-header">
                <div>
                  <h3>Direct Manifest & Lockfile Scanner</h3>
                  <p className="scan-help">
                    Paste raw npm or Python manifests to check against OSV.dev without connecting a repository.
                  </p>
                </div>
                <div className="badge badge-accent">
                  <FileCode size={14} /> Stateless Scan
                </div>
              </div>

              <form className="scan-form" onSubmit={submitScan}>
                <div className="form-row-grid">
                  <label>
                    Project Name
                    <input
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                      maxLength={100}
                      placeholder="My local project"
                    />
                  </label>

                  <label>
                    Ecosystem
                    <select
                      value={ecosystem}
                      onChange={(event) =>
                        changeEcosystem(event.target.value === 'python' ? 'python' : 'npm')
                      }
                    >
                      <option value="npm">npm (Node.js)</option>
                      <option value="python">Python (PyPI)</option>
                    </select>
                  </label>

                  <label>
                    File Type
                    <select
                      value={manifestType}
                      onChange={(event) =>
                        changeManifestType(event.target.value === 'lockfile' ? 'lockfile' : 'manifest')
                      }
                    >
                      <option value="manifest">Manifest (package.json / requirements.txt)</option>
                      <option value="lockfile">Lockfile (package-lock.json / uv.lock / poetry.lock)</option>
                    </select>
                  </label>
                </div>

                <label className="manifest-field">
                  <span>
                    Paste{' '}
                    {manifestType === 'lockfile'
                      ? ecosystem === 'npm'
                        ? 'package-lock.json'
                        : 'poetry.lock, uv.lock, or Pipfile.lock'
                      : ecosystem === 'npm'
                        ? 'package.json'
                        : 'requirements.txt'}
                  </span>
                  <textarea
                    value={manifest}
                    onChange={(event) => setManifest(event.target.value)}
                    required
                    rows={10}
                    spellCheck={false}
                  />
                </label>

                {scanError && (
                  <div className="alert-banner alert-error" role="alert">
                    <AlertTriangle size={16} />
                    <span>{scanError}</span>
                  </div>
                )}

                <div className="scan-actions">
                  <button type="submit" className="primary-button" disabled={isScanning}>
                    {isScanning ? (
                      <>
                        <LoaderCircle size={16} className="spin" />
                        <span>Querying OSV.dev...</span>
                      </>
                    ) : (
                      <>
                        <Shield size={16} />
                        <span>Run Manifest Scan</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

        {/* Tab 4: Workspace & Organizations */}
        {activeTab === 'workspace' && (
          <div className="tab-pane">
            <div className="workspace-tab-wrap">
              <WorkspacePanel />
            </div>
          </div>
        )}

        {/* Tab 5: Executive Reports & Posture */}
        {activeTab === 'reports' && (
          <div className="tab-pane">
            <section className="panel report-panel">
              <div className="panel-header">
                <div>
                  <h3>Executive Security Posture Overview</h3>
                  <p className="scan-help">
                    Continuous monitoring metrics, coverage confidence, and dependency hygiene indicators.
                  </p>
                </div>
                <button type="button" className="secondary-button btn-small">
                  Export PDF Report <ArrowRight size={14} />
                </button>
              </div>

              <div className="report-grid">
                <div className="report-card-item">
                  <span className="report-label">Exact-Version Coverage</span>
                  <strong>
                    {totalDeps > 0
                      ? `${Math.round((checkedDeps / totalDeps) * 100)}%`
                      : '—'}
                  </strong>
                  <p className="report-note">
                    Percentage of dependencies with pinned exact versions verified against OSV.
                  </p>
                </div>

                <div className="report-card-item">
                  <span className="report-label">Remediation Confidence</span>
                  <strong>{matchedVulns > 0 ? 'High (OSV Pinned)' : 'Clear'}</strong>
                  <p className="report-note">
                    Advisories ground AI investigations strictly in authoritative published evidence.
                  </p>
                </div>

                <div className="report-card-item">
                  <span className="report-label">Deterministic Pipeline</span>
                  <strong className="text-green">100% Deterministic</strong>
                  <p className="report-note">
                    Advisories come from OSV.dev; AI never hallucinates or verifies findings ungrounded.
                  </p>
                </div>
              </div>

              <div className="workflow-card-inset">
                <h4>DepShield Defense Philosophy</h4>
                <ul className="workflow-list-clean">
                  <li>
                    <CheckCircle2 size={16} className="text-green" />
                    <span>1. Exact package names and versions are extracted without executing build scripts.</span>
                  </li>
                  <li>
                    <CheckCircle2 size={16} className="text-green" />
                    <span>2. Deterministic queries against OSV.dev establish affected ranges and known advisories.</span>
                  </li>
                  <li>
                    <CheckCircle2 size={16} className="text-green" />
                    <span>3. The Bifrost AI Security Agent generates blast radius and upgrade explanations.</span>
                  </li>
                  <li>
                    <CheckCircle2 size={16} className="text-green" />
                    <span>4. Pre-install CLI gates intercept dependency additions before installation occurs.</span>
                  </li>
                </ul>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
