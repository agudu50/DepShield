import type { GitHubManifestFile, GitHubRepository } from '../api'
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
