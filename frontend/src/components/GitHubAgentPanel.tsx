import { useState, useEffect } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
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
        {/* Left Column: Repository & Manifest Selection */}
        <div className="gh-selection-pane">
          <div className="pane-header">
            <div className="pane-header-title">
              <h3>
                <FolderGit2 size={18} />
                <span>Select Repository ({repos.length})</span>
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
                <RefreshCw size={14} className={loadingRepos ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="search-wrap">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder="Search your repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>
          </div>

          <div className="repo-list">
            {loadingRepos ? (
              <div className="loading-state">
                <RefreshCw className="animate-spin" size={20} />
                <span>Loading repositories from GitHub...</span>
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
                    onClick={() => setSelectedRepo(repo)}
                  >
                    <div className="repo-card-head">
                      <span className="repo-name">{repo.full_name}</span>
                      <span className="visibility-badge">
                        {repo.private ? <Lock size={12} /> : <Globe size={12} />}
                        {repo.private ? 'Private' : 'Public'}
                      </span>
                    </div>
                    {repo.description && <p className="repo-desc">{repo.description}</p>}
                    <div className="repo-card-foot">
                      {repo.language && <span className="lang-tag">{repo.language}</span>}
                      <span className="branch-tag">
                        <GitBranch size={12} />
                        {repo.default_branch}
                      </span>
                      {repo.stargazers_count > 0 && <span>★ {repo.stargazers_count}</span>}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Selected Repo Manifest Explorer */}
          {selectedRepo && (
            <div className="manifest-explorer-card">
              <div className="card-subhead">
                <Terminal size={16} />
                <h4>Discovered Manifests in {selectedRepo.name}</h4>
              </div>
              {loadingManifests ? (
                <div className="loading-state-small">
                  <RefreshCw className="animate-spin" size={16} />
                  <span>Discovering project manifests...</span>
                </div>
              ) : manifests.length === 0 ? (
                <div className="empty-notice">
                  No package.json, requirements.txt, or supported lockfile found in root or common folders.
                </div>
              ) : (
                <div className="manifest-pills">
                  {manifests.map((m) => (
                    <button
                      key={m.path}
                      type="button"
                      className={`manifest-pill ${selectedManifest === m.path ? 'active' : ''}`}
                      onClick={() => setSelectedManifest(m.path)}
                    >
                      <span className="manifest-path">{m.path}</span>
                      <span className="manifest-meta">
                        {m.ecosystem} • {m.manifest_type}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {selectedManifest && (
                <div className="agent-trigger-box">
                  <label htmlFor="agent-prompt" className="prompt-label">
                    <Sparkles size={14} /> Agent Investigation Directives:
                  </label>
                  <input
                    id="agent-prompt"
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="e.g. Focus on remote code execution & blast radius"
                    className="prompt-input"
                  />
                  <button
                    type="button"
                    className="primary-button trigger-btn"
                    onClick={handleRunAgentAnalysis}
                    disabled={analyzing}
                  >
                    {analyzing ? (
                      <>
                        <RefreshCw className="animate-spin" size={16} />
                        <span>Agent Auditing & Querying OSV Advisories...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        <span>Run AI Security Agent Analysis</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Agent Report & Findings */}
        <div className="gh-analysis-pane">
          {analyzing ? (
            <div className="agent-loading-card">
              <div className="pulsing-shield">
                <ShieldCheck size={52} />
              </div>
              <h3>Security Agent Auditing Repository</h3>
              <p>
                Extracting package pins from <code>{selectedManifest}</code> in{' '}
                <code>{selectedRepo?.full_name}</code>, verifying deterministic advisories against OSV.dev,
                and compiling evidence-grounded AI guidance...
              </p>
            </div>
          ) : report ? (
            <div className="audit-report-card">
              {/* Report Header */}
              <div className="report-header">
                <div>
                  <span className="eyebrow">DepShield AI Security Audit</span>
                  <h3>{report.repository}</h3>
                  <div className="report-sub">
                    <span>
                      <GitBranch size={12} /> {report.branch}
                    </span>
                    <span>• File: {report.manifest_path}</span>
                    <span>
                      • {report.ecosystem} ({report.manifest_type})
                    </span>
                  </div>
                </div>
                <div className={`risk-badge risk-${report.risk_level.toLowerCase()}`}>
                  {report.risk_level === 'CLEAN' ? (
                    <ShieldCheck size={18} />
                  ) : report.risk_level === 'CRITICAL' ? (
                    <ShieldAlert size={18} />
                  ) : (
                    <AlertTriangle size={18} />
                  )}
                  <span>{report.risk_level} RISK</span>
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
                <div className="recommendations-box">
                  <h5>Actionable Upgrades & Fixes:</h5>
                  <ul>
                    {report.recommendations.map((rec, i) => (
                      <li key={i}>
                        <ArrowRight size={14} />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Flagged Dependencies List */}
              <div className="findings-section">
                <h4>Audited Dependencies ({report.dependencies.length})</h4>
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
                      {report.dependencies.map((dep, idx) => {
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
                                      <AlertTriangle size={12} />
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
              </div>
            </div>
          ) : (
            /* Waiting State */
            <div className="empty-analysis-card">
              <div className="empty-icon">
                <Shield size={42} />
              </div>
              <h3>Choose a Repository to Audit</h3>
              <p>
                Select any repository from the list on the left, confirm the discovered manifest or lockfile,
                and trigger the DepShield Security Agent to run an instant vulnerability investigation.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
