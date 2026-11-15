import { useEffect, useRef, type ReactNode } from 'react'
import { Check, FileCode2, Lock, ShieldAlert, ShieldCheck, Terminal, X } from 'lucide-react'

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

interface Feature {
  kicker: string
  title: [string, string]
  body: string
  mock: ReactNode
}

/* ── Product mockups (illustrations; advisory IDs are real OSV records) ── */

function ScanMock() {
  const rows = [
    { pkg: 'express', ver: '4.21.2', state: 'clear' },
    { pkg: 'lodash', ver: '4.17.15', state: 'flag', id: 'CVE-2020-8203' },
    { pkg: 'react', ver: '19.0.0', state: 'clear' },
    { pkg: 'minimist', ver: '1.2.5', state: 'flag', id: 'CVE-2021-44906' },
    { pkg: 'zod', ver: '3.23.8', state: 'clear' },
  ]
  return (
    <div className="hb-mock">
      <div className="hb-mock-bar">
        <FileCode2 size={13} /> package-lock.json <span className="hb-mock-dim">· 5 pinned</span>
      </div>
      <ul className="hb-table">
        {rows.map((r) => (
          <li key={r.pkg} className={r.state === 'flag' ? 'is-flag' : ''}>
            <span className="hb-mono">{r.pkg}</span>
            <span className="hb-mono hb-mock-dim">{r.ver}</span>
            {r.state === 'flag' ? (
              <span className="hb-tag hb-tag-solid">{r.id}</span>
            ) : (
              <span className="hb-tag">clear</span>
            )}
          </li>
        ))}
      </ul>
      <div className="hb-float hb-float-tr" style={{ '--z': '70px' } as React.CSSProperties}>
        <ShieldAlert size={14} /> 2 advisories
      </div>
    </div>
  )
}

function ExplainMock() {
  return (
    <div className="hb-mock">
      <div className="hb-mock-bar">
        <span className="hb-dot" /> Bifrost · anthropic/claude-sonnet-5-5
      </div>
      <div className="hb-bubble hb-bubble-q">Is CVE-2020-8203 reachable in this service?</div>
      <div className="hb-bubble hb-bubble-a">
        <p>
          <strong>CVE-2020-8203</strong> is prototype pollution in lodash’s <code>zipObjectDeep</code>, and 4.17.15 is
          in the affected range. The evidence doesn’t show whether your code calls it; 4.17.21 is outside that range.
        </p>
        <span className="hb-cite">Cited: OSV.dev · GHSA-p6mc-m468-83gw</span>
      </div>
      <div className="hb-float hb-float-bl" style={{ '--z': '60px' } as React.CSSProperties}>
        <Check size={13} /> Grounded in 1 advisory
      </div>
    </div>
  )
}

function GateMock() {
  return (
    <div className="hb-mock hb-mock-term">
      <div className="hb-mock-bar">
        <Terminal size={13} /> zsh — my-app
      </div>
      <pre className="hb-term">
        <span className="hb-term-cmd">$ depshield add lodash@4.17.15</span>
        {'\n'}  checking OSV.dev … 1 match
        {'\n'}<span className="hb-term-block">✕ BLOCKED</span>  CVE-2020-8203 (prototype pollution)
        {'\n'}  no files written · lifecycle scripts disabled
        {'\n\n'}<span className="hb-term-cmd">$ depshield add lodash@4.17.21</span>
        {'\n'}<span className="hb-term-ok">✓ installed</span>  no known advisories
      </pre>
      <div className="hb-float hb-float-tr" style={{ '--z': '80px' } as React.CSSProperties}>
        <ShieldCheck size={14} /> Pre-install gate
      </div>
    </div>
  )
}

function PrivacyMock() {
  const files = [
    { f: 'package.json', read: true },
    { f: 'uv.lock', read: true },
    { f: 'src/billing/charge.ts', read: false },
    { f: 'app/main.py', read: false },
    { f: '.env', read: false },
  ]
  return (
    <div className="hb-mock">
      <div className="hb-mock-bar">
        <Lock size={13} /> Read log · last audit
      </div>
      <ul className="hb-files">
        {files.map(({ f, read }) => (
          <li key={f} className={read ? '' : 'is-blocked'}>
            {read ? <Check size={13} /> : <X size={13} />}
            <span className="hb-mono">{f}</span>
            <span className="hb-mock-dim">{read ? 'read' : 'never opened'}</span>
          </li>
        ))}
      </ul>
      <div className="hb-float hb-float-bl hb-float-big" style={{ '--z': '90px' } as React.CSSProperties}>
        <span className="hb-serif">0</span>
        <span>bytes of source sent</span>
      </div>
    </div>
  )
}

const FEATURES: Feature[] = [
  {
    kicker: 'Detect',
    title: ['Find what’s', 'actually vulnerable.'],
    body: 'Every exact pinned version in your manifests is checked against OSV.dev. No guesses, no heuristics, just matching advisories.',
    mock: <ScanMock />,
  },
  {
    kicker: 'Explain',
    title: ['Explain it like', 'a teammate would.'],
    body: 'Bifrost routes verified evidence to the model you choose, and the answer cites the advisory it came from. When the evidence is silent, it says so.',
    mock: <ExplainMock />,
  },
  {
    kicker: 'Prevent',
    title: ['Stop it before', 'it reaches disk.'],
    body: 'The CLI checks a package before install and refuses known-vulnerable versions, with lifecycle scripts disabled.',
    mock: <GateMock />,
  },
  {
    kicker: 'Prove',
    title: ['Prove nothing', 'ever left.'],
    body: 'DepShield reads manifests and lockfiles only. Every file it touches is logged, so you can audit the auditor.',
    mock: <PrivacyMock />,
  },
]

/**
 * Alternating feature rows. Each mockup sits on a tilted 3D plane that flattens as
 * it scrolls into view (--p: 0 → 1) and tilts toward the pointer (--rx / --ry).
 */
export default function FeatureStory() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const scenes = Array.from(root.querySelectorAll<HTMLElement>('.hb-scene'))
    if (reducedMotion()) {
      scenes.forEach((s) => s.style.setProperty('--p', '1'))
      return
    }

    let frame = 0
    function update() {
      frame = 0
      const vh = window.innerHeight
      for (const s of scenes) {
        const r = s.getBoundingClientRect()
        // 0 when the scene's top enters the viewport bottom, 1 by the time it's ~40% up.
        const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.6)))
        s.style.setProperty('--p', p.toFixed(3))
      }
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }

    function onMove(e: PointerEvent) {
      const s = e.currentTarget as HTMLElement
      const r = s.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width - 0.5
      const py = (e.clientY - r.top) / r.height - 0.5
      s.style.setProperty('--ry', `${(px * 12).toFixed(2)}deg`)
      s.style.setProperty('--rx', `${(py * -10).toFixed(2)}deg`)
    }
    function onLeave(e: PointerEvent) {
      const s = e.currentTarget as HTMLElement
      s.style.setProperty('--ry', '0deg')
      s.style.setProperty('--rx', '0deg')
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    scenes.forEach((s) => {
      s.addEventListener('pointermove', onMove)
      s.addEventListener('pointerleave', onLeave)
    })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      scenes.forEach((s) => {
        s.removeEventListener('pointermove', onMove)
        s.removeEventListener('pointerleave', onLeave)
      })
    }
  }, [])

  return (
    <div ref={rootRef} className="hb-features">
      {FEATURES.map((f, i) => (
        <article key={f.kicker} className={`hb-feature ${i % 2 ? 'is-flipped' : ''}`}>
          <div className="hb-feature-copy">
            <span className="hb-kicker">
              <span className="hb-kicker-n">{String(i + 1).padStart(2, '0')}</span> {f.kicker}
            </span>
            <h3 className="hb-feature-title">
              {f.title[0]}
              <br />
              <em>{f.title[1]}</em>
            </h3>
            <p className="hb-feature-body">{f.body}</p>
          </div>
          <div className="hb-scene" style={{ '--side': i % 2 ? -1 : 1 } as React.CSSProperties}>
            <div className="hb-plane">
              {f.mock}
              <span className="hb-plane-shadow" aria-hidden="true" />
            </div>
            <span className="hb-illustration">Illustration</span>
          </div>
        </article>
      ))}
    </div>
  )
}
