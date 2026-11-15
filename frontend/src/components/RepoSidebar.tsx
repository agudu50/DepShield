import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Globe, Lock, RefreshCw, Search, Star, X } from 'lucide-react'
import { listGitHubRepos, type GitHubRepository } from '../api'
import { getAuditSession, REPOS_STALE_MS } from './auditSession'

const PER_PAGE = 50
const AUDITABLE = new Set(['javascript', 'typescript', 'python', 'jupyter notebook', 'vue', 'svelte'])

type Filter = 'all' | 'mine' | 'shared' | 'private' | 'auditable'
type Sort = 'updated' | 'name' | 'stars'

const FILTERS: { id: Filter; label: string; title: string }[] = [
  { id: 'all', label: 'All', title: 'Every repository you can access' },
  { id: 'mine', label: 'Mine', title: 'Repositories you own' },
  { id: 'shared', label: 'Shared', title: 'Owned by other people or organizations' },
  { id: 'private', label: 'Private', title: 'Private repositories' },
  { id: 'auditable', label: 'JS · TS · Python', title: 'Languages DepShield audits (npm and Python)' },
]

function ago(iso: string) {
  const t = Date.parse(iso)
  if (!t) return ''
  const d = Math.floor((Date.now() - t) / 86400000)
  if (d < 1) return 'today'
  if (d < 30) return `${d}d ago`
  const m = Math.floor(d / 30)
  if (m < 12) return `${m}mo ago`
  return `${Math.floor(m / 12)}y ago`
}

interface RepoSidebarProps {
  token: string
  login: string
  selectedId: number | null
  onSelect: (repo: GitHubRepository) => void
  onError: (message: string) => void
}

export default function RepoSidebar({ token, login, selectedId, onSelect, onError }: RepoSidebarProps) {
  const session = getAuditSession(token)
  const cached = session.repos
  const [repos, setRepos] = useState<GitHubRepository[]>(() => cached?.list ?? [])
  const [page, setPage] = useState(() => cached?.page ?? 1)
  const [hasMore, setHasMore] = useState(() => cached?.hasMore ?? false)
  // Skeleton only when there is nothing to show yet; refreshes happen quietly.
  const [loading, setLoading] = useState(() => !cached)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reload, setReload] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('updated')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const s = getAuditSession(token)
    const fresh = s.repos && Date.now() - s.repos.fetchedAt < REPOS_STALE_MS
    if (reload === 0 && fresh) return // returning to the tab: reuse what we have

    let active = true
    const quiet = Boolean(s.repos)
    if (quiet) setRefreshing(true)
    else setLoading(true)
    // One shared first-page request writes the cache, even if this mount is gone by then
    // (React may mount twice); every live mount then reads from the cache.
    const forced = reload > 0
    if (!s.reposPending || forced) {
      const req = listGitHubRepos(token, 1, PER_PAGE).then((first) => {
        // Keep any extra pages already loaded, refreshed by the new first page.
        const ids = new Set(first.map((r) => r.id))
        const extra = (s.repos?.list ?? []).slice(PER_PAGE).filter((r) => !ids.has(r.id))
        s.repos = {
          list: [...first, ...extra],
          page: extra.length ? (s.repos?.page ?? 1) : 1,
          hasMore: extra.length ? (s.repos?.hasMore ?? false) : first.length === PER_PAGE,
          fetchedAt: Date.now(),
        }
        return first
      })
      s.reposPending = req
      req
        .finally(() => {
          if (s.reposPending === req) s.reposPending = null
        })
        .catch(() => {})
    }
    s.reposPending
      .then(() => {
        if (!active || !s.repos) return
        setRepos(s.repos.list)
        setPage(s.repos.page)
        setHasMore(s.repos.hasMore)
      })
      .catch((err) => active && onError(err instanceof Error ? err.message : 'We couldn’t load your repositories.'))
      .finally(() => {
        if (!active) return
        setLoading(false)
        setRefreshing(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reload])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const next = await listGitHubRepos(token, page + 1, PER_PAGE)
      const seen = new Set(repos.map((r) => r.id))
      const list = [...repos, ...next.filter((r) => !seen.has(r.id))]
      const more = next.length === PER_PAGE
      setRepos(list)
      setPage(page + 1)
      setHasMore(more)
      getAuditSession(token).repos = { list, page: page + 1, hasMore: more, fetchedAt: Date.now() }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'We couldn’t load more repositories.')
    } finally {
      setLoadingMore(false)
    }
  }

  const owner = (r: GitHubRepository) => r.full_name.split('/')[0]
  const counts = useMemo(
    () => ({
      all: repos.length,
      mine: repos.filter((r) => owner(r).toLowerCase() === login.toLowerCase()).length,
      shared: repos.filter((r) => owner(r).toLowerCase() !== login.toLowerCase()).length,
      private: repos.filter((r) => r.private).length,
      auditable: repos.filter((r) => r.language && AUDITABLE.has(r.language.toLowerCase())).length,
    }),
    [repos, login],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = repos.filter((r) => {
      if (filter === 'mine' && owner(r).toLowerCase() !== login.toLowerCase()) return false
      if (filter === 'shared' && owner(r).toLowerCase() === login.toLowerCase()) return false
      if (filter === 'private' && !r.private) return false
      if (filter === 'auditable' && !(r.language && AUDITABLE.has(r.language.toLowerCase()))) return false
      if (!q) return true
      return [r.full_name, r.description ?? '', r.language ?? ''].some((v) => v.toLowerCase().includes(q))
    })
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'stars') return b.stargazers_count - a.stargazers_count || a.name.localeCompare(b.name)
      return Date.parse(b.updated_at || '0') - Date.parse(a.updated_at || '0')
    })
  }, [repos, query, filter, sort, login])

  // ↑/↓ move between repositories; Home/End jump to the ends.
  function onListKey(e: React.KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.hbr-item') ?? [])
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
    items[next].focus()
  }

  const filtered = filter !== 'all' || query.trim() !== ''

  return (
    <aside className="hbr" aria-label="Repositories">
      <div className="hbr-head">
        <div className="hbr-title-row">
          <h3 className="hbd-serif hbr-title">Repositories</h3>
          <span className="hbr-total">{loading ? '…' : `${repos.length}${hasMore ? '+' : ''}`}</span>
          <button
            type="button"
            className="hbd-icon-btn hbr-refresh"
            onClick={() => setReload((n) => n + 1)}
            disabled={loading || refreshing}
            aria-label={refreshing ? 'Refreshing repositories' : 'Reload repositories'}
            title={refreshing ? 'Refreshing from GitHub…' : 'Reload from GitHub'}
          >
            <RefreshCw size={13} className={loading || refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="hbd-search hbr-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                listRef.current?.querySelector<HTMLButtonElement>('.hbr-item')?.focus()
              }
            }}
            placeholder="Search name, description, language"
            aria-label="Search repositories"
          />
          {query && (
            <button type="button" className="hbd-icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="hbr-filters" role="group" aria-label="Filter repositories">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={filter === f.id ? 'active' : ''}
              aria-pressed={filter === f.id}
              title={f.title}
              onClick={() => setFilter(f.id)}
              disabled={f.id !== 'all' && counts[f.id] === 0}
            >
              {f.label} <b>{counts[f.id]}</b>
            </button>
          ))}
        </div>

        <div className="hbr-subbar">
          <span>{filtered ? `${visible.length} of ${repos.length}` : `${repos.length} repositories`}</span>
          <label className="hbr-sort">
            <span className="sr-only">Sort by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort repositories">
              <option value="updated">Recently updated</option>
              <option value="name">Name</option>
              <option value="stars">Stars</option>
            </select>
            <ChevronDown size={12} aria-hidden="true" />
          </label>
        </div>
      </div>

      <div className="hbr-list" ref={listRef} onKeyDown={onListKey} role="list">
        {loading ? (
          [0, 1, 2, 3, 4].map((i) => <div key={i} className="hbr-skel" style={{ '--i': i } as React.CSSProperties} aria-hidden="true" />)
        ) : visible.length === 0 ? (
          <div className="hbr-empty">
            <p>{repos.length ? 'No repositories match.' : 'No repositories found for this account.'}</p>
            {filtered && (
              <button type="button" className="hbd-link" onClick={() => { setQuery(''); setFilter('all') }}>
                Clear search and filters
              </button>
            )}
          </div>
        ) : (
          visible.map((repo, i) => {
            const selected = repo.id === selectedId
            const own = owner(repo).toLowerCase() === login.toLowerCase()
            return (
              <div role="listitem" key={repo.id} style={{ '--i': Math.min(i, 10) } as React.CSSProperties} className="hbr-li">
                <button
                  type="button"
                  className={`hbr-item ${selected ? 'is-selected' : ''}`}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(repo)}
                >
                  <span className="hbr-mono" aria-hidden="true">{repo.name.charAt(0).toUpperCase()}</span>
                  <span className="hbr-body">
                    <span className="hbr-name">
                      {!own && <span className="hbr-owner">{owner(repo)}/</span>}
                      <span className="hbr-repo">{repo.name}</span>
                    </span>
                    {repo.description && <span className="hbr-desc">{repo.description}</span>}
                    <span className="hbr-meta">
                      <span className="hbr-vis">
                        {repo.private ? <Lock size={10} /> : <Globe size={10} />}
                        {repo.private ? 'Private' : 'Public'}
                      </span>
                      {repo.language && (
                        <span className={`hbr-lang ${AUDITABLE.has(repo.language.toLowerCase()) ? 'is-auditable' : ''}`}>
                          <i /> {repo.language}
                        </span>
                      )}
                      {repo.stargazers_count > 0 && (
                        <span><Star size={10} /> {repo.stargazers_count}</span>
                      )}
                      {repo.updated_at && <span className="hbr-updated">{ago(repo.updated_at)}</span>}
                    </span>
                  </span>
                  {selected && (
                    <span className="hbr-selected" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                  )}
                </button>
              </div>
            )
          })
        )}

        {!loading && hasMore && !filtered && (
          <button type="button" className="hb-btn hb-btn-ghost hbd-btn-sm hbr-more" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? <RefreshCw size={13} className="animate-spin" /> : <ChevronDown size={14} />}
            {loadingMore ? 'Loading…' : 'Load more repositories'}
          </button>
        )}
        {!loading && hasMore && filtered && (
          <p className="hbr-partial">
            Searching the first {repos.length}.{' '}
            <button type="button" className="hbd-link" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </p>
        )}
      </div>
    </aside>
  )
}
