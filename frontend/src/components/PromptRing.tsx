import { useEffect, useRef } from 'react'

const PROMPTS = [
  { task: 'Audit payments-api for advisories an attacker could actually reach.', sources: ['GitHub', 'OSV.dev', 'Bifrost'] },
  { task: 'Block any install that matches a known advisory.', sources: ['CLI', 'npm', 'OSV.dev'] },
  { task: 'Explain this advisory to my team in plain English.', sources: ['OSV.dev', 'Bifrost'] },
  { task: 'Which packages in uv.lock need an upgrade today?', sources: ['PyPI', 'OSV.dev'] },
  { task: 'Pin every floating range in package.json.', sources: ['npm', 'GitHub'] },
  { task: 'Show exactly which files the agent read last run.', sources: ['Telemetry'] },
  { task: 'Re-check every repo after the next lockfile change.', sources: ['CLI', 'GitHub'] },
  { task: 'Summarize risk across all services for the release review.', sources: ['GitHub', 'Bifrost'] },
]

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * A 3D carousel of example tasks. Driven by one rAF loop that writes transforms
 * straight to the DOM (no React re-renders). Auto-rotates, pauses on hover,
 * drags with inertia, and responds to ←/→ when focused.
 */
export default function PromptRing() {
  const stageRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const stage = stageRef.current
    const ring = ringRef.current
    if (!stage || !ring) return
    if (reducedMotion()) {
      stage.classList.add('is-static')
      return
    }

    const n = PROMPTS.length
    const step = 360 / n
    let angle = 0
    let velocity = 0 // deg per frame from drag
    let tiltX = -8
    let tiltTarget = -8
    let hovering = false
    let dragging = false
    let lastX = 0
    let radius = 0
    let frame = 0
    let last = performance.now()
    let snapTo: number | null = null

    function measure() {
      const w = cardRefs.current[0]?.offsetWidth ?? 280
      radius = Math.round(w / 2 / Math.tan(Math.PI / n) + 28)
      stage!.style.setProperty('--ring-radius', `${radius}px`)
    }

    function render(now: number) {
      const dt = Math.min(48, now - last) / 16.667
      last = now
      if (!dragging) {
        if (snapTo !== null) {
          const diff = snapTo - angle
          angle += diff * 0.12 * dt
          if (Math.abs(diff) < 0.05) snapTo = null
        } else if (Math.abs(velocity) > 0.02) {
          angle += velocity * dt
          velocity *= Math.pow(0.94, dt)
        } else if (!hovering) {
          angle -= 0.09 * dt
        }
      }
      tiltX += (tiltTarget - tiltX) * 0.08 * dt
      ring!.style.transform = `translateZ(${-radius}px) rotateX(${tiltX}deg) rotateY(${angle}deg)`

      for (let i = 0; i < n; i++) {
        const card = cardRefs.current[i]
        if (!card) continue
        const a = ((angle + i * step) % 360 + 360) % 360
        const facing = Math.cos((a * Math.PI) / 180) // 1 = facing viewer
        const vis = Math.max(0, facing)
        card.style.opacity = String(0.08 + vis * 0.92)
        card.dataset.front = facing > 0.94 ? 'true' : 'false'
      }
      frame = requestAnimationFrame(render)
    }

    function onEnter() { hovering = true }
    function onLeave() { hovering = false; tiltTarget = -8 }
    function onMove(e: PointerEvent) {
      const rect = stage!.getBoundingClientRect()
      const y = (e.clientY - rect.top) / rect.height - 0.5
      tiltTarget = -8 + y * -10
      if (dragging) {
        const dx = e.clientX - lastX
        lastX = e.clientX
        angle += dx * 0.25
        velocity = dx * 0.25
      }
    }
    function onDown(e: PointerEvent) {
      dragging = true
      snapTo = null
      lastX = e.clientX
      velocity = 0
      stage!.setPointerCapture(e.pointerId)
      stage!.classList.add('is-dragging')
    }
    function onUp(e: PointerEvent) {
      dragging = false
      stage!.classList.remove('is-dragging')
      if (stage!.hasPointerCapture(e.pointerId)) stage!.releasePointerCapture(e.pointerId)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const base = Math.round(angle / step) * step
      snapTo = base + (e.key === 'ArrowLeft' ? step : -step)
      velocity = 0
    }

    measure()
    window.addEventListener('resize', measure)
    stage.addEventListener('pointerenter', onEnter)
    stage.addEventListener('pointerleave', onLeave)
    stage.addEventListener('pointermove', onMove)
    stage.addEventListener('pointerdown', onDown)
    stage.addEventListener('pointerup', onUp)
    stage.addEventListener('pointercancel', onUp)
    stage.addEventListener('keydown', onKey)
    frame = requestAnimationFrame(render)

    // Pause the loop entirely while the ring is off-screen.
    const io = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame)
      if (entry.isIntersecting) {
        last = performance.now()
        frame = requestAnimationFrame(render)
      }
    })
    io.observe(stage)

    return () => {
      cancelAnimationFrame(frame)
      io.disconnect()
      window.removeEventListener('resize', measure)
      stage.removeEventListener('pointerenter', onEnter)
      stage.removeEventListener('pointerleave', onLeave)
      stage.removeEventListener('pointermove', onMove)
      stage.removeEventListener('pointerdown', onDown)
      stage.removeEventListener('pointerup', onUp)
      stage.removeEventListener('pointercancel', onUp)
      stage.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div
      ref={stageRef}
      className="hb-ring-stage"
      role="region"
      aria-roledescription="carousel"
      aria-label="Example tasks for the DepShield agent. Drag or use the arrow keys to rotate."
      tabIndex={0}
    >
      <div ref={ringRef} className="hb-ring">
        {PROMPTS.map((p, i) => (
          <div
            key={p.task}
            ref={(el) => { cardRefs.current[i] = el }}
            className="hb-ring-card"
            style={{ '--i': i, '--n': PROMPTS.length } as React.CSSProperties}
          >
            <span className="hb-ring-kicker">Task {String(i + 1).padStart(2, '0')}</span>
            <p className="hb-ring-task">{p.task}</p>
            <div className="hb-ring-sources">
              {p.sources.map((s) => (
                <span key={s} className="hb-chip">{s}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <span className="hb-ring-floor" aria-hidden="true" />
    </div>
  )
}
