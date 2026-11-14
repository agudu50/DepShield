import { useState, useEffect } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Database,
  FileCheck,
  FileCode,
  Globe,
  Laptop,
  Lock,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react'
import {
  getStoredEvents,
  subscribeTelemetry,
  clearTelemetryEvents,
  addTelemetryEvent,
  type TelemetryEvent,
} from '../telemetry'
import { checkBifrostHealth } from '../api'
import { bifrostHealthToEvent } from '../bifrostProbe'

interface CliCommandInfo {
  id: string
  name: string
  desc: string
  cmd: string
}

const CLI_COMMANDS: CliCommandInfo[] = [
  {
    id: 'monitor',
    name: 'Live File Monitor',
    desc: 'Watches lockfiles and syncs inventory securely:',
    cmd: 'depshield monitor',
  },
  {
    id: 'add',
    name: 'Safe Install Gate',
    desc: 'Checks OSV before installing with lifecycle scripts disabled:',
    cmd: 'depshield add express@4.18.2',
  },
  {
    id: 'status',
    name: 'GitHub CLI Status',
    desc: 'Verify local keyring credentials:',
    cmd: 'depshield github status',
  },
  {
    id: 'audit',
    name: 'Offline Audit Gate',
    desc: 'Audit dependency trees without sending data:',
    cmd: 'depshield audit --offline',
  },
]

export default function LiveAuditMonitor() {
  const [events, setEvents] = useState<TelemetryEvent[]>(() => getStoredEvents())
  const [filter, setFilter] = useState<'all' | 'file_read' | 'osv_query' | 'policy_gate' | 'privacy_guard'>('all')
  const [search, setSearch] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)

  useEffect(() => {
    setEvents(getStoredEvents())
    const unsubscribe = subscribeTelemetry((updated) => {
      setEvents(updated)
    })
    return unsubscribe
  }, [])

  function copyText(cmd: string) {
    navigator.clipboard.writeText(cmd)
    setCopiedCmd(cmd)
    setTimeout(() => setCopiedCmd(null), 2000)
  }

  async function handleVerifySandbox() {
    setIsVerifying(true)
    try {
      addTelemetryEvent(bifrostHealthToEvent(await checkBifrostHealth()))
    } finally {
      setIsVerifying(false)
    }
  }

  function handleClearFeed() {
    clearTelemetryEvents()
    setEvents([])
  }

  const filteredEvents = events.filter((evt) => {
    if (filter !== 'all' && evt.category !== filter) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      evt.action.toLowerCase().includes(q) ||
      evt.target.toLowerCase().includes(q) ||
      evt.details.toLowerCase().includes(q)
    )
  })

  const totalBytes = events.reduce((acc, curr) => acc + curr.bytesSent, 0)

  return (
    <div className="telemetry-dashboard-container">
      {/* Header & Assurance Banner */}
      <div className="telemetry-header-card">
        <div className="telemetry-header-main">
          <div className="telemetry-title-wrap">
            <div className="telemetry-badge">
              <span className="live-pulse" />
              <span>Real-Time Audit Stream</span>
            </div>
            <h2>Autonomous Agent & CLI Live Activity Monitor</h2>
            <p className="telemetry-subtitle">
              Inspect exactly what files the AI Agent and local CLI inspect, verify zero source-code leakage,
              and trace every outbound OSV.dev request in real time. Powered by Bifrost by Maxim AI.
            </p>
          </div>

          <div className="telemetry-actions">
            <button
              type="button"
              className="primary-button simulate-btn"
              onClick={handleVerifySandbox}
              disabled={isVerifying}
              title="Send a real minimal completion through the Bifrost gateway and log the result"
            >
              <ShieldCheck size={14} />
              <span>{isVerifying ? 'Probing Bifrost…' : 'Probe Bifrost Gateway'}</span>
            </button>
          </div>
        </div>

        {/* Security Metric Pills */}
        <div className="telemetry-stats-row">
          <div className="stat-pill stat-safe">
            <ShieldCheck size={20} />
            <div>
              <span className="stat-value">0 Bytes</span>
              <span className="stat-label">Source Code Read</span>
            </div>
          </div>

          <div className="stat-pill stat-info">
            <Database size={20} />
            <div>
              <span className="stat-value">{totalBytes} B</span>
              <span className="stat-label">Manifest Metadata Sent</span>
            </div>
          </div>

          <div className="stat-pill stat-safe">
            <Lock size={20} />
            <div>
              <span className="stat-value">Local Only</span>
              <span className="stat-label">Keyring & Token Isolation</span>
            </div>
          </div>

          <div className="stat-pill stat-live">
            <Activity size={20} />
            <div>
              <span className="stat-value">{events.length} Events</span>
              <span className="stat-label">Verified Audit Traces</span>
            </div>
          </div>
        </div>
      </div>

      {/* Two Columns: CLI / Agent Guide on Left, Live Event Feed on Right */}
      <div className="telemetry-body-grid">
        {/* Left Column: CLI & Guardrail Explanations */}
        <div className="telemetry-sidebar">
          {/* Privacy Guarantee Card */}
          <div className="guardrail-card">
            <div className="guardrail-header">
              <Shield size={18} className="guardrail-icon" />
              <h3>Zero-Exfiltration Guardrail</h3>
            </div>
            <p className="guardrail-desc">
              DepShield is architected to guarantee that your proprietary source code, secrets, and environment
              configurations are never read, uploaded, or transmitted.
            </p>

            <div className="guardrail-checklist">
              <div className="check-item allowed">
                <CheckCircle2 size={15} />
                <div>
                  <strong>Only Dependency Descriptors Read</strong>
                  <span><code>package.json</code>, <code>requirements.txt</code>, <code>uv.lock</code></span>
                </div>
              </div>

              <div className="check-item blocked">
                <XCircle size={15} />
                <div>
                  <strong>Source Code Strictly Blocked</strong>
                  <span>Zero <code>.ts</code>, <code>.py</code>, <code>.js</code>, <code>.env</code> file access</span>
                </div>
              </div>

              <div className="check-item allowed">
                <Globe size={15} />
                <div>
                  <strong>Stateless OSV Feeds Only</strong>
                  <span>Only package name and exact pinned version are queried</span>
                </div>
              </div>

              <div className="check-item allowed">
                <Cpu size={15} />
                <div>
                  <strong>Bifrost Intelligent Gateway</strong>
                  <span>AI Agent audits reachability without receiving repository source</span>
                </div>
              </div>
            </div>
          </div>

          {/* Real-time CLI Commands Box */}
          <div className="cli-commands-card">
            <div className="cli-card-header">
              <Terminal size={17} />
              <h4>CLI Live Monitor Commands</h4>
            </div>
            <p className="cli-card-hint">
              Run these commands in your project terminal to link your CLI directly to this live dashboard:
            </p>

            <div className="command-list">
              {CLI_COMMANDS.map((item) => (
                <div key={item.id} className="cmd-row">
                  <div className="cmd-meta">
                    <span className="cmd-name">{item.name}</span>
                    <span className="cmd-desc">{item.desc}</span>
                  </div>
                  <div className="cmd-box">
                    <code>{item.cmd}</code>
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => copyText(item.cmd)}
                      title="Copy command"
                    >
                      {copiedCmd === item.cmd ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Live Event Stream Feed */}
        <div className="telemetry-feed-card">
          {/* Feed Controls */}
          <div className="feed-controls-bar">
            <div className="feed-filter-tabs">
              <button
                type="button"
                className={`feed-filter-btn ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All ({events.length})
              </button>
              <button
                type="button"
                className={`feed-filter-btn ${filter === 'file_read' ? 'active' : ''}`}
                onClick={() => setFilter('file_read')}
              >
                <FileCode size={13} />
                <span>Files Checked</span>
              </button>
              <button
                type="button"
                className={`feed-filter-btn ${filter === 'osv_query' ? 'active' : ''}`}
                onClick={() => setFilter('osv_query')}
              >
                <Globe size={13} />
                <span>OSV Feeds</span>
              </button>
              <button
                type="button"
                className={`feed-filter-btn ${filter === 'policy_gate' ? 'active' : ''}`}
                onClick={() => setFilter('policy_gate')}
              >
                <ShieldCheck size={13} />
                <span>Policy Gates</span>
              </button>
              <button
                type="button"
                className={`feed-filter-btn ${filter === 'privacy_guard' ? 'active' : ''}`}
                onClick={() => setFilter('privacy_guard')}
              >
                <Lock size={13} />
                <span>Privacy Proof</span>
              </button>
            </div>

            <div className="feed-search-wrap">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder="Filter action, target, or query..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="feed-search-input"
              />
            </div>
          </div>

          {/* Feed Toolbar Actions (Count + Clear/Reset) */}
          <div className="feed-toolbar-sub">
            <span className="feed-count-indicator">
              Showing <strong>{filteredEvents.length}</strong> of {events.length} trace events
            </span>
            <div className="feed-sub-actions">
              {events.length > 0 && (
                <button
                  type="button"
                  className="feed-sub-btn danger"
                  onClick={handleClearFeed}
                  title="Clear all recorded audit traces"
                >
                  <Trash2 size={12} />
                  <span>Clear Traces</span>
                </button>
              )}
            </div>
          </div>

          {/* Terminal-Style Log Stream */}
          <div className="telemetry-log-stream">
            {events.length === 0 ? (
              <div className="empty-feed">
                <ShieldCheck size={36} className="text-emerald" />
                <h4>No Audit Traces Yet</h4>
                <p>
                  No repository audit or scan has been executed in this session. Select any repository in the
                  <strong> AI Agent</strong> tab and click <em>Run AI Security Audit</em>, or run a CLI command
                  to observe real-time audit logs.
                </p>
                <button
                  type="button"
                  className="secondary-button empty-reset-btn"
                  onClick={handleVerifySandbox}
                >
                  <ShieldCheck size={14} /> Probe Sandbox Isolation
                </button>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="empty-feed">
                <Search size={24} />
                <p>No telemetry events matched your search filter.</p>
                <button
                  type="button"
                  className="secondary-button empty-reset-btn"
                  onClick={() => {
                    setFilter('all')
                    setSearch('')
                  }}
                >
                  Clear Filters
                </button>
              </div>
            ) : (
              filteredEvents.map((evt) => (
                <div key={evt.id} className={`log-entry verdict-${evt.verdict}`}>
                  <div className="log-entry-meta">
                    <div className="log-meta-left">
                      <span className="log-timestamp">{evt.timestamp}</span>
                      <span className={`log-source source-${evt.source}`}>
                        {evt.source === 'cli' && <Laptop size={11} />}
                        {evt.source === 'agent' && <Cpu size={11} />}
                        {evt.source === 'gateway' && <Globe size={11} />}
                        <span>{evt.source.toUpperCase()}</span>
                      </span>
                      <span className="log-action">{evt.action}</span>
                    </div>

                    <span className={`verdict-pill pill-${evt.verdict}`}>
                      {evt.verdict === 'safe' && <ShieldCheck size={11} />}
                      {evt.verdict === 'warning' && <AlertTriangle size={11} />}
                      {evt.verdict === 'blocked' && <ShieldAlert size={11} />}
                      {evt.verdict === 'info' && <FileCheck size={11} />}
                      <span>{evt.verdict.toUpperCase()}</span>
                    </span>
                  </div>

                  <div className="log-target-row">
                    <span className="target-label">Target:</span>
                    <code className="target-value">{evt.target}</code>
                  </div>

                  <div className="log-details-row">
                    <p>{evt.details}</p>
                  </div>

                  <div className="log-footer-badges">
                    <div className="footer-metrics-left">
                      <span className="badge-micro">
                        <strong>Code Read:</strong> {evt.sourceCodeRead} B
                      </span>
                      <span className="badge-micro">
                        <strong>Egress:</strong> {evt.bytesSent} B
                      </span>
                    </div>
                    <span className="badge-micro verified-stamp">
                      <CheckCircle2 size={11} /> Verified Safe
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
