import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { fetchSiteSummary, trackingAllowed, type SiteSummary } from '../siteMetrics'
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

export default function SiteMetrics() {
  const [data, setData] = useState<SiteSummary | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => fetchSiteSummary().then((d) => alive && setData(d))
    void load()
    const t = window.setInterval(() => document.visibilityState === 'visible' && void load(), 30_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])

  if (!data?.available) return null

  return (
    <section className="hsm" aria-labelledby="hsm-title">
      <div className="hsm-inner">
        <div className="hsm-head">
          <span className="hb-kicker">Live · updated every 30s</span>
          <h2 id="hsm-title" className="hsm-title">
            DepShield, <em>in the open.</em>
          </h2>
          <div className="hsm-now" aria-live="polite">
            <span className="hsm-pulse" aria-hidden="true" />
            <strong><Num value={data.here_now ?? 0} /></strong> {data.here_now === 1 ? 'person' : 'people'} here now
          </div>
        </div>

        <dl className="hsm-grid">
          {TILES.map((t, i) => (
            <div key={t.key} className="hsm-tile" style={{ '--i': i } as React.CSSProperties}>
              <dt>{t.label}</dt>
              <dd>
                <Num value={Number(data[t.key] ?? 0)} />
              </dd>
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
