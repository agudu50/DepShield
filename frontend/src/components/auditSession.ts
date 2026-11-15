import type { GitHubAnalysisReport, GitHubManifestFile, GitHubRepository } from '../api'
import type { ManifestRun } from './manifestAudit'

/**
 * In-memory state for the Audit tab that should survive switching tabs
 * (the panel unmounts) but not a sign-out or page reload. Scoped to one token.
 */
export interface AuditSession {
  token: string
  repos: { list: GitHubRepository[]; page: number; hasMore: boolean; fetchedAt: number } | null
  /** First-page request in flight, shared so overlapping mounts don't refetch. */
  reposPending: Promise<GitHubRepository[]> | null
  selectedRepo: GitHubRepository | null
  manifests: Map<string, GitHubManifestFile[]>
  selection: Map<string, string[]>
  runs: ManifestRun[]
  question: string | null
  viewMode: 'launchpad' | 'report'
  reportView: string
}

/** How long a cached repository list is shown before a quiet background refresh. */
export const REPOS_STALE_MS = 5 * 60 * 1000

let session: AuditSession | null = null

export function getAuditSession(token: string): AuditSession {
  if (!session || session.token !== token) {
    session = {
      token,
      repos: null,
      reposPending: null,
      selectedRepo: null,
      manifests: new Map(),
      selection: new Map(),
      runs: [],
      question: null,
      viewMode: 'launchpad',
      reportView: 'all',
    }
  }
  return session
}

/* ── Background audit runner ──────────────────────────────────────────────
 * The audit loop lives here, not in the panel, so it keeps going when you switch
 * tabs (the panel unmounts) and the result still lands in the dashboard.
 */
export interface AuditRunState {
  status: 'idle' | 'running' | 'done' | 'failed'
  repo: string | null
  runs: ManifestRun[]
  notice: string
  error: string
  /** Increments each time a run finishes, so views can react exactly once. */
  finishedCount: number
  lastAdvisories: number
}

let runState: AuditRunState = { status: 'idle', repo: null, runs: [], notice: '', error: '', finishedCount: 0, lastAdvisories: 0 }
const runListeners = new Set<(s: AuditRunState) => void>()

function setRunState(patch: Partial<AuditRunState>) {
  runState = { ...runState, ...patch }
  runListeners.forEach((fn) => fn(runState))
}

export const getAuditRun = () => runState

export function subscribeAuditRun(fn: (s: AuditRunState) => void): () => void {
  runListeners.add(fn)
  return () => {
    runListeners.delete(fn)
  }
}

export function clearAuditMessages() {
  setRunState({ notice: '', error: '' })
}

export interface StartAuditOptions {
  token: string
  repo: GitHubRepository
  queue: string[]
  analyze: (path: string) => Promise<GitHubAnalysisReport>
  onEach?: (path: string, report: GitHubAnalysisReport) => void
  merge: (ok: { path: string; report: GitHubAnalysisReport }[]) => GitHubAnalysisReport | null
  /** App-level setter: stays valid even if the panel that started the run is gone. */
  onReport: (report: GitHubAnalysisReport) => void
}

export async function startAudit(opts: StartAuditOptions): Promise<void> {
  if (runState.status === 'running') return
  const { repo, queue } = opts
  let current: ManifestRun[] = queue.map((path) => ({ path, status: 'pending' }))
  setRunState({ status: 'running', repo: repo.full_name, runs: current, notice: '', error: '' })

  for (const path of queue) {
    current = current.map((r) => (r.path === path ? { ...r, status: 'running' } : r))
    setRunState({ runs: current })
    try {
      const report = await opts.analyze(path)
      current = current.map((r) => (r.path === path ? { ...r, status: 'done', report } : r))
      opts.onEach?.(path, report)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'This manifest couldn’t be audited.'
      current = current.map((r) => (r.path === path ? { ...r, status: 'failed', error: message } : r))
    }
    setRunState({ runs: current })
  }

  const ok = current.filter((r) => r.report).map((r) => ({ path: r.path, report: r.report! }))
  const failed = current.filter((r) => r.status === 'failed')
  const merged = opts.merge(ok)
  const s = getAuditSession(opts.token)
  s.runs = current

  if (!merged) {
    setRunState({
      status: 'failed',
      error: failed[0]?.error ?? 'The audit couldn’t be completed. Please try again in a moment.',
      finishedCount: runState.finishedCount + 1,
      lastAdvisories: 0,
    })
    return
  }
  opts.onReport(merged)
  s.viewMode = 'report'
  s.reportView = 'all'
  const files = `${ok.length} manifest${ok.length === 1 ? '' : 's'}`
  setRunState({
    status: 'done',
    notice:
      `Audit complete for ${repo.full_name}: ${merged.vulnerability_count} advisor${merged.vulnerability_count === 1 ? 'y' : 'ies'} across ${files}.` +
      (failed.length ? ` ${failed.length} file${failed.length === 1 ? '' : 's'} couldn’t be audited.` : ''),
    finishedCount: runState.finishedCount + 1,
    lastAdvisories: merged.vulnerability_count,
  })
}
