import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy, Download, ExternalLink, FileJson, Search, ShieldCheck, Sparkles } from 'lucide-react'
import { exportFindingsCsv, exportJson, type Finding } from './exporters'

interface FindingsPanelProps {
  findings: Finding[]
  hasResults: boolean
  sourceLabel: string
  onAudit: () => void
  notify: (message: string) => void
}

type Sort = 'package' | 'id'

export default function FindingsPanel({ findings, hasResults, sourceLabel, onAudit, notify }: FindingsPanelProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('package')
  const [copied, setCopied] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? findings.filter((f) =>
          [f.packageName, f.version, f.id, f.summary, ...f.aliases].some((v) => v.toLowerCase().includes(q)),
        )
      : findings
    return [...list].sort((a, b) =>
      sort === 'package' ? a.packageName.localeCompare(b.packageName) || a.id.localeCompare(b.id) : a.id.localeCompare(b.id),
    )
  }, [findings, query, sort])

  const packages = new Set(findings.map((f) => f.packageName)).size

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      notify(`Copied ${text}`)
      window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1600)
    } catch {
      notify('Copy isn’t available in this browser')
    }
  }

  if (findings.length === 0) {
    return (
      <section className="hbd-panel hbd-empty">
        <div className="hbd-empty-art" aria-hidden="true">
          <span className="hbd-empty-card c1" />
          <span className="hbd-empty-card c2" />
          <span className="hbd-empty-card c3">
            <ShieldCheck size={28} strokeWidth={1.5} />
          </span>
        </div>
        <h3 className="hbd-serif">{hasResults ? 'No known advisories' : 'Nothing audited yet'}</h3>
        <p>
          {hasResults
            ? 'Every pinned dependency we checked is currently clear of known OSV advisories. Unpinned ranges can’t be checked exactly.'
            : 'Audit one of your repositories or paste a manifest into the manual scanner, and any matching advisories will show up here.'}
        </p>
        <button type="button" className="hb-btn hb-btn-primary" onClick={onAudit}>
          <Sparkles size={15} /> Audit a repository
        </button>
      </section>
    )
  }

  return (
    <section className="hbd-panel">
      <div className="hbd-toolbar">
        <div className="hbd-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search package, advisory ID or summary…"
            aria-label="Search findings"
          />
          {query && <span className="hbd-search-count">{visible.length}/{findings.length}</span>}
        </div>
        <label className="hbd-select">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="package">Package</option>
            <option value="id">Advisory ID</option>
          </select>
        </label>
        <div className="hbd-toolbar-right">
          <button type="button" className="hb-btn hb-btn-ghost hbd-btn-sm" onClick={() => { exportFindingsCsv(visible, sourceLabel); notify('Downloaded CSV') }}>
            <Download size={14} /> CSV
          </button>
          <button type="button" className="hb-btn hb-btn-ghost hbd-btn-sm" onClick={() => { exportJson(visible, `${sourceLabel}-findings`); notify('Downloaded JSON') }}>
            <FileJson size={14} /> JSON
          </button>
        </div>
      </div>

      <p className="hbd-summary">
        <strong>{findings.length}</strong> advisor{findings.length === 1 ? 'y' : 'ies'} across <strong>{packages}</strong>{' '}
        package{packages === 1 ? '' : 's'}, all matched from OSV.dev.
      </p>

      {visible.length === 0 ? (
        <p className="hbd-noresults">No findings match “{query}”.</p>
      ) : (
        <ul className="hbd-findings">
          {visible.map((f, i) => (
            <li key={f.key} className="hbd-finding" style={{ '--i': Math.min(i, 10) } as React.CSSProperties}>
              <div className="hbd-finding-top">
                <div className="hbd-finding-pkg">
                  <AlertTriangle size={16} />
                  <strong>{f.packageName}</strong>
                  <code>{f.version}</code>
                </div>
                <div className="hbd-finding-id">
                  <a href={`https://osv.dev/vulnerability/${f.id}`} target="_blank" rel="noreferrer">
                    {f.id} <ExternalLink size={11} />
                  </a>
                  <button type="button" className="hbd-icon-btn" onClick={() => copy(f.id)} aria-label={`Copy ${f.id}`}>
                    {copied === f.id ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
              <p className="hbd-finding-summary">{f.summary || 'No summary was published for this advisory.'}</p>
              <div className="hbd-finding-foot">
                {f.aliases.slice(0, 6).map((a) => (
                  <span key={a} className="hb-chip">{a}</span>
                ))}
                <span className="hbd-finding-fix">Fix: upgrade to a version outside the affected range in the advisory.</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
