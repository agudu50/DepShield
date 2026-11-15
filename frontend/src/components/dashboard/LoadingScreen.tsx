import { useEffect, useState } from 'react'
import { AlertTriangle, Check, LogOut, RefreshCw, Shield } from 'lucide-react'

interface LoadingScreenProps {
  /** Set when verification failed for a reason other than a bad token (e.g. offline). */
  error: string | null
  onRetry: () => void
  onCancel: () => void
}

const FACES = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const

/** Shown while a saved GitHub token is re-verified. Reports only what is actually happening. */
export default function LoadingScreen({ error, onRetry, onCancel }: LoadingScreenProps) {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (error) return
    setSlow(false)
    const t = window.setTimeout(() => setSlow(true), 8000)
    return () => window.clearTimeout(t)
  }, [error])

  return (
    <div className="app-shell hb-dash hbd-loading">
      <div className="hbd-loading-card" role="status" aria-live="polite">
        <div className={`hbd-cube-stage ${error ? 'is-stopped' : ''}`} aria-hidden="true">
          <div className="hbd-cube">
            {FACES.map((f) => (
              <span key={f} className={`hbd-cube-face hbd-face-${f}`}>
                <Shield size={26} strokeWidth={1.5} />
              </span>
            ))}
          </div>
          <span className="hbd-cube-shadow" />
        </div>

        {error ? (
          <>
            <h1 className="hbd-loading-title">We couldn’t sign you in</h1>
            <p className="hbd-loading-sub">{error}</p>
            <div className="hbd-loading-actions">
              <button type="button" className="hb-btn hb-btn-primary" onClick={onRetry}>
                <RefreshCw size={15} /> Try again
              </button>
              <button type="button" className="hb-btn hb-btn-ghost" onClick={onCancel}>
                <LogOut size={15} /> Use a different token
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="hbd-loading-title">Signing you in</h1>
            <ol className="hbd-steps">
              <li className="is-done">
                <span className="hbd-step-icon"><Check size={12} /></span> Found your saved session
              </li>
              <li className="is-active">
                <span className="hbd-step-icon"><span className="hbd-spinner" /></span> Confirming your token with GitHub
              </li>
              <li>
                <span className="hbd-step-icon" /> Opening your security workspace
              </li>
            </ol>
            <div className="hbd-progress" aria-hidden="true"><span /></div>
            {slow && (
              <div className="hbd-slow">
                <AlertTriangle size={14} />
                <span>This is taking longer than usual.</span>
                <button type="button" className="hbd-link" onClick={onCancel}>
                  Use a different token
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
