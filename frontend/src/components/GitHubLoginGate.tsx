import { useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  KeyRound,
  Lock,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react'
import { getGitHubUser, type GitHubUserProfile } from '../api'

interface GitHubLoginGateProps {
  onLoginSuccess: (token: string, user: GitHubUserProfile) => void
  onSkipToWorkspace?: () => void
}

export default function GitHubLoginGate({ onLoginSuccess, onSkipToWorkspace }: GitHubLoginGateProps) {
  const [tokenInput, setTokenInput] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    const cleanToken = tokenInput.trim()
    if (!cleanToken) {
      setError('Please provide a valid GitHub Personal Access Token.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const user = await getGitHubUser(cleanToken)
      onLoginSuccess(cleanToken, user)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to authenticate with GitHub. Verify your token permissions or ensure the backend is running.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-gate-container">
      {/* Brand Hero */}
      <div className="login-hero">
        <div className="login-brand">
          <div className="brand-mark-lg">
            <Shield size={28} />
          </div>
          <div>
            <span className="eyebrow">Security Intelligence Platform</span>
            <h1>DepShield AI</h1>
          </div>
        </div>

        <h2 className="login-tagline">
          Autonomous Dependency Security & AI Explanations Grounded in OSV.dev
        </h2>
        <p className="login-description">
          Connect your GitHub account to instantly audit repositories, discover dependency manifests,
          detect verified vulnerabilities, and generate evidence-grounded AI remediation paths.
        </p>

        {/* Feature Highlights Grid */}
        <div className="login-features-grid">
          <div className="feature-item">
            <div className="feature-icon">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h4>Deterministic OSV Matching</h4>
              <p>Advisories are matched against exact pinned versions from authoritative OSV.dev feeds.</p>
            </div>
          </div>

          <div className="feature-item">
            <div className="feature-icon">
              <Sparkles size={20} />
            </div>
            <div>
              <h4>Bifrost Security Agent</h4>
              <p>AI models explain verified advisory evidence and blast radius without hallucinating findings.</p>
            </div>
          </div>

          <div className="feature-item">
            <div className="feature-icon">
              <Lock size={20} />
            </div>
            <div>
              <h4>Zero Code Modification</h4>
              <p>Tokens remain stored client-side in your browser. Manifests are read-only.</p>
            </div>
          </div>

          <div className="feature-item">
            <div className="feature-icon">
              <Terminal size={20} />
            </div>
            <div>
              <h4>Developer CLI Integration</h4>
              <p>Preflight package checks and pre-install approval gates for npm and Python uv projects.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Login Card */}
      <div className="login-card-wrap">
        <div className="login-card">
          <div className="login-card-header">
            <div className="gh-icon-bubble">
              <Github size={30} />
            </div>
            <h3>Sign in with GitHub</h3>
            <p>Enter your Personal Access Token to connect your repositories to the AI Security Agent.</p>
          </div>

          {error && (
            <div className="alert-banner alert-error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleConnect} className="login-form">
            <div className="form-group">
              <label htmlFor="gh-token">
                <span>Personal Access Token</span>
                <span className="label-badge">repo scope</span>
              </label>
              <div className="token-field-wrap">
                <KeyRound size={16} className="field-icon" />
                <input
                  id="gh-token"
                  type={showToken ? 'text' : 'password'}
                  placeholder="ghp_... or github_pat_..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="token-field"
                  required
                />
                <button
                  type="button"
                  className="toggle-vis-btn"
                  onClick={() => setShowToken(!showToken)}
                  title={showToken ? 'Hide token' : 'Show token'}
                >
                  {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="primary-button login-submit-btn" disabled={loading || !tokenInput.trim()}>
              {loading ? (
                <>
                  <RefreshCw className="animate-spin" size={18} />
                  <span>Connecting to GitHub...</span>
                </>
              ) : (
                <>
                  <Github size={18} />
                  <span>Connect & Enter Dashboard</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="login-help-section">
            <div className="help-box">
              <span className="help-title">Need a GitHub token?</span>
              <p>Create a token with <code>repo</code> or <code>public_repo</code> read access:</p>
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=DepShield%20AI%20Agent"
                target="_blank"
                rel="noreferrer"
                className="token-link"
              >
                <span>Generate Token on GitHub</span>
                <ExternalLink size={13} />
              </a>
            </div>

            {onSkipToWorkspace && (
              <div className="alternate-auth">
                <span>Or manage organizations directly:</span>
                <button type="button" className="text-button" onClick={onSkipToWorkspace}>
                  Open Neon Workspace Login →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
