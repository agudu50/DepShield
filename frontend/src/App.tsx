import { useState } from 'react'
import type { FormEvent } from 'react'
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, LoaderCircle, Shield, Sparkles, TrendingUp } from 'lucide-react'
import { scanManifest, type Ecosystem, type ScanResponse } from './api'
import WorkspacePanel from './WorkspacePanel'
import './App.css'

const defaultStats = [
  { label: 'Projects monitored', value: '—', delta: 'No project linked', tone: 'positive' },
  { label: 'Advisories matched', value: '—', delta: 'Run a scan', tone: 'positive' },
  { label: 'Exact versions checked', value: '—', delta: 'Run a scan', tone: 'positive' },
  { label: 'Remediations', value: '—', delta: 'Not implemented', tone: 'positive' },
]

const workflows = [
  'Parse npm package.json and Python requirements.txt manifests',
  'Query OSV.dev for exact pinned package versions',
  'Explain returned advisory evidence through the configured Bifrost gateway',
]

const npmExample = JSON.stringify({ dependencies: { lodash: '4.17.15' } }, null, 2)
const pythonExample = 'jinja2==2.11.3\nrequests==2.31.0'
const npmLockExample = JSON.stringify({
  name: 'my-project',
  lockfileVersion: 3,
  packages: {
    '': { name: 'my-project' },
    'node_modules/lodash': { version: '4.17.15' },
  },
}, null, 2)
const pythonLockExample = '[[package]]\nname = "requests"\nversion = "2.31.0"'

function App() {
  const [scanOpen, setScanOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [ecosystem, setEcosystem] = useState<Ecosystem>('npm')
  const [manifestType, setManifestType] = useState<'manifest' | 'lockfile'>('manifest')
  const [manifest, setManifest] = useState(npmExample)
  const [scan, setScan] = useState<ScanResponse | null>(null)
  const [scanError, setScanError] = useState('')
  const [isScanning, setIsScanning] = useState(false)

  const scannedFindings = scan?.dependencies.flatMap((dependency) =>
    dependency.vulnerabilities.map((vulnerability) => ({
      packageName: dependency.name,
      version: dependency.version,
      key: `${dependency.name}-${dependency.version}-${vulnerability.id}`,
      severity: 'Advisory',
      fix: vulnerability.aliases.length ? vulnerability.aliases.join(', ') : vulnerability.id,
      risk: vulnerability.summary,
    })),
  )
  const visibleFindings = scan ? scannedFindings : []
  const stats = scan
    ? [
        { label: 'Dependencies found', value: String(scan.dependency_count), delta: scan.ecosystem, tone: 'positive' },
        { label: 'Advisories matched', value: String(scan.vulnerability_count), delta: 'OSV.dev', tone: scan.vulnerability_count ? 'alert' : 'positive' },
        { label: 'Exact versions checked', value: String(scan.checked_count), delta: 'OSV lookup', tone: 'positive' },
        { label: 'Version ranges not checked', value: String(scan.unpinned_count), delta: 'Lockfile needed', tone: scan.unpinned_count ? 'alert' : 'positive' },
      ]
    : defaultStats

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
      setScanOpen(false)
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'The scan could not be completed')
    } finally {
      setIsScanning(false)
    }
  }

  function changeEcosystem(value: Ecosystem) {
    setEcosystem(value)
    setManifest(value === 'npm'
      ? manifestType === 'lockfile' ? npmLockExample : npmExample
      : manifestType === 'lockfile' ? pythonLockExample : pythonExample)
  }

  function changeManifestType(value: 'manifest' | 'lockfile') {
    setManifestType(value)
    setManifest(ecosystem === 'npm'
      ? value === 'lockfile' ? npmLockExample : npmExample
      : value === 'lockfile' ? pythonLockExample : pythonExample)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-mark">
            <Shield size={18} />
          </div>
          <div>
            <p className="eyebrow">Security Intelligence</p>
            <h1>DepShield AI</h1>
          </div>
        </div>

        <nav className="topnav" aria-label="Primary navigation">
          <a href="#overview">Overview</a>
          <a href="#findings">Findings</a>
          <a href="#workflow">Workflow</a>
          <a href="#reports">Reports</a>
        </nav>

        <button type="button" className="primary-button" onClick={() => setScanOpen(true)}>
          Start scan
        </button>
      </header>

      <main className="main-panel">
        <div className="demo-banner" role="status">
          {scan
            ? 'The latest manifest scan is live; project history, risk trends, and remediation metrics are not available yet.'
            : 'No project is connected. Dashboard metrics remain unavailable until you run a manifest scan.'}
        </div>
        <WorkspacePanel />
        <section className="hero-panel" id="overview">
          <div className="hero-copy">
            <span className="badge">
              <Sparkles size={14} />
              AI-assisted dependency defense
            </span>
            <h2>Find vulnerable dependencies before they reach production.</h2>
            <p>
              Check exact npm and Python dependency versions against OSV.dev, then use evidence-grounded
              AI explanations to understand returned advisories.
            </p>
            <div className="actions">
              <button type="button" className="primary-button" onClick={() => setScanOpen(true)}>Analyze manifest</button>
              <button type="button" className="secondary-button">View report</button>
            </div>
          </div>

          <div className="hero-card">
            <div className="card-header">
              <span className={scan ? 'status-dot' : 'status-dot idle'} />
              <span>{scan ? 'Latest scan snapshot' : 'Awaiting first scan'}</span>
            </div>
            <div className="risk-ring">
              <div className="risk-ring-inner">
                <strong>{scan?.vulnerability_count ?? '—'}</strong>
                <span>OSV matches</span>
              </div>
            </div>
            <ul className="mini-list">
              <li><CheckCircle2 size={16} /> {scan ? `${scan.checked_count} exact versions checked` : 'No scan results yet'}</li>
              <li><TrendingUp size={16} /> {scan ? `${scan.unpinned_count} version ranges not checked` : 'Version ranges are not queried'}</li>
              <li><Activity size={16} /> {scan ? `${scan.dependency_count} dependencies parsed` : 'Run a manifest scan to begin'}</li>
            </ul>
          </div>
        </section>

        {scanOpen && (
          <section className="panel scan-panel" aria-labelledby="scan-title">
            <div className="panel-header">
              <div>
                <h3 id="scan-title">Scan a dependency manifest</h3>
                <p className="scan-help">Manifest text is sent to this API for parsing; only exact package names and versions are sent to OSV.dev. No repository path or archive is read.</p>
              </div>
              <button type="button" className="secondary-button small-button" onClick={() => setScanOpen(false)}>Close</button>
            </div>
            <form className="scan-form" onSubmit={submitScan}>
              <label>
                Project name
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={100} placeholder="My project" />
              </label>
              <label>
                Ecosystem
                <select value={ecosystem} onChange={(event) => changeEcosystem(event.target.value === 'python' ? 'python' : 'npm')}>
                  <option value="npm">npm</option>
                  <option value="python">Python</option>
                </select>
              </label>
              <label>
                File type
                <select value={manifestType} onChange={(event) => changeManifestType(event.target.value === 'lockfile' ? 'lockfile' : 'manifest')}>
                  <option value="manifest">Manifest</option>
                  <option value="lockfile">Lockfile</option>
                </select>
              </label>
              <label className="manifest-field">
                Paste {manifestType === 'lockfile'
                  ? ecosystem === 'npm' ? 'package-lock.json' : 'poetry.lock, uv.lock, or Pipfile.lock'
                  : ecosystem === 'npm' ? 'package.json' : 'requirements.txt'}
                <textarea value={manifest} onChange={(event) => setManifest(event.target.value)} required rows={9} spellCheck={false} />
              </label>
              <p className="scan-help">Lockfiles include resolved transitive dependencies when present. OSV checks exact versions only; unpinned manifest ranges remain unchecked.</p>
              {scanError && <p className="scan-error" role="alert">{scanError}</p>}
              <button type="submit" className="primary-button" disabled={isScanning}>
                {isScanning ? <><LoaderCircle size={16} className="spin" /> Scanning...</> : 'Run scan'}
              </button>
            </form>
          </section>
        )}

        {scan && (
          <section className="scan-result-banner" role="status">
            <div>
              <strong>Latest scan: {scan.project_name}</strong>
              <span>{scan.checked_count} exact versions checked against OSV.dev{scan.unpinned_count ? ` · ${scan.unpinned_count} version ranges were not checked` : ''}</span>
            </div>
            <button type="button" className="secondary-button small-button" onClick={() => setScanOpen(true)}>Scan again</button>
          </section>
        )}

        <section className="stats-grid" aria-label="Overview statistics">
          {stats.map((stat) => (
            <div className="stat-card" key={stat.label}>
              <span className="stat-label">{stat.label}</span>
              <div className="stat-value-row">
                <strong>{stat.value}</strong>
                <span className={stat.tone === 'alert' ? 'delta alert' : 'delta'}>{stat.delta}</span>
              </div>
            </div>
          ))}
        </section>

        <section className="content-grid">
          <div className="panel findings-panel" id="findings">
            <div className="panel-header">
              <h3>{scan ? 'OSV advisory matches' : 'Priority findings'}</h3>
              <span className="panel-tag">{scan ? `${scan.vulnerability_count} matched` : 'No scan yet'}</span>
            </div>
            <div className="finding-list">
              {visibleFindings?.map((item) => (
                <article className="finding-item" key={item.key}>
                  <div className="finding-topline">
                    <div>
                      <h4>{item.packageName}</h4>
                      <span>{item.version}</span>
                    </div>
                    <span className={`severity ${item.severity.toLowerCase()}`}>{item.severity}</span>
                  </div>
                  <p>{item.risk}</p>
                  <div className="finding-foot">
                    <span>Remediation</span>
                    <small>{item.fix}</small>
                  </div>
                </article>
              ))}
              {scan && visibleFindings?.length === 0 && (
                <p className="empty-findings">No known advisories were returned for checked versions. This is not a guarantee that dependencies are safe.</p>
              )}
              {!scan && (
                <p className="empty-findings">Run a manifest scan to show verified OSV advisory matches here. No sample findings are presented as real results.</p>
              )}
              {scan?.dependencies.filter((dependency) => dependency.status === 'version_range').map((dependency) => (
                <article className="finding-item unchecked-item" key={`unchecked-${dependency.name}`}>
                  <div className="finding-topline">
                    <div><h4>{dependency.name}</h4><span>{dependency.version}</span></div>
                    <span className="severity unchecked">Not checked</span>
                  </div>
                  <p>This version range cannot be queried as an exact release.</p>
                </article>
              ))}
            </div>
          </div>

          <div className="panel insights-panel" id="workflow">
            <div className="panel-header">
              <h3>Deterministic workflow</h3>
              <span className="panel-tag success">Safe by design</span>
            </div>
            <ul className="workflow-list">
              {workflows.map((step) => (
                <li key={step}>
                  <span className="workflow-check"><CheckCircle2 size={16} /></span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>

            <div className="alert-box">
              <AlertTriangle size={16} />
              <p>Advisories come from OSV.dev. The backend agent can explain matched evidence when Bifrost is configured.</p>
            </div>
          </div>
        </section>

        <section className="panel report-panel" id="reports">
          <div className="panel-header">
            <h3>Executive Overview</h3>
            <button type="button" className="secondary-button small-button">
              Export report <ArrowRight size={16} />
            </button>
          </div>

          <div className="report-grid">
            <div>
              <span className="report-label">Exact-version coverage</span>
              <strong>{scan && scan.dependency_count > 0 ? `${Math.round((scan.checked_count / scan.dependency_count) * 100)}%` : '—'}</strong>
            </div>
            <div>
              <span className="report-label">Remediation confidence</span>
              <strong>Not assessed</strong>
            </div>
            <div>
              <span className="report-label">Risk trend</span>
              <strong>Needs scan history</strong>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
