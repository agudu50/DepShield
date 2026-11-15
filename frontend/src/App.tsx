import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Download,
  FileCode,
  FileJson,
  Github,
  LoaderCircle,
  Lock,
  LogOut,
  Moon,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import {
  getGitHubUser,
  scanManifest,
  UserFacingError,
  type Ecosystem,
  type GitHubAnalysisReport,
  type GitHubUserProfile,
  type ScanResponse,
} from './api'
import GitHubAgentPanel from './components/GitHubAgentPanel'
import GitHubLoginGate from './components/GitHubLoginGate'
import LiveAuditMonitor from './components/LiveAuditMonitor'
import CommandPalette, { type PaletteItem } from './components/CommandPalette'
import LoadingScreen from './components/dashboard/LoadingScreen'
import DashboardTopbar, { type DashTab } from './components/dashboard/DashboardTopbar'
import StatCards from './components/dashboard/StatCards'
import FindingsPanel from './components/dashboard/FindingsPanel'
import ReportsPanel from './components/dashboard/ReportsPanel'
import { exportFindingsCsv, exportJson, type Finding } from './components/dashboard/exporters'
import WorkspacePanel from './WorkspacePanel'
import { addTelemetryBatch } from './telemetry'
import './App.css'
import './landing-seesaw.css'
import './landing-3d.css'
import './dashboard.css'
import './stream-workspace.css'
import './agent-launch.css'
import './advisory.css'

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

type DashboardTab = 'agent' | 'findings' | 'telemetry' | 'scanner' | 'reports'
const TAB_IDS: DashboardTab[] = ['agent', 'findings', 'telemetry', 'scanner', 'reports']

// `depshield login` opens the dashboard with ?depshield_callback=… to approve the CLI.
const CLI_AUTH_REQUEST = new URLSearchParams(window.location.search).has('depshield_callback')

const TAB_META: Record<DashboardTab, { title: string; em: string; sub: string }> = {
  agent: { title: 'Audit a', em: 'repository.', sub: 'Pick a repository and DepShield checks every pinned dependency against OSV.dev.' },
  findings: { title: 'Your', em: 'findings.', sub: 'Every advisory matched to an exact version in your latest audit or scan.' },
  telemetry: { title: 'Live audit', em: 'stream.', sub: 'Every file your audits read and every lookup they send from this browser, newest first.' },
  scanner: { title: 'Manual', em: 'scan.', sub: 'Paste a manifest or lockfile to check it without connecting a repository. Nothing is stored.' },
  reports: { title: 'Security', em: 'report.', sub: 'A shareable summary of your latest audit. Print it or export it as JSON.' },
}

function readHashTab(): DashboardTab {
  const h = window.location.hash.slice(1) as DashboardTab
  return TAB_IDS.includes(h) ? h : 'agent'
}

export default function App() {
  const [token, setToken] = useState<string>(() => localStorage.getItem(STORAGE_KEY) || '')
  const [user, setUser] = useState<GitHubUserProfile | null>(null)
  const [loadingUser, setLoadingUser] = useState(Boolean(token))
  const [bootError, setBootError] = useState<string | null>(null)
  const [bootAttempt, setBootAttempt] = useState(0)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const [showWorkspaceOnly, setShowWorkspaceOnly] = useState(false)
  const verifiedToken = useRef<string | null>(null)

  // Light / Dark Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('depshield_theme')
    return saved === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('depshield_theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  // Tabs live in the URL hash, so reload, deep links and Back/Forward all work.
  const [activeTab, setActiveTabState] = useState<DashboardTab>(readHashTab)
  useEffect(() => {
    const onHash = () => setActiveTabState(readHashTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const setActiveTab = useCallback((tab: DashboardTab) => {
    if (window.location.hash !== `#${tab}`) window.location.hash = tab
    setActiveTabState(tab)
  }, [])

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const notify = useCallback((message: string) => setToast({ id: Date.now(), message }), [])
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(t)
  }, [toast])

  // Agent Report state
  const [agentReport, setAgentReport] = useState<GitHubAnalysisReport | null>(null)

  // Manual Scan state
  const [projectName, setProjectName] = useState('')
  const [ecosystem, setEcosystem] = useState<Ecosystem>('npm')
  const [manifestType, setManifestType] = useState<'manifest' | 'lockfile'>('manifest')
  const [manifest, setManifest] = useState('')
  const [scan, setScan] = useState<ScanResponse | null>(null)
  const [scanError, setScanError] = useState('')
  const [isScanning, setIsScanning] = useState(false)

  // Verify a stored token on load. Only a rejected token signs you out; being
  // offline keeps the token and offers a retry instead.
  useEffect(() => {
    if (!token) {
      setUser(null)
      setLoadingUser(false)
      return
    }
    if (verifiedToken.current === token) {
      setLoadingUser(false)
      return
    }

    let active = true
    setLoadingUser(true)
    setBootError(null)

    getGitHubUser(token)
      .then((profile) => {
        if (!active) return
        verifiedToken.current = token
        setUser(profile)
        setLoadingUser(false)
      })
      .catch((err) => {
        if (!active) return
        const retryable = err instanceof UserFacingError && (err.kind === 'network' || err.kind === 'service')
        if (retryable) {
          setBootError(err.message)
          return
        }
        localStorage.removeItem(STORAGE_KEY)
        setToken('')
        setUser(null)
        setLoadingUser(false)
        setSessionNotice('Your saved GitHub session is no longer valid. Connect a token to continue.')
      })

    return () => {
      active = false
    }
  }, [token, bootAttempt])

  function handleLoginSuccess(newToken: string, newUser: GitHubUserProfile) {
    verifiedToken.current = newToken
    localStorage.setItem(STORAGE_KEY, newToken)
    setToken(newToken)
    setUser(newUser)
    setSessionNotice(null)
    setShowWorkspaceOnly(false)
    setActiveTab('agent')
  }

  const handleLogout = useCallback(() => {
    verifiedToken.current = null
    localStorage.removeItem(STORAGE_KEY)
    setToken('')
    setUser(null)
    setAgentReport(null)
    setBootError(null)
    setLoadingUser(false)
    setShowWorkspaceOnly(false)
  }, [])

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
      notify(
        result.vulnerability_count
          ? `Scan complete: ${result.vulnerability_count} advisor${result.vulnerability_count === 1 ? 'y' : 'ies'} found`
          : 'Scan complete: no known advisories',
      )

      // Record real scan telemetry
      addTelemetryBatch([
        {
          source: 'gateway',
          category: 'file_read',
          action: 'DESCRIPTOR_DISCOVERY',
          target: `${projectName.trim() || 'Manual Target'} (${ecosystem} ${manifestType})`,
          details: `Stateless scan initiated. Parsed ${result.dependency_count} declared dependencies. ZERO application source code read.`,
          verdict: 'safe',
          bytesSent: 0,
          sourceCodeRead: 0,
          project: projectName.trim() || 'Manual Target',
        },
        {
          source: 'gateway',
          category: 'osv_query',
          action: 'OSV_BATCH_LOOKUP',
          target: 'https://api.osv.dev/v1/querybatch',
          details: `Queried OSV database for ${result.dependency_count} packages. Identified ${result.vulnerability_count} active security advisories.`,
          verdict: result.vulnerability_count > 0 ? 'warning' : 'safe',
          bytesSent: result.dependency_count * 28,
          sourceCodeRead: 0,
          project: projectName.trim() || 'Manual Target',
        },
      ])
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'The scan couldn’t be completed. Please try again.')
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
  const hasResults = Boolean(agentReport || scan)
  const sourceName = agentReport?.repository ?? (scan ? scan.project_name : null)
  const exportLabel = (sourceName ?? 'scan').replace(/[^\w.-]+/g, '-')

  const allFindings: Finding[] = useMemo(() => {
    const deps = agentReport?.dependencies ?? scan?.dependencies ?? []
    return deps.flatMap((dep) =>
      dep.vulnerabilities.map((v) => ({
        key: `${dep.name}-${dep.version}-${v.id}`,
        packageName: dep.name,
        version: dep.version,
        id: v.id,
        aliases: v.aliases,
        summary: v.summary,
        status: dep.status,
        ecosystem: dep.ecosystem,
      })),
    )
  }, [agentReport, scan])
  const packagesAffected = new Set(allFindings.map((f) => f.packageName)).size

  const tabs: DashTab<DashboardTab>[] = [
    { id: 'agent', label: 'Audit', icon: <ShieldCheck size={14} /> },
    {
      id: 'findings',
      label: 'Findings',
      icon: <ShieldAlert size={14} />,
      badge: matchedVulns > 0 ? { text: String(matchedVulns), tone: 'alert' } : undefined,
    },
    {
      id: 'telemetry',
      label: 'Live stream',
      icon: user ? <Activity size={14} /> : <Lock size={14} />,
      badge: user ? { text: 'Live', tone: 'live' } : undefined,
    },
    { id: 'scanner', label: 'Manual scan', icon: <FileCode size={14} /> },
    { id: 'reports', label: 'Report', icon: user ? <BarChart3 size={14} /> : <Lock size={14} /> },
  ]

  /** Shown on tabs that need a connected GitHub account. */
  function lockedPanel(title: string, body: string) {
    return (
      <section className="hbd-panel hbd-empty">
        <div className="hbd-empty-art" aria-hidden="true">
          <span className="hbd-empty-card c1" />
          <span className="hbd-empty-card c2" />
          <span className="hbd-empty-card c3"><Lock size={26} strokeWidth={1.5} /></span>
        </div>
        <h3 className="hbd-serif">{title}</h3>
        <p>{body}</p>
        <button type="button" className="hb-btn hb-btn-primary" onClick={() => setShowWorkspaceOnly(false)}>
          <Github size={15} /> Connect GitHub
        </button>
      </section>
    )
  }

  const inDashboard = !loadingUser && !bootError && (Boolean(user) || showWorkspaceOnly)

  // Keyboard: ⌘/Ctrl+K opens commands; 1–6 switch tabs when you aren't typing.
  useEffect(() => {
    if (!inDashboard) return
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      const el = e.target as HTMLElement
      const typing = el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
      if (typing || e.metaKey || e.ctrlKey || e.altKey || paletteOpen) return
      const n = Number(e.key)
      if (n >= 1 && n <= TAB_IDS.length) setActiveTab(TAB_IDS[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inDashboard, paletteOpen, setActiveTab])

  const paletteItems: PaletteItem[] = [
    ...tabs.map((t, i) => ({
      id: `tab-${t.id}`,
      group: 'Go to',
      label: t.label,
      hint: String(i + 1),
      icon: t.icon,
      run: () => setActiveTab(t.id),
    })),
    ...(allFindings.length
      ? [
          { id: 'csv', group: 'Export', label: 'Download findings as CSV', icon: <Download size={14} />, run: () => { exportFindingsCsv(allFindings, exportLabel); notify('Downloaded CSV') } },
          { id: 'json', group: 'Export', label: 'Download findings as JSON', icon: <FileJson size={14} />, run: () => { exportJson(allFindings, `${exportLabel}-findings`); notify('Downloaded JSON') } },
        ]
      : []),
    { id: 'theme', group: 'Preferences', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`, icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />, run: toggleTheme },
    ...(user
      ? [
          { id: 'profile', group: 'Account', label: 'Open GitHub profile', icon: <Github size={14} />, run: () => window.open(user.html_url, '_blank', 'noopener') },
          { id: 'logout', group: 'Account', label: 'Sign out', icon: <LogOut size={14} />, run: handleLogout },
        ]
      : []),
  ]

  // Saved session being verified (or verification failed for a retryable reason)
  if (loadingUser || bootError) {
    return (
      <LoadingScreen
        error={bootError}
        onRetry={() => setBootAttempt((n) => n + 1)}
        onCancel={handleLogout}
      />
    )
  }

  // Screen 1: NOT LOGGED IN -> landing page
  if (!user && !showWorkspaceOnly && !CLI_AUTH_REQUEST) {
    return (
      <GitHubLoginGate
        onLoginSuccess={handleLoginSuccess}
        onSkipToWorkspace={() => setShowWorkspaceOnly(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
        initialError={sessionNotice}
      />
    )
  }

  const meta = TAB_META[activeTab]

  // Screen 2: dashboard
  return (
    <div className="app-shell hb-dash">
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />

      <DashboardTopbar
        tabs={tabs}
        active={activeTab}
        onSelect={setActiveTab}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenPalette={() => setPaletteOpen(true)}
        user={user}
        onLogout={handleLogout}
        onConnect={() => setShowWorkspaceOnly(false)}
      />

      <main className="main-panel hbd-main">
        {CLI_AUTH_REQUEST ? (
          <>
            <header className="hbd-page-head">
              <span className="hb-kicker">DepShield CLI</span>
              <h1 className="hbd-page-title">
                Authorize the <em>CLI.</em>
              </h1>
              <p className="hbd-page-sub">
                Your terminal is waiting for approval. Sign in, then approve it; the token goes only to your local CLI.
              </p>
            </header>
            <div className="workspace-tab-wrap">
              <WorkspacePanel />
            </div>
          </>
        ) : (
          <>
        <header className="hbd-page-head" key={activeTab}>
          <span className="hb-kicker">
            <span className="hb-kicker-n">{String(TAB_IDS.indexOf(activeTab) + 1).padStart(2, '0')}</span>
            {sourceName ? ` Latest: ${sourceName}` : ' DepShield'}
          </span>
          <h1 className="hbd-page-title">
            {meta.title} <em>{meta.em}</em>
          </h1>
          <p className="hbd-page-sub">{meta.sub}</p>
        </header>

        {activeTab !== 'telemetry' && !(activeTab === 'reports' && !user) && (
          <StatCards
            stats={[
              { label: 'Public repositories', value: user ? user.public_repos : null, note: user ? `@${user.login}` : 'GitHub not connected' },
              { label: 'Dependencies audited', value: hasResults ? totalDeps : null, note: agentReport?.ecosystem ?? scan?.ecosystem ?? 'Awaiting an audit', onClick: hasResults ? () => setActiveTab('reports') : undefined },
              { label: 'Advisories matched', value: hasResults ? matchedVulns : null, note: 'From OSV.dev', tone: 'alert', onClick: () => setActiveTab('findings') },
              {
                label: 'Pinned & checked',
                value: hasResults ? checkedDeps : null,
                note: unpinnedCount > 0 ? `${unpinnedCount} unpinned range${unpinnedCount === 1 ? '' : 's'}` : hasResults ? 'All pinned' : 'A lockfile gives full coverage',
              },
            ]}
          />
        )}

        <div className="tab-pane hbd-pane" key={`pane-${activeTab}`}>
          {activeTab === 'agent' &&
            (user ? (
              <GitHubAgentPanel
                token={token}
                user={user}
                report={agentReport}
                setReport={setAgentReport}
                onManualScan={() => setActiveTab('scanner')}
              />
            ) : (
              <section className="hbd-panel hbd-empty">
                <h3 className="hbd-serif">Connect GitHub to audit repositories</h3>
                <p>You’re in the workspace without a GitHub token. Connect one to pick a repository, or use the manual scanner.</p>
                <div className="hb-hero-ctas">
                  <button type="button" className="hb-btn hb-btn-primary" onClick={() => setShowWorkspaceOnly(false)}>
                    <Github size={15} /> Connect GitHub
                  </button>
                  <button type="button" className="hb-btn hb-btn-ghost" onClick={() => setActiveTab('scanner')}>
                    <FileCode size={15} /> Manual scan
                  </button>
                </div>
              </section>
            ))}

          {activeTab === 'findings' && (
            <FindingsPanel
              findings={allFindings}
              hasResults={hasResults}
              sourceLabel={exportLabel}
              onAudit={() => setActiveTab(user ? 'agent' : 'scanner')}
              notify={notify}
            />
          )}

          {activeTab === 'telemetry' &&
            (user ? (
              <LiveAuditMonitor notify={notify} />
            ) : (
              /* The stream can contain repository names from earlier sessions; only show it once signed in. */
              lockedPanel(
                'Connect GitHub to see your audit stream',
                'The live stream shows which repositories and files your audits read. It’s only available once you’ve connected a GitHub account.',
              )
            ))}

          {activeTab === 'scanner' && (
            <section className="panel scan-panel hbd-panel">
              <form className="scan-form" onSubmit={submitScan}>
                <div className="form-row-grid">
                  <label>
                    Project name
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
                      onChange={(event) => changeEcosystem(event.target.value === 'python' ? 'python' : 'npm')}
                    >
                      <option value="npm">npm (Node.js)</option>
                      <option value="python">Python (PyPI)</option>
                    </select>
                  </label>

                  <label>
                    File type
                    <select
                      value={manifestType}
                      onChange={(event) => changeManifestType(event.target.value === 'lockfile' ? 'lockfile' : 'manifest')}
                    >
                      <option value="manifest">Manifest (package.json / requirements.txt)</option>
                      <option value="lockfile">Lockfile (package-lock.json / uv.lock / poetry.lock)</option>
                    </select>
                  </label>
                </div>

                <label className="manifest-field">
                  <span className="hbd-field-row">
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
                    {!manifest && (
                      <button type="button" className="hbd-link" onClick={() => changeManifestType(manifestType)}>
                        Insert an example
                      </button>
                    )}
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
                  <button type="submit" className="hb-btn hb-btn-primary" disabled={isScanning || !manifest.trim()}>
                    {isScanning ? (
                      <>
                        <LoaderCircle size={16} className="spin" /> Checking OSV.dev…
                      </>
                    ) : (
                      <>
                        <Shield size={16} /> Run scan
                      </>
                    )}
                  </button>
                </div>
              </form>
            </section>
          )}

          {activeTab === 'reports' &&
            (user ? (
              <ReportsPanel
                totalDeps={totalDeps}
                checkedDeps={checkedDeps}
                unpinned={unpinnedCount}
                advisories={matchedVulns}
                packagesAffected={packagesAffected}
                source={sourceName}
                report={agentReport ?? scan}
                notify={notify}
              />
            ) : (
              lockedPanel(
                'Connect GitHub to see your security report',
                'The report summarizes your repository audits: coverage, matched advisories and how they were checked. It’s only available once you’ve connected a GitHub account.',
              )
            ))}
        </div>
          </>
        )}
      </main>

      <div className="hbd-toast-region" aria-live="polite">
        {toast && (
          <div className="hbd-toast" key={toast.id} role="status">
            {toast.message}
          </div>
        )}
      </div>
    </div>
  )
}
