import { useEffect, useRef } from 'react'

// Deterministic barcode bar widths (decorative).
const BARS = [3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2]

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * A 3D ID badge on a lanyard. A damped spring drives the swing (rotateZ) and turn
 * (rotateY); hovering tilts it toward the pointer, and you can grab and fling it.
 */
export default function LanyardBadge({ theme }: { theme: 'dark' | 'light' }) {
  const rigRef = useRef<HTMLDivElement>(null)
  const swingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const rig = rigRef.current
    const swing = swingRef.current
    if (!rig || !swing) return
    if (reducedMotion()) return

    // Spring state: z = swing angle, y = turn angle, x = forward tilt (degrees)
    let z = 14, vz = 0
    let y = -24, vy = 0
    let x = 0, vx = 0
    let tz = 0, ty = 0, tx = 0
    let dragging = false
    let startX = 0
    let lastX = 0
    let frame = 0
    let last = performance.now()
    let t = 0

    function step(now: number) {
      const dt = Math.min(48, now - last) / 16.667
      last = now
      t += dt
      // Idle breeze when nobody is interacting.
      const idleZ = dragging ? 0 : Math.sin(t / 55) * 2.2
      const idleY = dragging ? 0 : Math.sin(t / 80) * 9

      if (!dragging) {
        const k = 0.045, d = 0.9
        vz = (vz + (tz + idleZ - z) * k * dt) * Math.pow(d, dt)
        z += vz * dt
      }
      const ky = 0.05, dy = 0.88
      vy = (vy + (ty + idleY - y) * ky * dt) * Math.pow(dy, dt)
      y += vy * dt
      vx = (vx + (tx - x) * 0.06 * dt) * Math.pow(0.86, dt)
      x += vx * dt

      swing!.style.transform = `rotateZ(${z}deg) rotateY(${y}deg) rotateX(${x}deg)`
      frame = requestAnimationFrame(step)
    }

    function onMove(e: PointerEvent) {
      const rect = rig!.getBoundingClientRect()
      const px = (e.clientX - rect.left) / rect.width - 0.5
      const py = (e.clientY - rect.top) / rect.height - 0.5
      if (dragging) {
        const dx = e.clientX - lastX
        lastX = e.clientX
        z = Math.max(-38, Math.min(38, ((e.clientX - startX) / rect.width) * -70))
        vz = dx * -0.35
        ty = px * 50
      } else {
        ty = px * 46
        tx = py * -14
      }
    }
    function onLeave() {
      if (!dragging) { ty = 0; tx = 0 }
    }
    function onDown(e: PointerEvent) {
      dragging = true
      startX = lastX = e.clientX
      rig!.setPointerCapture(e.pointerId)
      rig!.classList.add('is-grabbing')
    }
    function onUp(e: PointerEvent) {
      if (!dragging) return
      dragging = false
      tx = 0
      ty = 0
      rig!.classList.remove('is-grabbing')
      if (rig!.hasPointerCapture(e.pointerId)) rig!.releasePointerCapture(e.pointerId)
    }

    rig.addEventListener('pointermove', onMove)
    rig.addEventListener('pointerleave', onLeave)
    rig.addEventListener('pointerdown', onDown)
    rig.addEventListener('pointerup', onUp)
    rig.addEventListener('pointercancel', onUp)

    const io = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame)
      if (entry.isIntersecting) {
        last = performance.now()
        frame = requestAnimationFrame(step)
      }
    })
    io.observe(rig)

    return () => {
      cancelAnimationFrame(frame)
      io.disconnect()
      rig.removeEventListener('pointermove', onMove)
      rig.removeEventListener('pointerleave', onLeave)
      rig.removeEventListener('pointerdown', onDown)
      rig.removeEventListener('pointerup', onUp)
      rig.removeEventListener('pointercancel', onUp)
    }
  }, [])

  return (
    <div ref={rigRef} className="hb-lanyard" aria-hidden="true">
      <div ref={swingRef} className="hb-lanyard-swing">
        <span className="hb-strap hb-strap-l" />
        <span className="hb-strap hb-strap-r" />
        <span className="hb-clip" />
        <div className="hb-badge">
          <div className="hb-badge-face">
            <span className="hb-badge-slot" />
            <img
              // The badge face is inverted (light card on a dark page and vice versa).
              src={theme === 'light' ? '/depshield-logo-dark.png' : '/depshield-logo-light.png'}
              alt=""
              className="hb-badge-logo"
              draggable={false}
            />
            <span className="hb-badge-kicker">Agent</span>
            <span className="hb-badge-name">DepShield</span>
            <span className="hb-badge-role">Supply-chain security</span>
            <dl className="hb-badge-fields">
              <div><dt>Clearance</dt><dd>Manifests only</dd></div>
              <div><dt>Reasoning</dt><dd>Via Bifrost</dd></div>
              <div><dt>Evidence</dt><dd>OSV.dev</dd></div>
            </dl>
            <svg className="hb-badge-barcode" viewBox={`0 0 ${BARS.reduce((a, b) => a + b + 1, 0)} 20`} preserveAspectRatio="none">
              {BARS.reduce<{ x: number; els: React.ReactElement[] }>(
                (acc, w, i) => {
                  acc.els.push(<rect key={i} x={acc.x} y={0} width={w} height={20} />)
                  acc.x += w + 1
                  return acc
                },
                { x: 0, els: [] },
              ).els}
            </svg>
          </div>
          <div className="hb-badge-back">
            <span>DEPSHIELD</span>
          </div>
        </div>
      </div>
    </div>
  )
}
