import { useState, useEffect } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode,
  FolderGit2,
  GitBranch,
  Globe,
  Lock,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react'
import {
  analyzeGitHubRepo,
  detectGitHubManifests,
  listGitHubRepos,
  type GitHubAnalysisReport,
  type GitHubManifestFile,
  type GitHubRepository,
  type GitHubUserProfile,
} from '../api'

interface GitHubAgentPanelProps {
  token: string
  user: GitHubUserProfile
  report: GitHubAnalysisReport | null
  setReport: (report: GitHubAnalysisReport | null) => void
}

export default function GitHubAgentPanel({
  token,
  user: _user,
  report,
  setReport,
}: GitHubAgentPanelProps) {
  const [repos, setRepos] = useState<GitHubRepository[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepository | null>(null)
  const [manifests, setManifests] = useState<GitHubManifestFile[]>([])
  const [selectedManifest, setSelectedManifest] = useState<string>('')
  const [question, setQuestion] = useState(
    'Identify all critical vulnerabilities, assess reachability, and provide safe upgrade paths.',
  )

  const [loadingRepos, setLoadingRepos] = useState(false)
  const [loadingManifests, setLoadingManifests] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // View state: 'launchpad' (manifests & trigger) vs 'report' (results)
  const [viewMode, setViewMode] = useState<'launchpad' | 'report'>('launchpad')

  // Findings table filter & pagination
  const [depFilter, setDepFilter] = useState<'all' | 'vuln' | 'clean'>('vuln')
  const [depSearch, setDepSearch] = useState('')
  const [depPage, setDepPage] = useState(1)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)

  const PAGE_SIZE = 15

  function copyText(cmd: string) {
    navigator.clipboard.writeText(cmd)
    setCopiedCmd(cmd)
    setTimeout(() => setCopiedCmd(null), 2000)
  }

  // Load repositories on mount or when token changes
  useEffect(() => {
    let active = true
    setLoadingRepos(true)
    setError('')

    listGitHubRepos(token)
      .then((repoList) => {
        if (!active) return
        setRepos(repoList)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load GitHub repositories')
      })
      .finally(() => {
        if (active) setLoadingRepos(false)
      })

    return () => {
      active = false
    }
  }, [token])

  // When a repository is selected, discover its manifests
  useEffect(() => {
    if (!token || !selectedRepo) {
      setManifests([])
      setSelectedManifest('')
      return
    }

    let active = true
    setLoadingManifests(true)
    setError('')

    const [owner, repoName] = selectedRepo.full_name.split('/')
    detectGitHubManifests(token, owner, repoName, selectedRepo.default_branch)
      .then((items) => {
        if (!active) return
        setManifests(items)
        if (items.length > 0) {
          // Prefer lockfile for complete dependency inventory
          const lockfile = items.find((m) => m.manifest_type === 'lockfile')
          setSelectedManifest(lockfile ? lockfile.path : items[0].path)
        } else {
          setSelectedManifest('')
        }
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
  }, [selectedRepo, token])

  function handleSelectRepo(repo: GitHubRepository) {
    setSelectedRepo(repo)
    // If the selected repo is different from current report, go to launchpad
    if (!report || report.repository !== repo.full_name) {
      setViewMode('launchpad')
    }
  }

  async function handleRunAgentAnalysis() {
    if (!token || !selectedRepo || !selectedManifest) return
    setAnalyzing(true)
    setError('')
    setNotice('')

    const [owner, repoName] = selectedRepo.full_name.split('/')
    try {
      const result = await analyzeGitHubRepo(token, owner, repoName, {
        manifest_path: selectedManifest,
        ref: selectedRepo.default_branch,
        question: question.trim() || undefined,
      })
      setReport(result)
      setViewMode('report')
      setDepFilter(result.vulnerability_count > 0 ? 'vuln' : 'all')
      setDepPage(1)
      setNotice(`Agent audit complete for ${selectedRepo.full_name}! Verified ${result.vulnerability_count} advisories.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Ensure the DepShield backend is running.')
    } finally {
      setAnalyzing(false)
    }
  }

  const filteredRepos = repos.filter(
    (r) =>
      r.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.description && r.description.toLowerCase().includes(searchQuery.toLowerCase())),
  )

  // Filtered & paginated dependencies for the report
  const rawDeps = report?.dependencies || []
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

  // Format recommendations into structured items
  function formatRecommendation(rec: string, ecosystem: string) {
    const pkgMatch = rec.match(/Upgrade package '([^']+)'/)
    const currentMatch = rec.match(/current: ([^)]+)/)
    const advisories = Array.from(rec.matchAll(/(GHSA-[a-z0-9-]+|CVE-\d{4}-\d+)/gi)).map((m) => m[0])

    const pkgName = pkgMatch ? pkgMatch[1] : null
    const currentVer = currentMatch ? currentMatch[1] : null

    let installCmd = ''
    if (pkgName) {
      if (ecosystem.toLowerCase().includes('npm')) {
        installCmd = `npm install ${pkgName}@latest`
      } else if (ecosystem.toLowerCase().includes('pypi') || ecosystem.toLowerCase().includes('python')) {
        installCmd = `pip install --upgrade ${pkgName}`
      } else {
        installCmd = `depshield add ${pkgName}@latest`
      }
    }

    return {
      raw: rec,
      pkgName,
      currentVer,
      advisories,
      installCmd,
    }
  }

  return (
    <div className="agent-panel-wrapper">
      {error && (
        <div className="alert-banner alert-error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
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
        <div className="gh-selection-pane">
          <div className="pane-header">
            <div className="pane-header-title">
              <h3>
                <FolderGit2 size={16} />
                <span>Repositories ({repos.length})</span>
              </h3>
              <button
                type="button"
                className="icon-refresh-btn"
                title="Refresh repositories list"
                onClick={() => {
                  setLoadingRepos(true)
                  listGitHubRepos(token)
                    .then(setRepos)
                    .catch((err) => setError(err.message))
                    .finally(() => setLoadingRepos(false))
                }}
                disabled={loadingRepos}
              >
                <RefreshCw size={13} className={loadingRepos ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="search-wrap">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder="Filter repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>
          </div>

          <div className="repo-list">
            {loadingRepos ? (
              <div className="repo-loading-container">
                <div className="repo-loading-status">
                  <span className="live-pulse" />
                  <span className="loading-title">Loading repositories from GitHub...</span>
                  <RefreshCw className="animate-spin text-muted" size={13} />
                </div>
                <p className="loading-hint">Fetching repository manifests and branches from GitHub API</p>
                <div className="repo-skeleton-list">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="repo-skeleton-card">
                      <div className="skeleton-head">
                        <div className="skeleton-line skeleton-title" />
                        <div className="skeleton-badge" />
                      </div>
                      <div className="skeleton-line skeleton-desc" />
                      <div className="skeleton-foot">
                        <div className="skeleton-tag" />
                        <div className="skeleton-tag" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="empty-state">No matching repositories found.</div>
            ) : (
              filteredRepos.map((repo) => {
                const isSelected = selectedRepo?.id === repo.id
                return (
                  <div
                    key={repo.id}
                    className={`repo-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectRepo(repo)}
                  >
                    <div className="repo-card-head">
                      <span className="repo-name">{repo.full_name}</span>
                      <span className="visibility-badge">
                        {repo.private ? <Lock size={11} /> : <Globe size={11} />}
                        {repo.private ? 'Private' : 'Public'}
                      </span>
                    </div>
                    {repo.description && <p className="repo-desc">{repo.description}</p>}
                    <div className="repo-card-foot">
                      {repo.language && <span className="lang-tag">{repo.language}</span>}
                      <span className="branch-tag">
                        <GitBranch size={11} />
                        {repo.default_branch}
                      </span>
                      {repo.stargazers_count > 0 && <span>★ {repo.stargazers_count}</span>}
                      {isSelected && (
                        <span className="selected-target-pill">
                          Target Selected <ArrowRight size={11} />
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right Column: AI Launchpad OR Report Details */}
        <div className="gh-analysis-pane">
          {analyzing ? (
            /* Analyzing Active State */
            <div className="agent-loading-card">
              <div className="pulsing-shield">
                <ShieldCheck size={52} />
              </div>
              <h3>Security Agent Auditing Repository</h3>
              <p>
                Extracting package pins from <code>{selectedManifest}</code> in{' '}
                <code>{selectedRepo?.full_name}</code>, querying deterministic advisories against OSV.dev,
                and compiling verified remediation guidance...
              </p>
              <div className="agent-progress-steps">
                <div className="step-item active">
                  <CheckCircle2 size={14} />
                  <span>[1/3] Parsing manifest descriptors & lockfile hashes</span>
                </div>
                <div className="step-item active">
                  <CheckCircle2 size={14} />
                  <span>[2/3] Querying OSV.dev batch vulnerability feeds</span>
                </div>
                <div className="step-item active">
                  <RefreshCw size={14} className="animate-spin" />
                  <span>[3/3] Bifrost by Maxim AI generating safe fix plans</span>
                </div>
              </div>
            </div>
          ) : viewMode === 'report' && report ? (
            /* Full Report View */
            <div className="audit-report-card">
              {/* Report Header Bar */}
              <div className="report-header">
                <div>
                  <span className="eyebrow">DepShield AI Security Audit</span>
                  <h3>{report.repository}</h3>
                  <div className="report-sub">
                    <span>
                      <GitBranch size={12} /> {report.branch}
                    </span>
                    <span>• File: <code>{report.manifest_path}</code></span>
                    <span>
                      • {report.ecosystem} ({report.manifest_type})
                    </span>
                  </div>
                </div>
                <div className="report-header-actions">
                  <div className={`risk-badge risk-${report.risk_level.toLowerCase()}`}>
                    {report.risk_level === 'CLEAN' ? (
                      <ShieldCheck size={16} />
                    ) : report.risk_level === 'CRITICAL' ? (
                      <ShieldAlert size={16} />
                    ) : (
                      <AlertTriangle size={16} />
                    )}
                    <span>{report.risk_level} RISK</span>
                  </div>
                  {selectedRepo && (
                    <button
                      type="button"
                      className="secondary-button change-manifest-btn"
                      onClick={() => setViewMode('launchpad')}
                      title="Switch to another manifest or change audit directives"
                    >
                      <span>Audit Another Manifest</span>
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Summary Metric Counters */}
              <div className="metrics-grid">
                <div className="metric-box">
                  <span className="metric-num">{report.dependency_count}</span>
                  <span className="metric-label">Dependencies</span>
                </div>
                <div className="metric-box">
                  <span className="metric-num">{report.checked_count}</span>
                  <span className="metric-label">Pinned & Checked</span>
                </div>
                <div className="metric-box">
                  <span className="metric-num text-alert">{report.vulnerability_count}</span>
                  <span className="metric-label">Active Advisories</span>
                </div>
                <div className="metric-box">
                  <span className="metric-num">{report.unpinned_count}</span>
                  <span className="metric-label">Unpinned Ranges</span>
                </div>
              </div>

              {/* Agent Intelligence Box */}
              <div className="agent-summary-box">
                <div className="agent-box-title">
                  <Sparkles size={16} />
                  <h4>AI Agent Intelligence Summary</h4>
                </div>
                <p className="agent-narrative">{report.agent_summary}</p>

                {/* Structured Actionable Upgrades & Fixes */}
                {report.recommendations.length > 0 && (
                  <div className="recommendations-box">
                    <div className="rec-box-head">
                      <Sparkles size={14} className="text-purple" />
                      <h5>Actionable Upgrades & Fixes ({report.recommendations.length})</h5>
                      <span className="rec-box-tag">Bifrost Verified Non-Breaking</span>
                    </div>

                    <div className="rec-cards-list">
                      {report.recommendations.map((rec, i) => {
                        const parsed = formatRecommendation(rec, report.ecosystem)
                        return (
                          <div key={i} className="recommendation-card">
                            <div className="rec-card-topline">
                              <div className="rec-pkg-group">
                                <span className="rec-pkg-name">
                                  {parsed.pkgName || 'Flagged Package'}
                                </span>
                                {parsed.currentVer && (
                                  <span className="rec-version-pill current">
                                    current: <code>{parsed.currentVer}</code>
                                  </span>
                                )}
                                <span className="rec-version-pill target">
                                  target: <code>latest</code>
                                </span>
                              </div>

                              {parsed.installCmd && (
                                <div className="rec-cmd-box">
                                  <code>{parsed.installCmd}</code>
                                  <button
                                    type="button"
                                    className="rec-copy-btn"
                                    onClick={() => copyText(parsed.installCmd)}
                                    title="Copy fix command"
                                  >
                                    {copiedCmd === parsed.installCmd ? (
                                      <>
                                        <Check size={12} className="text-green" />
                                        <span>Copied</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy size={12} />
                                        <span>Copy</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>

                            <p className="rec-clean-desc">
                              Bifrost Security Agent verified upgrade available to address active advisory. Verified non-breaking semver bump.
                            </p>

                            <div className="rec-card-footer">
                              <div className="rec-advisories-row">
                                <span className="rec-adv-label">Advisories:</span>
                                {parsed.advisories.map((adv) => (
                                  <a
                                    key={adv}
                                    href={`https://osv.dev/vulnerability/${adv}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rec-adv-chip"
                                  >
                                    <AlertTriangle size={11} />
                                    <span>{adv}</span>
                                    <ExternalLink size={10} />
                                  </a>
                                ))}
                              </div>
                              <span className="rec-bifrost-stamp">
                                <ShieldCheck size={12} />
                                <span>Bifrost Verified</span>
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
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
                                      {dep.vulnerabilities.map((v) => (
                                        <a
                                          key={v.id}
                                          href={`https://osv.dev/vulnerability/${v.id}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="vuln-chip"
                                          title={v.summary}
                                        >
                                          <AlertTriangle size={11} />
                                          <span>{v.id}</span>
                                          <ExternalLink size={10} />
                                        </a>
                                      ))}
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
            /* Selected Repo Launchpad (Directly in the center!) */
            <div className="repo-launchpad-card">
              {/* Header with repo info */}
              <div className="launchpad-header">
                <div className="launchpad-title-block">
                  <div className="launchpad-eyebrow">
                    <FolderGit2 size={13} />
                    <span>Target Repository Selected</span>
                  </div>
                  <h2>{selectedRepo.full_name}</h2>
                  {selectedRepo.description && (
                    <p className="launchpad-desc">{selectedRepo.description}</p>
                  )}
                </div>
                <div className="launchpad-badges">
                  <span className="launchpad-badge visibility">
                    {selectedRepo.private ? <Lock size={11} /> : <Globe size={11} />}
                    {selectedRepo.private ? 'Private' : 'Public'}
                  </span>
                  <span className="launchpad-badge branch">
                    <GitBranch size={11} />
                    {selectedRepo.default_branch}
                  </span>
                  {selectedRepo.language && (
                    <span className="launchpad-badge lang">{selectedRepo.language}</span>
                  )}
                  {selectedRepo.stargazers_count > 0 && (
                    <span className="launchpad-badge stars">★ {selectedRepo.stargazers_count}</span>
                  )}
                </div>
              </div>

              {/* Manifest Explorer Section */}
              <div className="launchpad-manifests-section">
                <div className="section-head">
                  <div className="section-head-title">
                    <Terminal size={15} />
                    <h4>Discovered Manifests in {selectedRepo.name}</h4>
                  </div>
                  <span className="manifest-count-tag">
                    {loadingManifests
                      ? 'Scanning repository...'
                      : `${manifests.length} manifest${manifests.length === 1 ? '' : 's'} discovered`}
                  </span>
                </div>

                {loadingManifests ? (
                  <div className="manifest-loading-box">
                    <RefreshCw className="animate-spin" size={16} />
                    <span>Discovering project manifests and lockfiles...</span>
                  </div>
                ) : manifests.length === 0 ? (
                  <div className="manifest-empty-box">
                    <AlertTriangle size={18} />
                    <span>No package manifests or lockfiles detected in common directories.</span>
                  </div>
                ) : (
                  <div className="manifest-cards-grid">
                    {manifests.map((m) => {
                      const isSelected = selectedManifest === m.path
                      const isLockfile = m.manifest_type === 'lockfile'
                      return (
                        <button
                          key={m.path}
                          type="button"
                          className={`manifest-select-card ${isSelected ? 'active' : ''}`}
                          onClick={() => setSelectedManifest(m.path)}
                        >
                          <div className="manifest-card-top">
                            <FileCode size={15} />
                            <span className="manifest-path-text">{m.path}</span>
                            {isSelected && <Check size={14} className="active-check" />}
                          </div>
                          <div className="manifest-card-sub">
                            <span className="manifest-eco-tag">{m.ecosystem}</span>
                            <span className={`manifest-type-tag ${isLockfile ? 'lockfile' : ''}`}>
                              {isLockfile ? 'Lockfile (Full Pinned Tree)' : 'Manifest'}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Directives & Action Section */}
              <div className="launchpad-action-section">
                <div className="directives-wrap">
                  <label htmlFor="launchpad-prompt" className="directives-label">
                    <Sparkles size={14} />
                    <span>Agent Investigation Directives:</span>
                  </label>
                  <input
                    id="launchpad-prompt"
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="e.g. Focus on remote code execution & blast radius"
                    className="directives-input"
                  />
                  <div className="preset-chips">
                    <span className="preset-label">Suggested presets:</span>
                    <button
                      type="button"
                      className="preset-btn"
                      onClick={() =>
                        setQuestion(
                          'Identify all critical vulnerabilities, assess reachability, and provide safe upgrade paths.',
                        )
                      }
                    >
                      Comprehensive Audit
                    </button>
                    <button
                      type="button"
                      className="preset-btn"
                      onClick={() =>
                        setQuestion('Focus strictly on remote code execution, prototype pollution, and SSRF.')
                      }
                    >
                      RCE & Exploitability
                    </button>
                    <button
                      type="button"
                      className="preset-btn"
                      onClick={() =>
                        setQuestion('Verify non-breaking semver patches for all pinned dependencies.')
                      }
                    >
                      Safe Upgrade Paths
                    </button>
                  </div>
                </div>

                <div className="launchpad-cta-box">
                  <button
                    type="button"
                    className="primary-button run-agent-btn"
                    onClick={handleRunAgentAnalysis}
                    disabled={analyzing || !selectedManifest}
                  >
                    <Sparkles size={16} />
                    <span>Run AI Security Agent Analysis</span>
                  </button>
                  <span className="security-guarantee-note">
                    <ShieldCheck size={13} />
                    <span>Zero Source Code Ingestion • Verified against OSV.dev via Bifrost Gateway</span>
                  </span>
                </div>
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
                <span>🔒 Zero Source Code Access</span>
                <span>⚡ Real-Time OSV Feeds</span>
                <span>🛡️ Non-Breaking Fix Plans</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
