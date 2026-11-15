import { useState, useEffect, useRef } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Info,
  ExternalLink,
  FileCode,
  FolderOpen,
  GitBranch,
  Globe,
  Lock,
  PackageSearch,
  RefreshCw,
  ScanSearch,
  Search,
  X,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react'
import {
  analyzeGitHubRepo,
  detectGitHubManifests,
  type GitHubAnalysisReport,
  type GitHubManifestFile,
  type GitHubRepository,
  type GitHubUserProfile,
} from '../api'
import { addTelemetryBatch } from '../telemetry'
import ModelPicker from './ModelPicker'
import RepoSidebar from './RepoSidebar'
import { getAuditRun, getAuditSession, startAudit, subscribeAuditRun, type AuditRunState } from './auditSession'
import AdvisoryModal, { type AdvisoryTarget } from './AdvisoryModal'
import RemediationList, { type VulnerablePackage } from './RemediationList'
import {
  auditTelemetry,
  coveredByLockfile,
  groupByDir,
  mergeReports,
  recommendedSelection,
} from './manifestAudit'

interface GitHubAgentPanelProps {
  token: string
  user: GitHubUserProfile
  report: GitHubAnalysisReport | null
  setReport: (report: GitHubAnalysisReport | null) => void
  /** Optional: jump to the manual scanner (used when a repo has no detectable manifests). */
  onManualScan?: () => void
}

const PRESETS = [
  { label: 'Comprehensive audit', text: 'Identify all critical vulnerabilities, assess reachability, and provide safe upgrade paths.' },
  { label: 'RCE & exploitability', text: 'Focus strictly on remote code execution, prototype pollution, and SSRF.' },
  { label: 'Safe upgrade paths', text: 'Recommend the smallest version bump that leaves each affected range, and flag likely breaking changes.' },
]
const SCANNED_DIRS = ['repository root', 'backend/', 'frontend/', 'server/', 'client/', 'src/']
const SUPPORTED_FILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'requirements.txt', 'pyproject.toml', 'uv.lock', 'poetry.lock', 'Pipfile.lock']
const SUPPORTED_LANGS = ['javascript', 'typescript', 'python', 'jupyter notebook', 'vue', 'svelte']

export default function GitHubAgentPanel({
  token,
  user,
  report,
  setReport,
  onManualScan,
}: GitHubAgentPanelProps) {
  // Restore where you were when coming back to this tab (state survives tab switches).
  const session = getAuditSession(token)
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepository | null>(() => session.selectedRepo)
  const [manifests, setManifests] = useState<GitHubManifestFile[]>(() =>
    session.selectedRepo ? (session.manifests.get(session.selectedRepo.full_name) ?? []) : [],
  )
  const [selectedManifests, setSelectedManifests] = useState<string[]>(() =>
    session.selectedRepo ? (session.selection.get(session.selectedRepo.full_name) ?? []) : [],
  )
  // Audit progress lives in a background runner so it survives leaving this tab.
  const [run, setRun] = useState<AuditRunState>(getAuditRun)
  useEffect(() => subscribeAuditRun(setRun), [])
  const runs = run.runs
  const [reportView, setReportView] = useState<string>(() => session.reportView)
  const [manifestReload, setManifestReload] = useState(0)
  const forceRescan = useRef(false)
  // Which repo the loaded manifests (and so the checkbox selection) belong to.
  const manifestsFor = useRef<string | null>(
    session.selectedRepo && session.manifests.has(session.selectedRepo.full_name) ? session.selectedRepo.full_name : null,
  )
  const [question, setQuestion] = useState(() => session.question ?? PRESETS[0].text)

  const [aiModel, setAiModel] = useState<string | null>(null)
  const [loadingManifests, setLoadingManifests] = useState(false)
  const analyzing = run.status === 'running'
  const [error, setError] = useState('')
  const notice = run.notice

  // View state: 'launchpad' (manifests & trigger) vs 'report' (results)
  const [viewMode, setViewMode] = useState<'launchpad' | 'report'>(() =>
    report && session.selectedRepo?.full_name === report.repository ? session.viewMode : 'launchpad',
  )

  // Write the restorable bits back as they change.
  useEffect(() => {
    const s = getAuditSession(token)
    s.selectedRepo = selectedRepo
    s.question = question
    s.viewMode = viewMode
    s.reportView = reportView
    // Only save the selection once it belongs to this repo (not mid-switch).
    if (selectedRepo && manifestsFor.current === selectedRepo.full_name) s.selection.set(selectedRepo.full_name, selectedManifests)
  }, [token, selectedRepo, question, viewMode, reportView, selectedManifests])

  // Findings table filter & pagination
  const [depFilter, setDepFilter] = useState<'all' | 'vuln' | 'clean'>('vuln')
  const [depSearch, setDepSearch] = useState('')
  const [depPage, setDepPage] = useState(1)
  const [advisory, setAdvisory] = useState<AdvisoryTarget | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set())

  const PAGE_SIZE = 15

  // When a repository is selected, discover its manifests
  useEffect(() => {
    if (!token || !selectedRepo) {
      setManifests([])
      setSelectedManifests([])
      return
    }

    const s = getAuditSession(token)
    const key = selectedRepo.full_name
    const cachedManifests = s.manifests.get(key)
    if (cachedManifests && !forceRescan.current) {
      // Already discovered this session: no network round-trip.
      manifestsFor.current = key
      setManifests(cachedManifests)
      setSelectedManifests(s.selection.get(key) ?? recommendedSelection(cachedManifests))
      setLoadingManifests(false)
      return
    }
    forceRescan.current = false
    manifestsFor.current = null

    let active = true
    setLoadingManifests(true)
    setError('')

    const [owner, repoName] = selectedRepo.full_name.split('/')
    detectGitHubManifests(token, owner, repoName, selectedRepo.default_branch)
      .then((items) => {
        if (!active) return
        s.manifests.set(key, items)
        const selection = recommendedSelection(items)
        s.selection.set(key, selection)
        manifestsFor.current = key
        setManifests(items)
        setSelectedManifests(selection)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to scan repository manifests')
      })
      .finally(() => {
        if (active) setLoadingManifests(false)
      })

    return () => {
      active = false
    }
  }, [selectedRepo, token, manifestReload])

  function rescanManifests() {
    forceRescan.current = true
    setManifestReload((n) => n + 1)
  }

  function toggleManifest(path: string) {
    setSelectedManifests((cur) => (cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path]))
  }

  function handleSelectRepo(repo: GitHubRepository) {
    setSelectedRepo(repo)
    // If the selected repo is different from current report, go to launchpad
    if (!report || report.repository !== repo.full_name) {
      setViewMode('launchpad')
    }
  }

  async function handleRunAgentAnalysis() {
    if (!token || !selectedRepo || selectedManifests.length === 0 || analyzing) return
    // Audit in discovery order so progress reads top-to-bottom like the list.
    const queue = manifests.map((m) => m.path).filter((p) => selectedManifests.includes(p))
    const repo = selectedRepo
    const [owner, repoName] = repo.full_name.split('/')
    setError('')
    void startAudit({
      token,
      repo,
      queue,
      analyze: (path) =>
        analyzeGitHubRepo(token, owner, repoName, {
          manifest_path: path,
          ref: repo.default_branch,
          question: question.trim() || undefined,
          model: aiModel ?? undefined,
        }),
      onEach: (path, result) => addTelemetryBatch(auditTelemetry(repo.full_name, repo.default_branch, path, result)),
      merge: mergeReports,
      onReport: setReport,
    })
  }

  // When a run finishes while this panel is open, jump to its report.
  const seenFinish = useRef(run.finishedCount)
  useEffect(() => {
    if (run.finishedCount === seenFinish.current) return
    seenFinish.current = run.finishedCount
    if (run.status !== 'done') return
    setReportView('all')
    setViewMode('report')
    setDepFilter(run.lastAdvisories > 0 ? 'vuln' : 'all')
    setDepPage(1)
  }, [run.finishedCount, run.status, run.lastAdvisories])

  // Per-manifest results from this session (only while they belong to the current report)
  const finishedRuns = runs.filter((r) => r.report && report && r.report.repository === report.repository)
  const failedRuns = report ? runs.filter((r) => r.status === 'failed') : []
  const viewReport = (reportView !== 'all' && finishedRuns.find((r) => r.path === reportView)?.report) || report
  const showSwitcher = finishedRuns.length > 1

  // Filtered & paginated dependencies for the report
  const rawDeps = viewReport?.dependencies || []
  const vulnDepsCount = rawDeps.filter((d) => d.vulnerabilities.length > 0).length
  const cleanDepsCount = rawDeps.length - vulnDepsCount

  const filteredDeps = rawDeps.filter((dep) => {
    const hasVulns = dep.vulnerabilities.length > 0
    if (depFilter === 'vuln' && !hasVulns) return false
    if (depFilter === 'clean' && hasVulns) return false
    if (!depSearch.trim()) return true
    const q = depSearch.toLowerCase()
    return (
      dep.name.toLowerCase().includes(q) ||
      dep.version.toLowerCase().includes(q) ||
      dep.vulnerabilities.some((v) => v.id.toLowerCase().includes(q))
    )
  })

  const totalPages = Math.ceil(filteredDeps.length / PAGE_SIZE) || 1
  const paginatedDeps = filteredDeps.slice((depPage - 1) * PAGE_SIZE, depPage * PAGE_SIZE)

  // Vulnerable packages and non-package notes for the current report view
  const vulnerablePackages: VulnerablePackage[] = (viewReport?.dependencies ?? [])
    .filter((d) => d.vulnerabilities.length > 0)
    .map((d) => ({ name: d.name, version: d.version, ecosystem: d.ecosystem, advisoryIds: d.vulnerabilities.map((v) => v.id) }))
  const reportNotes = (viewReport?.recommendations ?? []).filter((r) => !r.startsWith('Upgrade package '))

  function toggleRow(key: string) {
    setExpandedRows((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="agent-panel-wrapper">
      <AdvisoryModal target={advisory} onClose={() => setAdvisory(null)} />
      {(error || run.error) && (
        <div className="alert-banner alert-error" role="alert">
          <AlertTriangle size={18} />
          <span>{error || run.error}</span>
        </div>
      )}

      {notice && (
        <div className="alert-banner alert-success" role="status">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
        </div>
      )}

      <div className="gh-dashboard-grid">
        {/* Left Column: Repository Selection */}
        <RepoSidebar
          token={token}
          login={user.login}
          selectedId={selectedRepo?.id ?? null}
          onSelect={handleSelectRepo}
          onError={setError}
        />

        {/* Right Column: AI Launchpad OR Report Details */}
        <div className="gh-analysis-pane">
          {analyzing ? (
            /* Multi-manifest progress (real, per file) */
            <div className="agent-loading-card hbm-progress" role="status" aria-live="polite">
              <div className="hbm-progress-icon" aria-hidden="true">
                <ScanSearch size={34} strokeWidth={1.5} />
              </div>
              <h3 className="hbd-serif">
                Auditing {runs.filter((r) => r.status === 'done' || r.status === 'failed').length} of {runs.length} manifest
                {runs.length === 1 ? '' : 's'}
              </h3>
              <p>Each file is parsed, its exact versions are checked against OSV.dev, and Bifrost explains any matches.</p>
              <div className="hbm-bar" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.round(((runs.filter((r) => r.status === 'done' || r.status === 'failed').length + 0.5) / Math.max(1, runs.length)) * 100)}%`,
                  }}
                />
              </div>
              <ol className="hbm-runs">
                {runs.map((r) => (
                  <li key={r.path} className={`is-${r.status}`}>
                    <span className="hbm-run-icon">
                      {r.status === 'running' ? <RefreshCw size={12} className="animate-spin" /> : r.status === 'done' ? <Check size={12} /> : r.status === 'failed' ? <X size={12} /> : null}
                    </span>
                    <code>{r.path}</code>
                    <span className="hbm-run-state">
                      {r.status === 'running' ? 'Checking…' : r.status === 'done' ? `${r.report?.vulnerability_count ?? 0} advisories` : r.status === 'failed' ? 'Failed' : 'Waiting'}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : viewMode === 'report' && viewReport ? (
            /* Full Report View */
            <div className="audit-report-card">
              {/* Report Header Bar */}
              <div className="report-header">
                <div>
                  <span className="eyebrow">DepShield AI Security Audit</span>
                  <h3>{viewReport.repository}</h3>
                  <div className="report-sub">
                    <span>
                      <GitBranch size={12} /> {viewReport.branch}
                    </span>
                    <span>• File: <code>{viewReport.manifest_path}</code></span>
                    <span>
                      • {viewReport.ecosystem} ({viewReport.manifest_type})
                    </span>
                  </div>
                </div>
                <div className="report-header-actions">
                  <div className={`risk-badge risk-${viewReport.risk_level.toLowerCase()}`}>
                    {viewReport.risk_level === 'CLEAN' ? (
                      <ShieldCheck size={16} />
                    ) : viewReport.risk_level === 'CRITICAL' ? (
                      <ShieldAlert size={16} />
                    ) : (
                      <AlertTriangle size={16} />
                    )}
                    <span>{viewReport.risk_level} RISK</span>
                  </div>
                  {selectedRepo && (
                    <button
                      type="button"
                      className="secondary-button change-manifest-btn"
                      onClick={() => setViewMode('launchpad')}
                      title="Switch to another manifest or change audit directives"
                    >
                      <span>Change manifests</span>
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              </div>

              {showSwitcher && (
                <div className="hbm-switch" role="tablist" aria-label="Report scope">
                  <button type="button" role="tab" aria-selected={reportView === 'all'} className={reportView === 'all' ? 'active' : ''} onClick={() => { setReportView('all'); setDepPage(1) }}>
                    All manifests <b>{report?.vulnerability_count ?? 0}</b>
                  </button>
                  {finishedRuns.map((r) => (
                    <button key={r.path} type="button" role="tab" aria-selected={reportView === r.path} className={reportView === r.path ? 'active' : ''} onClick={() => { setReportView(r.path); setDepPage(1) }}>
                      {r.path} <b>{r.report?.vulnerability_count ?? 0}</b>
                    </button>
                  ))}
                </div>
              )}
              {failedRuns.length > 0 && (
                <div className="hbm-failed" role="status">
                  <AlertTriangle size={14} />
                  <span>
                    Not included: {failedRuns.map((r) => r.path).join(', ')}. {failedRuns[0].error}
                  </span>
                </div>
              )}

              {/* Summary Metric Counters */}
              <div className="metrics-grid">
                <div className="metric-box">
                  <span className="metric-num">{viewReport.dependency_count}</span>
                  <span className="metric-label">Dependencies</span>
                </div>
                <div className="metric-box">
                  <span className="metric-num">{viewReport.checked_count}</span>
                  <span className="metric-label">Pinned & Checked</span>
                </div>
                <div className="metric-box">
                  <span className="metric-num text-alert">{viewReport.vulnerability_count}</span>
                  <span className="metric-label">Active Advisories</span>
                </div>
                <div className="metric-box">
                  <span className="metric-num">{viewReport.unpinned_count}</span>
                  <span className="metric-label">Unpinned Ranges</span>
                </div>
              </div>

              {/* Agent Intelligence Box */}
              <div className="agent-summary-box">
                <div className="agent-box-title">
                  {viewReport.summary_source === 'bifrost' ? <Sparkles size={16} /> : <Database size={16} />}
                  <h4>{viewReport.summary_source === 'bifrost' ? 'Bifrost AI Analysis' : 'OSV Summary'}</h4>
                  {viewReport.summary_source === 'bifrost' ? (
                    <span className="provenance-chip live" title={viewReport.gateway_response_id ?? undefined}>
                      <span className="live-pulse" /> Live · {viewReport.ai_model}
                      {viewReport.ai_usage?.total_tokens ? ` · ${viewReport.ai_usage.total_tokens} tok` : ''}
                    </span>
                  ) : (
                    <span
                      className="provenance-chip fallback"
                      title={
                        viewReport.vulnerability_count === 0
                          ? 'No advisories matched, so there was nothing for the AI to explain.'
                          : viewReport.summary_fallback_reason === 'bifrost_not_configured'
                            ? 'BIFROST_BASE_URL isn’t set on the backend, so AI explanations are off.'
                            : 'The Bifrost gateway didn’t answer (is it running at localhost:8080?). Findings below still come straight from OSV.dev.'
                      }
                    >
                      {viewReport.vulnerability_count === 0
                        ? 'No AI needed: no advisories'
                        : viewReport.summary_fallback_reason === 'bifrost_not_configured'
                          ? 'No AI summary · Bifrost not set up'
                          : 'No AI summary · Bifrost offline'}
                    </span>
                  )}
                </div>
                {reportView === 'all' && showSwitcher ? (
                  <ul className="hbm-summaries">
                    {finishedRuns.map((r) => (
                      <li key={r.path}>
                        <button type="button" className="hbm-summary-file" onClick={() => setReportView(r.path)}>
                          <FileCode size={13} /> {r.path}
                          <span className={`hbm-src ${r.report?.summary_source === 'bifrost' ? 'is-ai' : ''}`}>
                            {r.report?.summary_source === 'bifrost' ? `AI · ${r.report.ai_model}` : 'OSV summary'}
                          </span>
                        </button>
                        <p className="agent-narrative">{r.report?.agent_summary}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="agent-narrative">{viewReport.agent_summary}</p>
                )}

                {/* Fixes, built from the dependency data (not parsed text) */}
                {vulnerablePackages.length > 0 && (
                  <div className="hbx-section">
                    <div className="hbx-head">
                      <h5 className="hbd-serif">How to fix</h5>
                      <span>
                        {vulnerablePackages.length} package{vulnerablePackages.length === 1 ? '' : 's'} · safe versions from OSV.dev ·
                        click an advisory ID to see what it means
                      </span>
                    </div>
                    <RemediationList packages={vulnerablePackages} onOpen={setAdvisory} />
                  </div>
                )}
                {reportNotes.length > 0 && (
                  <ul className="hbx-notes">
                    {reportNotes.map((n) => (
                      <li key={n}><Info size={14} /> {n}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Paginated & Filterable Dependencies Section */}
              <div className="findings-section">
                <div className="findings-controls-bar">
                  <div className="dep-filter-tabs">
                    <button
                      type="button"
                      className={`dep-filter-btn ${depFilter === 'vuln' ? 'active' : ''}`}
                      onClick={() => {
                        setDepFilter('vuln')
                        setDepPage(1)
                      }}
                    >
                      <AlertTriangle size={13} className="text-alert" />
                      <span className="filter-title">Flagged Vulnerable</span>
                      <span className="dep-count-badge alert">{vulnDepsCount}</span>
                    </button>
                    <button
                      type="button"
                      className={`dep-filter-btn ${depFilter === 'clean' ? 'active' : ''}`}
                      onClick={() => {
                        setDepFilter('clean')
                        setDepPage(1)
                      }}
                    >
                      <CheckCircle2 size={13} className="text-green" />
                      <span className="filter-title">Clear & Pinned</span>
                      <span className="dep-count-badge">{cleanDepsCount}</span>
                    </button>
                    <button
                      type="button"
                      className={`dep-filter-btn ${depFilter === 'all' ? 'active' : ''}`}
                      onClick={() => {
                        setDepFilter('all')
                        setDepPage(1)
                      }}
                    >
                      <span className="filter-title">All Dependencies</span>
                      <span className="dep-count-badge">{rawDeps.length}</span>
                    </button>
                  </div>

                  <div className="dep-search-wrap">
                    <Search size={13} className="search-icon" />
                    <input
                      type="text"
                      placeholder="Search audited packages..."
                      value={depSearch}
                      onChange={(e) => {
                        setDepSearch(e.target.value)
                        setDepPage(1)
                      }}
                      className="dep-search-input"
                    />
                  </div>
                </div>

                {filteredDeps.length === 0 ? (
                  <div className="empty-deps-notice">
                    <CheckCircle2 size={24} className="text-green" />
                    <p>No dependencies match your current filter.</p>
                  </div>
                ) : (
                  <>
                    <div className="findings-table-wrap">
                      <table className="findings-table">
                        <thead>
                          <tr>
                            <th>Package</th>
                            <th>Version</th>
                            <th>Status</th>
                            <th>Vulnerabilities</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedDeps.map((dep, idx) => {
                            const hasVulns = dep.vulnerabilities.length > 0
                            return (
                              <tr key={idx} className={hasVulns ? 'row-alert' : ''}>
                                <td className="pkg-name">
                                  <strong>{dep.name}</strong>
                                </td>
                                <td>
                                  <code>{dep.version}</code>
                                </td>
                                <td>
                                  <span className={`status-pill ${dep.status}`}>
                                    {dep.status === 'checked' ? 'Exact Pinned' : 'Range (Unpinned)'}
                                  </span>
                                </td>
                                <td>
                                  {hasVulns ? (
                                    <div className="vuln-badges">
                                      {(expandedRows.has(dep.name + dep.version) ? dep.vulnerabilities : dep.vulnerabilities.slice(0, 3)).map((v) => (
                                        <button
                                          key={v.id}
                                          type="button"
                                          className="vuln-chip hbx-id"
                                          title="What does this advisory mean?"
                                          onClick={() => setAdvisory({ id: v.id, packageName: dep.name, version: dep.version, ecosystem: dep.ecosystem })}
                                        >
                                          {v.id}
                                        </button>
                                      ))}
                                      {dep.vulnerabilities.length > 3 && (
                                        <button type="button" className="hbd-link hbx-more" onClick={() => toggleRow(dep.name + dep.version)}>
                                          {expandedRows.has(dep.name + dep.version) ? 'Show fewer' : `+${dep.vulnerabilities.length - 3} more`}
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="clean-pill">
                                      <CheckCircle2 size={12} /> Clear
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination Bar */}
                    <div className="dep-pagination-bar">
                      <span className="dep-pagination-info">
                        Showing {(depPage - 1) * PAGE_SIZE + 1}–
                        {Math.min(depPage * PAGE_SIZE, filteredDeps.length)} of {filteredDeps.length} packages
                      </span>
                      <div className="dep-pagination-actions">
                        <button
                          type="button"
                          className="dep-page-btn"
                          disabled={depPage <= 1}
                          onClick={() => setDepPage((p) => p - 1)}
                        >
                          <ChevronLeft size={13} />
                          <span>Previous</span>
                        </button>
                        <span className="dep-page-indicator">
                          {depPage} / {totalPages}
                        </span>
                        <button
                          type="button"
                          className="dep-page-btn"
                          disabled={depPage >= totalPages}
                          onClick={() => setDepPage((p) => p + 1)}
                        >
                          <span>Next</span>
                          <ChevronRight size={13} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : selectedRepo ? (
            /* Selected repository launchpad */
            <div className="repo-launchpad-card hbm-launch">
              <header className="hbm-repo">
                <div className="hbm-repo-tile" aria-hidden="true">
                  <span>{selectedRepo.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="hbm-repo-main">
                  <span className="hb-kicker">Target repository</span>
                  <h2 className="hbm-repo-name">
                    <span className="hbm-repo-owner">{selectedRepo.full_name.split('/')[0]}/</span>
                    {selectedRepo.name}
                  </h2>
                  {selectedRepo.description && <p className="hbm-repo-desc">{selectedRepo.description}</p>}
                  <div className="hbm-chips">
                    <span className="hb-chip">{selectedRepo.private ? <Lock size={11} /> : <Globe size={11} />} {selectedRepo.private ? 'Private' : 'Public'}</span>
                    <span className="hb-chip"><GitBranch size={11} /> {selectedRepo.default_branch}</span>
                    {selectedRepo.language && <span className="hb-chip">{selectedRepo.language}</span>}
                    {selectedRepo.stargazers_count > 0 && <span className="hb-chip"><Star size={11} /> {selectedRepo.stargazers_count}</span>}
                    <a className="hb-chip hbm-chip-link" href={selectedRepo.html_url} target="_blank" rel="noreferrer">
                      Open on GitHub <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
              </header>

              <section className="hbm-section" aria-labelledby="hbm-manifests-title">
                <div className="hbm-sec-head">
                  <div>
                    <h4 id="hbm-manifests-title" className="hbd-serif">Dependency files</h4>
                    <span className="hbm-sec-sub">
                      {loadingManifests
                        ? 'Scanning the repository…'
                        : manifests.length
                          ? `${selectedManifests.length} of ${manifests.length} selected`
                          : 'None found'}
                    </span>
                  </div>
                  <div className="hbm-sel-actions">
                    {manifests.length > 1 && (
                      <>
                        <button type="button" className="hbd-link" onClick={() => setSelectedManifests(recommendedSelection(manifests))}>Recommended</button>
                        <button type="button" className="hbd-link" onClick={() => setSelectedManifests(manifests.map((m) => m.path))}>Select all</button>
                        <button type="button" className="hbd-link" onClick={() => setSelectedManifests([])} disabled={!selectedManifests.length}>Clear</button>
                      </>
                    )}
                    <button type="button" className="hbd-icon-btn" onClick={() => rescanManifests()} disabled={loadingManifests} aria-label="Scan the repository again" title="Scan again">
                      <RefreshCw size={13} className={loadingManifests ? 'animate-spin' : ''} />
                    </button>
                  </div>
                </div>

                {loadingManifests ? (
                  <div className="hbm-grid" aria-hidden="true">
                    {[0, 1, 2].map((i) => <div key={i} className="hbm-skel" />)}
                  </div>
                ) : manifests.length === 0 ? (
                  <div className="hbm-empty">
                    <div className="hbd-empty-art" aria-hidden="true">
                      <span className="hbd-empty-card c1" />
                      <span className="hbd-empty-card c2" />
                      <span className="hbd-empty-card c3"><PackageSearch size={26} strokeWidth={1.5} /></span>
                    </div>
                    <h4 className="hbd-serif">No dependency files found</h4>
                    <p>
                      {selectedRepo.language && !SUPPORTED_LANGS.includes(selectedRepo.language.toLowerCase())
                        ? `This looks like ${/^(html|[aeiou])/i.test(selectedRepo.language) ? 'an' : 'a'} ${selectedRepo.language} project. DepShield currently audits npm and Python dependencies, so there may be nothing to check here.`
                        : 'DepShield couldn’t find a supported manifest in the usual places. If your project keeps it in a deeper folder, paste it into the manual scanner instead.'}
                    </p>
                    <div className="hbm-looked">
                      <span>Looked in</span>
                      {SCANNED_DIRS.map((d) => <code key={d}>{d}</code>)}
                    </div>
                    <div className="hbm-looked">
                      <span>For</span>
                      {SUPPORTED_FILES.map((f) => <code key={f}>{f}</code>)}
                    </div>
                    <div className="hb-hero-ctas">
                      <button type="button" className="hb-btn hb-btn-ghost hbd-btn-sm" onClick={() => rescanManifests()}>
                        <RefreshCw size={14} /> Scan again
                      </button>
                      {onManualScan && (
                        <button type="button" className="hb-btn hb-btn-primary hbd-btn-sm" onClick={onManualScan}>
                          <FileCode size={14} /> Paste a manifest instead
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="hbm-groups">
                    {groupByDir(manifests).map(([dir, files]) => (
                      <div className="hbm-group" key={dir || 'root'}>
                        <span className="hbm-dir"><FolderOpen size={13} /> {dir ? `${dir}/` : 'Repository root'}</span>
                        <div className="hbm-grid">
                          {files.map((m) => {
                            const checked = selectedManifests.includes(m.path)
                            const isLock = m.manifest_type === 'lockfile'
                            const covered = checked && coveredByLockfile(m, selectedManifests, manifests)
                            return (
                              <button
                                key={m.path}
                                type="button"
                                role="checkbox"
                                aria-checked={checked}
                                className={`hbm-card ${checked ? 'is-checked' : ''}`}
                                onClick={() => toggleManifest(m.path)}
                              >
                                <span className="hbm-check" aria-hidden="true">{checked && <Check size={12} strokeWidth={3} />}</span>
                                <span className="hbm-card-body">
                                  <span className="hbm-card-name">{m.name}</span>
                                  <span className="hbm-card-meta">
                                    <span>{m.ecosystem}</span>
                                    <span>·</span>
                                    <span>{isLock ? 'Lockfile · exact versions' : 'Manifest · may use ranges'}</span>
                                  </span>
                                  {covered && <span className="hbm-card-hint">Its lockfile already covers these packages</span>}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="hbm-section">
                <div className="hbm-sec-head">
                  <div>
                    <label htmlFor="launchpad-prompt" className="hbd-serif hbm-label">Investigation focus</label>
                    <span className="hbm-sec-sub">Bifrost uses this when advisories are found.</span>
                  </div>
                  <span className="hbm-count">{question.length}/1000</span>
                </div>
                <textarea
                  id="launchpad-prompt"
                  className="hbm-textarea"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value.slice(0, 1000))}
                  rows={2}
                  placeholder="e.g. Focus on remote code execution and how far an exploit could reach"
                />
                <div className="hbm-presets" role="group" aria-label="Suggested focus">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={`hbm-preset ${question === p.text ? 'active' : ''}`}
                      aria-pressed={question === p.text}
                      onClick={() => setQuestion(p.text)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <ModelPicker value={aiModel} onChange={setAiModel} />
              </section>

              <div className="hbm-cta">
                <button
                  type="button"
                  className="hb-btn hb-btn-primary hbm-run"
                  onClick={handleRunAgentAnalysis}
                  disabled={analyzing || selectedManifests.length === 0}
                >
                  <ScanSearch size={17} />
                  <span>Run AI Security Agent Analysis</span>
                  {selectedManifests.length > 0 && (
                    <span className="hbm-run-count">{selectedManifests.length}</span>
                  )}
                </button>
                <span className="hbm-cta-note">
                  <ShieldCheck size={13} />
                  {selectedManifests.length === 0
                    ? 'Select at least one dependency file to audit.'
                    : 'Only the selected files are downloaded. Exact versions are checked against OSV.dev.'}
                </span>
              </div>
            </div>
          ) : (
            /* Welcome / Empty State */
            <div className="empty-analysis-card">
              <div className="empty-icon">
                <Shield size={42} />
              </div>
              <h3>Choose a Repository to Audit</h3>
              <p>
                Select any repository from the list on the left to inspect discovered manifests,
                configure security directives, and run the autonomous DepShield AI agent.
              </p>
              <div className="empty-feature-pills">
                <span><Lock size={12} /> Zero Source Code Access</span>
                <span><Zap size={12} /> Real-Time OSV Feeds</span>
                <span><ShieldCheck size={12} /> Non-Breaking Fix Plans</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
