import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { subscribeSiteSummary, trackingAllowed, type SiteSummary } from '../siteMetrics'
import '../workflow.css'

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Counts up the first time it scrolls into view, then eases between later values. */
function Num({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  const seen = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const animate = () => {
      if (reduced()) {
        setShown(value)
        from.current = value
        return
      }
      const start = from.current
      const t0 = performance.now()
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / 1100)
        setShown(Math.round(start + (value - start) * (1 - Math.pow(1 - p, 3))))
        if (p < 1) frame = requestAnimationFrame(tick)
        else from.current = value
      }
      frame = requestAnimationFrame(tick)
    }
    if (seen.current) {
      animate()
      return () => cancelAnimationFrame(frame)
    }
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      seen.current = true
      animate()
    })
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [value])

  return <span ref={ref}>{shown.toLocaleString()}</span>
}

const TILES: { key: keyof SiteSummary; label: string; note: string }[] = [
  { key: 'unique_visitors', label: 'Visitors', note: 'all time' },
  { key: 'visitors_today', label: 'Visitors today', note: 'since midnight UTC' },
  { key: 'manifests_audited', label: 'Manifests audited', note: 'on this site' },
  { key: 'packages_checked', label: 'Packages checked', note: 'against OSV.dev' },
  { key: 'advisories_found', label: 'Advisories found', note: 'and explained' },
]

function useSiteSummary() {
  const [data, setData] = useState<SiteSummary | null>(null)
  useEffect(() => subscribeSiteSummary(setData), [])
  return data
}

/** Compact live line for the hero, above the fold. Hidden only if metrics are unavailable. */
export function SiteMetricsInline() {
  const data = useSiteSummary()
  if (data && !data.available) return null
  const n = (v?: number) => (data ? (v ?? 0).toLocaleString() : '–')
  return (
    <a href="#hsm" className="hsm-inline" onClick={(e) => { e.preventDefault(); document.getElementById('hsm')?.scrollIntoView({ behavior: 'smooth' }) }}>
      <span className="hsm-pulse" aria-hidden="true" />
      <span><strong>{n(data?.here_now)}</strong> here now</span>
      <span className="hsm-sep">·</span>
      <span><strong>{n(data?.visitors_today)}</strong> {data?.visitors_today === 1 ? 'visitor' : 'visitors'} today</span>
      <span className="hsm-sep">·</span>
      <span><strong>{n(data?.packages_checked)}</strong> packages checked</span>
    </a>
  )
}

export default function SiteMetrics() {
  const data = useSiteSummary()

  // Metrics explicitly unavailable (e.g. no database): nothing to show.
  if (data && !data.available) return null
  const loading = !data

  return (
    <section className="hsm" id="hsm" aria-labelledby="hsm-title" aria-busy={loading}>
      <div className="hsm-inner">
        <div className="hsm-head">
          <span className="hb-kicker">Live · updated every 30s</span>
          <h2 id="hsm-title" className="hsm-title">
            DepShield, <em>in the open.</em>
          </h2>
          <div className="hsm-now" aria-live="polite">
            <span className="hsm-pulse" aria-hidden="true" />
            <strong>{loading ? '–' : <Num value={data.here_now ?? 0} />}</strong> {data?.here_now === 1 ? 'person' : 'people'} here now
          </div>
        </div>

        <dl className="hsm-grid">
          {TILES.map((t, i) => (
            <div key={t.key} className="hsm-tile" style={{ '--i': i } as React.CSSProperties}>
              <dt>{t.label}</dt>
              <dd>{loading ? <span className="hsm-skel" aria-label="Loading" /> : <Num value={Number(data[t.key] ?? 0)} />}</dd>
              <span className="hsm-note">{t.note}</span>
            </div>
          ))}
        </dl>

        <p className="hsm-privacy">
          <Lock size={12} /> Counted anonymously with a random ID in your browser. No cookies, IP addresses or accounts.
          {!trackingAllowed() && ' Your browser asks not to be tracked, so your visit isn’t counted.'}
        </p>
      </div>
    </section>
  )
}
