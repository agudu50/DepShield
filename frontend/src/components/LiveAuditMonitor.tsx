import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpDown,
  Check,
  Copy,
  Cpu,
  ExternalLink,
  FileJson,
  Filter,
  FolderGit2,
  Globe,
  Laptop,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import {
  getStoredEvents,
  subscribeTelemetry,
  clearTelemetryEvents,
  addTelemetryEvent,
  type TelemetryEvent,
} from '../telemetry'
import { checkBifrostHealth } from '../api'
import { bifrostHealthToEvent } from '../bifrostProbe'
import StatCards from './dashboard/StatCards'
import { exportJson } from './dashboard/exporters'

type Category = TelemetryEvent['category']
type Filter = 'all' | Category
export type SortOrder = 'newest' | 'oldest' | 'project' | 'risk'

export interface ParsedTarget {
  project?: string
  subpath?: string
  suffix?: string
  isRepo: boolean
}

export function parseEventTarget(target: string): ParsedTarget {
  const repoMatch = target.match(/^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)(\/.*?)?(\s*\(.*\))?$/)
  if (repoMatch && !target.startsWith('http')) {
    const project = repoMatch[1]
    const subpath = repoMatch[2] ? repoMatch[2].replace(/^\//, '') : ''
    const suffix = repoMatch[3] ? repoMatch[3].trim() : ''
    return { project, subpath, suffix, isRepo: true }
  }

  const manualMatch = target.match(/^(.+?)\s*\((npm|python)\s+(manifest|lockfile)\)$/i)
  if (manualMatch) {
    return { project: manualMatch[1].trim(), suffix: `(${manualMatch[2]} ${manualMatch[3]})`, isRepo: false }
  }

  return { isRepo: false }
}

const CATEGORIES: { id: Category; label: string; shade: string }[] = [
  { id: 'file_read', label: 'Files read', shade: '1' },
  { id: 'osv_query', label: 'OSV lookups', shade: '2' },
  { id: 'policy_gate', label: 'Policy & AI', shade: '3' },
  { id: 'privacy_guard', label: 'Privacy', shade: '4' },
  { id: 'heartbeat', label: 'Gateway checks', shade: '5' },
]

const CLI_COMMANDS = [
  { name: 'Watch lockfiles', desc: 'Re-checks dependencies whenever a lockfile changes.', cmd: 'depshield monitor' },
  { name: 'Check before install', desc: 'Looks a package up on OSV.dev first, with install scripts disabled.', cmd: 'depshield add express@4.18.2' },
  { name: 'GitHub status', desc: 'Shows which GitHub account the CLI is signed in as.', cmd: 'depshield github status' },
  { name: 'Offline audit', desc: 'Audits dependencies without any network traffic.', cmd: 'depshield audit --offline' },
]

const GUARANTEES = [
  { title: 'Manifests only', body: 'An audit downloads just the manifest you pick, such as package.json or uv.lock.' },
  { title: 'Package name + version', body: 'That’s all that is sent to OSV.dev. No code, paths or commit data.' },
  { title: 'AI sees evidence, not code', body: 'Bifrost receives the matched OSV advisories, never repository files.' },
  { title: 'Tokens stay with you', body: 'The CLI uses your OS keychain; the web app keeps the token in this browser.' },
]

const SOURCE_ICON = { cli: Laptop, agent: Cpu, gateway: Globe } as const

const ACRONYMS: Record<string, string> = { osv: 'OSV', ai: 'AI', cli: 'CLI', cve: 'CVE' }
const humanize = (action: string) => {
  const s = action
    .toLowerCase()
    .split('_')
    .map((w) => ACRONYMS[w] ?? w)
    .join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function relTime(at: number | undefined, now: number) {
  if (!at) return null
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function LiveAuditMonitor({ notify }: { notify?: (message: string) => void }) {
  const [liveEvents, setLiveEvents] = useState<TelemetryEvent[]>(() => getStoredEvents())
  const [paused, setPaused] = useState<TelemetryEvent[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [search, setSearch] = useState('')
  const [probing, setProbing] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [confirmClear, setConfirmClear] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const seen = useRef(new Set(getStoredEvents().map((e) => e.id)))
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set())

  // Events that arrive while you watch get a one-off highlight.
  useEffect(
    () =>
      subscribeTelemetry((updated) => {
        const fresh = updated.filter((e) => !seen.current.has(e.id)).map((e) => e.id)
        fresh.forEach((id) => seen.current.add(id))
        if (fresh.length) setNewIds(new Set(fresh))
        setLiveEvents(updated)
      }),
    [],
  )
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(t)
  }, [])

  // "/" jumps to search, like most log viewers.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const events = paused ?? liveEvents
  const pending = paused ? liveEvents.length - paused.length : 0

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of events) c[e.category] = (c[e.category] ?? 0) + 1
    return c
  }, [events])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter((e) => {
      if (filter !== 'all' && e.category !== filter) return false
      if (!q) return true
      return [e.action, e.target, e.details, e.source].some((v) => v.toLowerCase().includes(q))
    })
  }, [events, filter, search])

  const flagged = events.filter((e) => e.verdict === 'warning' || e.verdict === 'blocked').length
  const egress = events.reduce((sum, e) => sum + e.bytesSent, 0)
  const codeRead = events.reduce((sum, e) => sum + e.sourceCodeRead, 0)
  const lastAt = events.find((e) => e.at)?.at

  async function probe() {
    setProbing(true)
    try {
      const evt = bifrostHealthToEvent(await checkBifrostHealth())
      addTelemetryEvent(evt)
      notify?.(evt.verdict === 'safe' ? 'Bifrost answered' : 'Bifrost didn’t answer, see the stream')
    } finally {
      setProbing(false)
    }
  }

  async function copy(cmd: string) {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(cmd)
      window.setTimeout(() => setCopied((c) => (c === cmd ? null : c)), 1600)
    } catch {
      notify?.('Copy isn’t available in this browser')
    }
  }

  function clearAll() {
    clearTelemetryEvents()
    setPaused(null)
    setConfirmClear(false)
    notify?.('Stream cleared')
  }

  return (
    <div className="hbl">
      {/* Status + actions */}
      <div className="hbl-head">
        <div className={`hbl-rec ${paused ? 'is-paused' : ''}`} role="status">
          <span className="hbl-rec-dot" />
          <span>
            {paused ? 'Paused' : 'Recording in this browser'} · {events.length} event{events.length === 1 ? '' : 's'}
            {lastAt ? ` · last ${relTime(lastAt, now)}` : ''}
          </span>
          {pending > 0 && (
            <button type="button" className="hbl-pending" onClick={() => setPaused(null)}>
              {pending} new
            </button>
          )}
        </div>
        <div className="hbl-actions">
          <button
            type="button"
            className="hb-btn hb-btn-ghost hbd-btn-sm"
            onClick={() => setPaused(paused ? null : liveEvents)}
            aria-pressed={Boolean(paused)}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />} {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="hb-btn hb-btn-ghost hbd-btn-sm" onClick={() => void probe()} disabled={probing}>
            {probing ? <RefreshCw size={14} className="spin" /> : <ShieldCheck size={14} />} Probe Bifrost
          </button>
          <button
            type="button"
            className="hb-btn hb-btn-ghost hbd-btn-sm"
            disabled={!events.length}
            onClick={() => {
              exportJson(events, 'audit-stream')
              notify?.('Downloaded stream JSON')
            }}
          >
            <FileJson size={14} /> Export
          </button>
          {confirmClear ? (
            <span className="hbl-confirm">
              Clear {events.length} events?
              <button type="button" className="hbd-link" onClick={clearAll}>Clear</button>
              <button type="button" className="hbd-icon-btn" onClick={() => setConfirmClear(false)} aria-label="Cancel">
                <X size={12} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="hb-btn hb-btn-ghost hbd-btn-sm"
              disabled={!liveEvents.length}
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      <StatCards
        stats={[
          { label: 'Events recorded', value: events.length, note: 'In this browser' },
          { label: 'Warnings & blocks', value: flagged, note: flagged ? 'Needs a look' : 'Nothing flagged', tone: 'alert', onClick: flagged ? () => setFilter('policy_gate') : undefined },
          { label: 'Data sent (approx.)', value: egress, suffix: ' B', note: 'Package names + versions' },
          { label: 'Source files read', value: codeRead, note: 'Only manifests are fetched' },
        ]}
      />

      {/* Activity mix: proportional bar that doubles as a filter */}
      {events.length > 0 && (
        <div className="hbl-mix" aria-label="Activity by type">
          <div className="hbl-mix-bar">
            {CATEGORIES.filter((c) => counts[c.id]).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`hbl-mix-seg shade-${c.shade} ${filter === c.id ? 'is-active' : ''}`}
                style={{ flexGrow: counts[c.id] }}
                onClick={() => setFilter(filter === c.id ? 'all' : c.id)}
                title={`${c.label}: ${counts[c.id]}`}
                aria-label={`Filter to ${c.label} (${counts[c.id]})`}
              />
            ))}
          </div>
          <div className="hbl-mix-legend">
            {CATEGORIES.filter((c) => counts[c.id]).map((c) => (
              <span key={c.id}>
                <i className={`shade-${c.shade}`} /> {c.label} <b>{counts[c.id]}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="hbl-grid">
        {/* Timeline */}
        <section className="hbd-panel hbl-feed" aria-label="Audit events">
          <div className="hbl-toolbar">
            <div className="hbl-filters" role="tablist" aria-label="Filter events">
              <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
                All <b>{events.length}</b>
              </button>
              {CATEGORIES.filter((c) => counts[c.id] || filter === c.id).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === c.id}
                  className={filter === c.id ? 'active' : ''}
                  onClick={() => setFilter(c.id)}
                >
                  {c.label} <b>{counts[c.id] ?? 0}</b>
                </button>
              ))}
            </div>
            <div className="hbd-search hbl-search">
              <Search size={15} />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search action, target or details"
                aria-label="Search events"
              />
              {search ? (
                <button type="button" className="hbd-icon-btn" onClick={() => setSearch('')} aria-label="Clear search">
                  <X size={12} />
                </button>
              ) : (
                <kbd className="hbl-kbd">/</kbd>
              )}
            </div>
          </div>

          {events.length === 0 ? (
            <div className="hbd-empty hbl-empty">
              <div className="hbd-empty-art" aria-hidden="true">
                <span className="hbd-empty-card c1" />
                <span className="hbd-empty-card c2" />
                <span className="hbd-empty-card c3"><Terminal size={26} strokeWidth={1.5} /></span>
              </div>
              <h3 className="hbd-serif">Nothing recorded yet</h3>
              <p>Run an audit or a manual scan and every file read and lookup appears here, newest first.</p>
              <button type="button" className="hb-btn hb-btn-primary" onClick={() => void probe()} disabled={probing}>
                <ShieldCheck size={15} /> Probe Bifrost
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="hbl-noresults">
              <p>No events match{search ? ` “${search}”` : ' this filter'}.</p>
              <button type="button" className="hbd-link" onClick={() => { setFilter('all'); setSearch('') }}>
                Show everything
              </button>
            </div>
          ) : (
            <ol className="hbl-timeline">
              {filtered.map((e, i) => {
                const Icon = SOURCE_ICON[e.source]
                const isNew = newIds.has(e.id)
                return (
                  <li
                    key={e.id}
                    className={`hbl-event verdict-${e.verdict} ${isNew ? 'is-new' : ''}`}
                    style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
                  >
                    <span className="hbl-node" aria-hidden="true"><Icon size={13} /></span>
                    <div className="hbl-card">
                      <div className="hbl-card-top">
                        <strong className="hbl-action">{humanize(e.action)}</strong>
                        <span className={`hbl-verdict v-${e.verdict}`}>
                          {e.verdict === 'safe' && <ShieldCheck size={11} />}
                          {e.verdict === 'warning' && <AlertTriangle size={11} />}
                          {e.verdict === 'blocked' && <ShieldAlert size={11} />}
                          {e.verdict}
                        </span>
                        <time className="hbl-time" title={e.timestamp}>
                          {relTime(e.at, now) ?? e.timestamp}
                        </time>
                      </div>
                      <code className="hbl-target">{e.target}</code>
                      <p className="hbl-details">{e.details}</p>
                      <div className="hbl-meta">
                        <span>{e.source}</span>
                        <span>sent {formatBytes(e.bytesSent)}</span>
                        <span>source read {formatBytes(e.sourceCodeRead)}</span>
                        <span className="hbl-meta-ts">{e.timestamp}</span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        {/* Sidebar */}
        <aside className="hbl-side">
          <section className="hbd-panel hbl-card-flat">
            <span className="hb-kicker">By design</span>
            <h3 className="hbd-serif hbl-side-title">What DepShield can see</h3>
            <ul className="hbl-guarantees">
              {GUARANTEES.map((g, i) => (
                <li key={g.title}>
                  <span className="hbl-g-n">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{g.title}</strong>
                    <p>{g.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="hbd-panel hbl-card-flat">
            <span className="hb-kicker">Terminal</span>
            <h3 className="hbd-serif hbl-side-title">CLI commands</h3>
            <p className="hbl-side-note">
              Run these in your project. Their output appears in your terminal; this stream records what this browser does.
            </p>
            <ul className="hbl-cmds">
              {CLI_COMMANDS.map((c) => (
                <li key={c.cmd}>
                  <div>
                    <strong>{c.name}</strong>
                    <span>{c.desc}</span>
                  </div>
                  <button type="button" className="hbl-cmd" onClick={() => void copy(c.cmd)} aria-label={`Copy ${c.cmd}`}>
                    <code>$ {c.cmd}</code>
                    {copied === c.cmd ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
