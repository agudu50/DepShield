import { useEffect, useId, useRef } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react'

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=DepShield%20AI%20Agent'

interface ConnectModalProps {
  open: boolean
  onClose: () => void
  token: string
  onTokenChange: (value: string) => void
  showToken: boolean
  onToggleShow: () => void
  loading: boolean
  error: string
  onSubmit: (e: React.FormEvent) => void
  onSkipToWorkspace?: () => void
}

/** GitHub token dialog: Esc / backdrop closes, focus is trapped inside and restored on close. */
export default function ConnectModal({
  open,
  onClose,
  token,
  onTokenChange,
  showToken,
  onToggleShow,
  loading,
  error,
  onSubmit,
  onSkipToWorkspace,
}: ConnectModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const descId = useId()
  // Latest values without re-running the open/close effect on every parent render.
  const latest = useRef({ onClose, loading })
  latest.current = { onClose, loading }

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => inputRef.current?.focus(), 60)

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !latest.current.loading) {
        e.preventDefault()
        latest.current.onClose()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled])',
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null

  const trimmed = token.trim()
  const looksLikeToken = !trimmed || /^(ghp_|github_pat_|gho_|ghu_|ghs_)/.test(trimmed)

  return (
    <div className="ss-modal-backdrop" onMouseDown={() => !loading && onClose()} role="presentation">
      <div
        ref={dialogRef}
        className="ss-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ss-modal-glow" aria-hidden="true" />
        <button type="button" className="ss-modal-close" onClick={onClose} aria-label="Close" disabled={loading}>
          <X size={16} />
        </button>

        <div className="ss-modal-icon" aria-hidden="true">
          <span className="ss-modal-ring" />
          <Github size={26} />
        </div>
        <h2 id={titleId} className="ss-modal-title">Connect GitHub</h2>
        <p id={descId} className="ss-modal-sub">
          Paste a personal access token so DepShield can read the dependency manifests in your repositories.
        </p>

        <ol className="ss-modal-steps">
          <li>
            <span className="ss-modal-step-n">1</span>
            <span>
              <a href={TOKEN_URL} target="_blank" rel="noreferrer">
                Generate a token <ExternalLink size={11} />
              </a>{' '}
              with the <code>repo</code> scope (prefilled).
            </span>
          </li>
          <li>
            <span className="ss-modal-step-n">2</span>
            <span>Paste it below and start the audit.</span>
          </li>
        </ol>

        <form onSubmit={onSubmit} className="ss-modal-form">
          <label className="ss-modal-label" htmlFor={`${titleId}-token`}>
            <KeyRound size={13} /> Personal access token
          </label>
          <div className={`ss-modal-field ${error ? 'has-error' : ''}`}>
            <input
              ref={inputRef}
              id={`${titleId}-token`}
              type={showToken ? 'text' : 'password'}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={token}
              onChange={(e) => onTokenChange(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              required
            />
            <button
              type="button"
              className="ss-modal-eye"
              onClick={onToggleShow}
              aria-label={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {!looksLikeToken && !error && (
            <p className="ss-modal-hint">This doesn’t look like a GitHub token (they usually start with ghp_ or github_pat_).</p>
          )}
          {error && (
            <p className="ss-modal-error" role="alert">
              <AlertTriangle size={14} /> {error}
            </p>
          )}

          <button type="submit" className="ss-modal-submit" disabled={loading || !trimmed}>
            {loading ? (
              <>
                <RefreshCw size={15} className="animate-spin" /> Verifying with GitHub…
              </>
            ) : (
              <>
                <ShieldCheck size={15} /> Start vulnerability audit <ArrowRight size={14} className="ss-modal-arrow" />
              </>
            )}
          </button>
        </form>

        <div className="ss-modal-foot">
          <span>
            <Lock size={12} /> Kept in this browser session. Only manifests are read; source code never is.
          </span>
          {onSkipToWorkspace && (
            <button type="button" className="ss-modal-link" onClick={onSkipToWorkspace}>
              <Database size={12} /> Continue without GitHub
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
