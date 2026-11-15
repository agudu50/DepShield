import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Copy, Info, ShieldAlert } from 'lucide-react'
import { osvEcosystem, queryPackage, safeVersion, SEVERITY_ORDER, upgradeCommand, type OsvAdvisory, type OsvSeverity } from '../osv'
import type { AdvisoryTarget } from './AdvisoryModal'

export interface VulnerablePackage {
  name: string
  version: string
  ecosystem: string
  advisoryIds: string[]
}

const CHIP_LIMIT = 6

function usePackageAdvisories(name: string, ecosystem: string, version: string) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; list: OsvAdvisory[] }>({ status: 'loading', list: [] })
  useEffect(() => {
    let active = true
    setState({ status: 'loading', list: [] })
    queryPackage(name, ecosystem, version)
      .then((list) => active && setState({ status: 'ready', list }))
      .catch(() => active && setState({ status: 'error', list: [] }))
    return () => {
      active = false
    }
  }, [name, ecosystem, version])
  return state
}

function PackageCard({ pkg, onOpen, index }: { pkg: VulnerablePackage; onOpen: (t: AdvisoryTarget) => void; index: number }) {
  const { status, list } = usePackageAdvisories(pkg.name, pkg.ecosystem, pkg.version)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const byId = useMemo(() => {
    const m = new Map<string, OsvAdvisory>()
    for (const a of list) {
      m.set(a.id, a)
      for (const al of a.aliases) if (!m.has(al)) m.set(al, a)
    }
    return m
  }, [list])

  // Only advisories the audit actually matched (OSV may also return related records).
  const matched = pkg.advisoryIds.map((id) => byId.get(id)).filter(Boolean) as OsvAdvisory[]
  const { target, unfixed } = safeVersion(pkg.version, matched.length ? matched : list)
  const worst: OsvSeverity = matched.reduce<OsvSeverity>(
    (w, a) => (SEVERITY_ORDER.indexOf(a.severity) < SEVERITY_ORDER.indexOf(w) ? a.severity : w),
    'UNKNOWN',
  )
  const sortedIds = [...pkg.advisoryIds].sort((a, b) => {
    const sa = SEVERITY_ORDER.indexOf(byId.get(a)?.severity ?? 'UNKNOWN')
    const sb = SEVERITY_ORDER.indexOf(byId.get(b)?.severity ?? 'UNKNOWN')
    return sa - sb || a.localeCompare(b)
  })
  const shown = expanded ? sortedIds : sortedIds.slice(0, CHIP_LIMIT)
  const cmd = upgradeCommand(pkg.name, pkg.ecosystem, status === 'ready' ? target : null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <li className="hbx-card" style={{ '--i': Math.min(index, 8) } as React.CSSProperties}>
      <div className="hbx-top">
        <div className="hbx-pkg">
          <strong>{pkg.name}</strong>
          <span className="hb-chip">{osvEcosystem(pkg.ecosystem) === 'PyPI' ? 'PyPI' : 'npm'}</span>
          {status === 'ready' && worst !== 'UNKNOWN' && (
            <span className={`hba-sev sev-${worst.toLowerCase()}`}><ShieldAlert size={11} /> {worst.toLowerCase()}</span>
          )}
        </div>
        <div className="hbx-versions" aria-label="Upgrade path">
          <code className="hbx-from">{pkg.version}</code>
          <ArrowRight size={14} />
          {status === 'loading' ? (
            <span className="hbx-shimmer" aria-label="Finding a safe version" />
          ) : (
            <code className="hbx-to">{target ?? 'latest'}</code>
          )}
        </div>
      </div>

      <p className="hbx-desc">
        {status === 'loading'
          ? 'Checking OSV.dev for the version that fixes these advisories…'
          : status === 'error'
            ? 'Couldn’t reach OSV.dev for fix versions. Upgrading to the latest release is the usual remedy; check the changelog first.'
            : target
              ? `Version ${target} is the smallest release past every matched advisory that has a fix.`
              : 'No fixed version is published for these advisories yet. Open an advisory for workarounds.'}
        {status === 'ready' && target && unfixed.length > 0 && ` ${unfixed.length} advisor${unfixed.length === 1 ? 'y has' : 'ies have'} no fix yet.`}
      </p>

      <div className="hbx-cmd">
        <code>$ {cmd}</code>
        <button type="button" className="hbd-icon-btn" onClick={() => void copy()} aria-label={`Copy command for ${pkg.name}`}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>

      <div className="hbx-ids">
        <span className="hbx-ids-label">
          {pkg.advisoryIds.length} advisor{pkg.advisoryIds.length === 1 ? 'y' : 'ies'}
          <Info size={12} aria-hidden="true" />
        </span>
        {shown.map((id) => {
          const sev = byId.get(id)?.severity
          return (
            <button
              key={id}
              type="button"
              className={`hbx-id ${sev ? `sev-${sev.toLowerCase()}` : ''}`}
              onClick={() => onOpen({ id, packageName: pkg.name, version: pkg.version, ecosystem: pkg.ecosystem })}
              title={byId.get(id)?.summary ?? 'What does this advisory mean?'}
            >
              {id}
            </button>
          )
        })}
        {sortedIds.length > CHIP_LIMIT && (
          <button type="button" className="hbd-link hbx-more" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? 'Show fewer' : `+${sortedIds.length - CHIP_LIMIT} more`}
          </button>
        )}
      </div>
    </li>
  )
}

/** One card per vulnerable package; by default the most-affected first. */
export default function RemediationList({
  packages,
  onOpen,
  keepOrder = false,
}: {
  packages: VulnerablePackage[]
  onOpen: (t: AdvisoryTarget) => void
  /** Use the caller's order instead of sorting by advisory count. */
  keepOrder?: boolean
}) {
  const ordered = keepOrder
    ? packages
    : [...packages].sort((a, b) => b.advisoryIds.length - a.advisoryIds.length || a.name.localeCompare(b.name))
  return (
    <ul className="hbx-list">
      {ordered.map((p, i) => (
        <PackageCard key={`${p.ecosystem}:${p.name}@${p.version}`} pkg={p} onOpen={onOpen} index={i} />
      ))}
    </ul>
  )
}
