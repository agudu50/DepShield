import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, BookOpen, Check, ChevronDown, Copy, ExternalLink, ShieldAlert, X } from 'lucide-react'
import { compareVersions, describeId, queryPackage, upgradeCommand, type OsvAdvisory } from '../osv'

export interface AdvisoryTarget {
  id: string
  packageName: string
  version: string
  ecosystem: string
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null

/** First paragraph of the advisory text, without markdown headings. */
function firstParagraph(text: string | null) {
  if (!text) return null
  const para = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#+\s.*$/gm, '').replace(/[*_`]/g, '').trim())
    .find((p) => p.length > 30)
  return para ? (para.length > 420 ? `${para.slice(0, 420).trimEnd()}…` : para) : null
}

/**
 * Explains one advisory in plain language, with live details from OSV.dev.
 * Esc / backdrop closes; focus moves in on open and returns on close.
 */
export default function AdvisoryModal({ target, onClose }: { target: AdvisoryTarget | null; onClose: () => void }) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; advisory?: OsvAdvisory }>({ status: 'loading' })
  const [copied, setCopied] = useState<string | null>(null)
  const [showGlossary, setShowGlossary] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const latestClose = useRef(onClose)
  latestClose.current = onClose
  const titleId = useId()

  useEffect(() => {
    if (!target) return
    let active = true
    setState({ status: 'loading' })
    setShowGlossary(false)
    queryPackage(target.packageName, target.ecosystem, target.version)
      .then((list) => {
        if (!active) return
        const hit = list.find((a) => a.id === target.id || a.aliases.includes(target.id))
        setState(hit ? { status: 'ready', advisory: hit } : { status: 'error' })
      })
      .catch(() => active && setState({ status: 'error' }))
    return () => {
      active = false
    }
  }, [target])

  useEffect(() => {
    if (!target) return
    const prev = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && latestClose.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [target])

  if (!target) return null

  const about = describeId(target.id)
  const adv = state.advisory
  const fix = adv?.fixed.find((f) => compareVersions(f, target.version) > 0) ?? null
  const cmd = upgradeCommand(target.packageName, target.ecosystem, fix)
  const headline = adv?.summary ?? firstParagraph(adv?.details ?? null)

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="ss-modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="ss-modal hba-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="ss-modal-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <span className="hb-kicker">Security advisory</span>
        <div className="hba-id-row">
          <h2 id={titleId} className="hba-id">{target.id}</h2>
          <button type="button" className="hbd-icon-btn" onClick={() => void copy(target.id)} aria-label={`Copy ${target.id}`}>
            {copied === target.id ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <p className="hba-source">From the {about.source}</p>

        {state.status === 'loading' && (
          <div className="hba-skel" aria-label="Loading details from OSV.dev" role="status">
            <span /><span /><span className="short" />
          </div>
        )}

        {state.status === 'ready' && adv && (
          <>
            {adv.withdrawn && (
              <p className="hba-warn"><AlertTriangle size={14} /> This advisory was withdrawn on {fmtDate(adv.withdrawn)} and may no longer apply.</p>
            )}
            <div className="hba-badges">
              <span className={`hba-sev sev-${adv.severity.toLowerCase()}`}>
                <ShieldAlert size={12} />
                {adv.severity === 'UNKNOWN' ? 'Severity not rated' : adv.severity.toLowerCase()}
                {adv.score !== null && <b>{adv.score.toFixed(1)}</b>}
              </span>
              {adv.published && <span className="hb-chip">Published {fmtDate(adv.published)}</span>}
              {adv.cwes.slice(0, 2).map((c) => <span key={c} className="hb-chip">{c}</span>)}
            </div>
            {headline && <p className="hba-headline">{headline}</p>}
          </>
        )}

        <section className="hba-explain">
          <h3 className="hbd-serif">What this means</h3>
          <p>
            <strong>{target.packageName} {target.version}</strong> is in a version range that OSV.dev lists as affected.
            It doesn’t prove your code uses the vulnerable feature, but upgrading removes the risk.
          </p>
          {state.status === 'ready' && adv && (
            <p>
              {fix ? (
                <>The issue is fixed in <strong>{fix}</strong>{adv.fixed.length > 1 ? ` (patched releases: ${adv.fixed.slice(0, 4).join(', ')})` : ''}.</>
              ) : adv.lastAffected ? (
                <>No fixed version is listed; versions up to <strong>{adv.lastAffected}</strong> are affected. Check the advisory for workarounds.</>
              ) : (
                <>No fixed version is listed yet. Check the advisory for workarounds or consider an alternative package.</>
              )}
            </p>
          )}
          <div className="hba-cmd">
            <code>$ {cmd}</code>
            <button type="button" className="hbd-icon-btn" onClick={() => void copy(cmd)} aria-label="Copy command">
              {copied === cmd ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <p className="hba-hint">Check the package changelog before a major-version upgrade.</p>
        </section>

        {state.status === 'error' && (
          <p className="hba-warn"><AlertTriangle size={14} /> We couldn’t load details from OSV.dev right now. The full advisory is still available below.</p>
        )}

        <button type="button" className="hba-glossary-toggle" onClick={() => setShowGlossary((s) => !s)} aria-expanded={showGlossary}>
          <BookOpen size={13} /> What do GHSA, CVE and PYSEC mean?
          <ChevronDown size={13} className={showGlossary ? 'is-open' : ''} />
        </button>
        {showGlossary && (
          <dl className="hba-glossary">
            {['GHSA', 'CVE', 'PYSEC', 'MAL'].map((p) => (
              <div key={p}>
                <dt>{p}</dt>
                <dd><strong>{describeId(p).source}.</strong> {describeId(p).note}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="hba-foot">
          <a className="hb-btn hb-btn-primary hba-open" href={`https://osv.dev/vulnerability/${encodeURIComponent(target.id)}`} target="_blank" rel="noreferrer">
            Open full advisory on OSV.dev <ExternalLink size={14} />
          </a>
          <span className="hba-privacy">Details load from OSV.dev. Only the package name, version and advisory ID are sent.</span>
        </div>
      </div>
    </div>
  )
}
