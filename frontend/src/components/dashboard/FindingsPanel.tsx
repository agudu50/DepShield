import { useMemo, useState } from 'react'
import { Download, FileJson, Search, ShieldCheck } from 'lucide-react'
import { exportFindingsCsv, exportJson, type Finding } from './exporters'
import AdvisoryModal, { type AdvisoryTarget } from '../AdvisoryModal'
import RemediationList, { type VulnerablePackage } from '../RemediationList'

interface FindingsPanelProps {
  findings: Finding[]
  hasResults: boolean
  sourceLabel: string
  onAudit: () => void
  notify: (message: string) => void
}

type Sort = 'count' | 'package'

export default function FindingsPanel({ findings, hasResults, sourceLabel, onAudit, notify }: FindingsPanelProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('count')
  const [advisory, setAdvisory] = useState<AdvisoryTarget | null>(null)

  // One entry per package@version, carrying every advisory ID matched for it.
  const packages = useMemo(() => {
    const map = new Map<string, VulnerablePackage & { aliases: string[] }>()
    for (const f of findings) {
      const eco = f.ecosystem ?? 'npm'
      const key = `${eco}:${f.packageName}@${f.version}`
      const entry = map.get(key) ?? { name: f.packageName, version: f.version, ecosystem: eco, advisoryIds: [], aliases: [] }
      if (!entry.advisoryIds.includes(f.id)) entry.advisoryIds.push(f.id)
      entry.aliases.push(...f.aliases)
      map.set(key, entry)
    }
    return [...map.values()]
  }, [findings])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? packages.filter((p) => [p.name, p.version, ...p.advisoryIds, ...p.aliases].some((v) => v.toLowerCase().includes(q)))
      : packages
    return [...list].sort((a, b) =>
      sort === 'count' ? b.advisoryIds.length - a.advisoryIds.length || a.name.localeCompare(b.name) : a.name.localeCompare(b.name),
    )
  }, [packages, query, sort])

  const visibleFindings = useMemo(() => {
    const keep = new Set(visible.map((p) => `${p.name}@${p.version}`))
    return findings.filter((f) => keep.has(`${f.packageName}@${f.version}`))
  }, [findings, visible])

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
          <ShieldCheck size={15} /> Audit a repository
        </button>
      </section>
    )
  }

  return (
    <section className="hbd-panel">
      <AdvisoryModal target={advisory} onClose={() => setAdvisory(null)} />

      <div className="hbd-toolbar">
        <div className="hbd-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search package or advisory ID…"
            aria-label="Search findings"
          />
          {query && <span className="hbd-search-count">{visible.length}/{packages.length}</span>}
        </div>
        <label className="hbd-select">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="count">Most advisories</option>
            <option value="package">Package name</option>
          </select>
        </label>
        <div className="hbd-toolbar-right">
          <button type="button" className="hb-btn hb-btn-ghost hbd-btn-sm" onClick={() => { exportFindingsCsv(visibleFindings, sourceLabel); notify('Downloaded CSV') }}>
            <Download size={14} /> CSV
          </button>
          <button type="button" className="hb-btn hb-btn-ghost hbd-btn-sm" onClick={() => { exportJson(visibleFindings, `${sourceLabel}-findings`); notify('Downloaded JSON') }}>
            <FileJson size={14} /> JSON
          </button>
        </div>
      </div>

      <p className="hbd-summary">
        <strong>{findings.length}</strong> advisor{findings.length === 1 ? 'y' : 'ies'} in <strong>{packages.length}</strong>{' '}
        package{packages.length === 1 ? '' : 's'}, matched from OSV.dev. Click any advisory ID to see what it means.
      </p>

      {visible.length === 0 ? (
        <p className="hbd-noresults">No findings match “{query}”.</p>
      ) : (
        <RemediationList packages={visible} onOpen={setAdvisory} keepOrder />
      )}
    </section>
  )
}
