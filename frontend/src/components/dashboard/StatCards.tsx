import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'

export interface Stat {
  label: string
  value: number | null
  suffix?: string
  note: string
  tone?: 'alert'
  onClick?: () => void
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Eases from the previous value to the new one whenever it changes. */
function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)

  useEffect(() => {
    if (reduced() || from.current === value) {
      setShown(value)
      from.current = value
      return
    }
    const start = from.current
    const t0 = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 700)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(Math.round(start + (value - start) * eased))
      if (p < 1) frame = requestAnimationFrame(tick)
      else from.current = value
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])

  return (
    <>
      {shown}
      {suffix}
    </>
  )
}

function tilt(e: React.PointerEvent<HTMLElement>) {
  if (reduced()) return
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`)
  el.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -10}deg`)
}
function untilt(e: React.PointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty('--ry', '0deg')
  e.currentTarget.style.setProperty('--rx', '0deg')
}

export default function StatCards({ stats }: { stats: Stat[] }) {
  return (
    <section className="hbd-stats" aria-label="Security overview">
      {stats.map((s, i) => {
        const Tag = s.onClick ? 'button' : 'div'
        return (
          <Tag
            key={s.label}
            type={s.onClick ? 'button' : undefined}
            className={`hbd-stat ${s.tone === 'alert' && s.value ? 'is-alert' : ''} ${s.onClick ? 'is-link' : ''}`}
            onClick={s.onClick}
            onPointerMove={tilt}
            onPointerLeave={untilt}
            style={{ '--i': i } as React.CSSProperties}
          >
            <span className="hbd-stat-label">
              {s.label}
              {s.onClick && <ArrowUpRight size={13} className="hbd-stat-go" />}
            </span>
            <span className="hbd-stat-value">
              {s.value === null ? '—' : <AnimatedNumber value={s.value} suffix={s.suffix} />}
            </span>
            <span className="hbd-stat-note">{s.note}</span>
          </Tag>
        )
      })}
    </section>
  )
}
