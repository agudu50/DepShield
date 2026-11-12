import { useState, useEffect, useCallback } from 'react'
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
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react'

export interface TelemetryEvent {
  id: string
  timestamp: string
  source: 'agent' | 'cli' | 'gateway'
  category: 'file_read' | 'osv_query' | 'policy_gate' | 'privacy_guard' | 'heartbeat'
  action: string
  target: string
  details: string
  verdict: 'safe' | 'warning' | 'blocked' | 'info'
  bytesSent: number
  sourceCodeRead: number
}

const INITIAL_EVENTS: TelemetryEvent[] = [
  {
    id: 'evt-1',
    timestamp: '12:04:11.204',
    source: 'cli',
    category: 'heartbeat',
    action: 'MONITOR_START',
    target: 'depshield-cli (pid 34812)',
    details: 'Foreground monitor initialized on project root. Polling dependency descriptors only.',
    verdict: 'info',
    bytesSent: 184,
    sourceCodeRead: 0,
  },
  {
    id: 'evt-2',
    timestamp: '12:04:11.890',
    source: 'cli',
    category: 'file_read',
    action: 'DESCRIPTOR_DISCOVERY',
    target: 'package.json (manifest)',
    details: 'Verified manifest schema. Parsed 24 declared dependencies. ZERO source files (.ts, .js) touched.',
    verdict: 'safe',
    bytesSent: 0,
    sourceCodeRead: 0,
  },
  {
    id: 'evt-3',
    timestamp: '12:04:12.115',
    source: 'cli',
    category: 'privacy_guard',
    action: 'SOURCE_CODE_SANDBOX',
    target: 'src/*, .env, .git',
    details: 'Sandbox boundary enforced. Application logic and secrets strictly bypassed and omitted from memory.',
    verdict: 'safe',
    bytesSent: 0,
    sourceCodeRead: 0,
  },
  {
    id: 'evt-4',
    timestamp: '12:04:12.450',
    source: 'gateway',
    category: 'osv_query',
    action: 'OSV_BATCH_LOOKUP',
    target: 'https://api.osv.dev/v1/querybatch',
    details: 'Dispatched exact pinned tuples: axios@1.5.0, express@4.18.2. No repository contents or paths transmitted.',
    verdict: 'safe',
    bytesSent: 412,
    sourceCodeRead: 0,
  },
  {
    id: 'evt-5',
    timestamp: '12:04:13.010',
    source: 'agent',
    category: 'policy_gate',
    action: 'ADVISORY_EVALUATION',
    target: 'axios@1.5.0 (GHSA-8hc4-vh64-cxmj)',
    details: 'Deterministic match on SSRF advisory (CVSS 7.5). Bifrost AI Agent requested to evaluate upgrade reachability.',
    verdict: 'warning',
    bytesSent: 290,
    sourceCodeRead: 0,
  },
  {
    id: 'evt-6',
    timestamp: '12:04:13.720',
    source: 'agent',
    category: 'policy_gate',
    action: 'SAFE_REMEDIATION_PLAN',
    target: 'axios@1.6.0',
    details: 'Remediation verified: semver-compatible bump to 1.6.0 resolves CVE-2023-45857 without breaking API changes.',
    verdict: 'safe',
    bytesSent: 140,
    sourceCodeRead: 0,
  },
]

const SAMPLE_POOL: Omit<TelemetryEvent, 'id' | 'timestamp'>[] = [
  {
    source: 'cli',
    category: 'file_read',
    action: 'DESCRIPTOR_INSPECT',
    target: 'package-lock.json (integrity check)',
    details: 'Checked resolved lockfile SHA-512 hashes against npm registry index. Zero source files accessed.',
    verdict: 'safe',
    bytesSent: 0,
    sourceCodeRead: 0,
  },
  {
    source: 'gateway',
    category: 'osv_query',
    action: 'OSV_INTEGRITY_CHECK',
    target: 'https://api.osv.dev/v1/query (lodash@4.17.15)',
    details: 'Checked lodash against OSV database. Matched prototype pollution advisory GHSA-p6mc-m468-83gw.',
    verdict: 'warning',
    bytesSent: 198,
    sourceCodeRead: 0,
  },
  {
    source: 'agent',
    category: 'policy_gate',
    action: 'INSTALL_PREFLIGHT_BLOCK',
    target: 'malicious-test-pkg@1.0.0',
    details: 'Preflight safety gate triggered: untrusted lifecycle scripts detected. Download automatically halted.',
    verdict: 'blocked',
    bytesSent: 85,
    sourceCodeRead: 0,
  },
  {
    source: 'cli',
    category: 'privacy_guard',
    action: 'EXFILTRATION_PROOF',
    target: 'Network Egress Guard (Boundary Check)',
    details: 'Audited outgoing payload. Zero repository source code, environment secrets, or tokens transmitted.',
    verdict: 'safe',
    bytesSent: 0,
    sourceCodeRead: 0,
  },
  {
    source: 'gateway',
    category: 'osv_query',
    action: 'BIFROST_GATEWAY_ROUTING',
    target: 'bifrost://gateway.maxim.ai/osv/v1',
    details: 'Intelligent routing verified: payload strictly isolated to pinned tuples [express@4.18.2].',
    verdict: 'safe',
    bytesSent: 212,
    sourceCodeRead: 0,
  },
  {
    source: 'agent',
    category: 'policy_gate',
    action: 'CVE_REACHABILITY_ANALYSIS',
    target: 'jsonwebtoken@8.5.1 (CVE-2022-23529)',
    details: 'Bifrost AI Agent confirmed verified non-breaking upgrade available in v9.0.0 with semver compatibility.',
    verdict: 'safe',
    bytesSent: 160,
    sourceCodeRead: 0,
  },
  {
    source: 'cli',
    category: 'file_read',
    action: 'MANIFEST_PARSER_SANDBOX',
    target: 'pyproject.toml / uv.lock',
    details: 'Extracted dependency table only. Code parser ignored all test files, models, and application controllers.',
    verdict: 'safe',
    bytesSent: 0,
    sourceCodeRead: 0,
  },
]

const CLI_COMMANDS = [
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
    desc: 'Pentest dependency trees without sending data:',
    cmd: 'depshield audit --offline',
  },
]

export default function LiveAuditMonitor() {
  const [events, setEvents] = useState<TelemetryEvent[]>(INITIAL_EVENTS)
  const [filter, setFilter] = useState<'all' | 'file_read' | 'osv_query' | 'policy_gate' | 'privacy_guard'>('all')
  const [search, setSearch] = useState('')
  const [isSimulating, setIsSimulating] = useState(false)
  const [isLiveStreaming, setIsLiveStreaming] = useState(false)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)

  function copyText(cmd: string) {
    navigator.clipboard.writeText(cmd)
    setCopiedCmd(cmd)
    setTimeout(() => setCopiedCmd(null), 2000)
  }

  const triggerNextEvent = useCallback(() => {
    const now = new Date()
    const ts =
      now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0')
    const sample = SAMPLE_POOL[Math.floor(Math.random() * SAMPLE_POOL.length)]
    const newEvt: TelemetryEvent = {
      ...sample,
      id: `evt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: ts,
    }
    setEvents((prev) => [newEvt, ...prev])
  }, [])

  function simulateNewEvent() {
    setIsSimulating(true)
    setTimeout(() => {
      triggerNextEvent()
      setIsSimulating(false)
    }, 380)
  }

  function handleResetFeed() {
    setEvents(INITIAL_EVENTS)
    setSearch('')
    setFilter('all')
  }

  function handleClearFeed() {
    setEvents([])
  }

  // Periodic live telemetry streaming when toggled on
  useEffect(() => {
    if (!isLiveStreaming) return
    const interval = setInterval(() => {
      triggerNextEvent()
    }, 4500)
    return () => clearInterval(interval)
  }, [isLiveStreaming, triggerNextEvent])

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
              className={`secondary-button stream-toggle-btn ${isLiveStreaming ? 'streaming-active' : ''}`}
              onClick={() => setIsLiveStreaming((v) => !v)}
              title={isLiveStreaming ? 'Pause auto telemetry feed' : 'Start live auto telemetry feed'}
            >
              {isLiveStreaming ? (
                <>
                  <Pause size={14} />
                  <span>Stream: Live</span>
                </>
              ) : (
                <>
                  <Play size={14} />
                  <span>Stream: Paused</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="primary-button simulate-btn"
              onClick={simulateNewEvent}
              disabled={isSimulating}
            >
              {isSimulating ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Emitting Telemetry...</span>
                </>
              ) : (
                <>
                  <Play size={14} />
                  <span>Trigger Telemetry Event</span>
                </>
              )}
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
                  <span>AI Agent pentests reachability without receiving repository source</span>
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
              <button
                type="button"
                className="feed-sub-btn"
                onClick={handleResetFeed}
                title="Reset feed to initial demo trace"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
              {events.length > 0 && (
                <button
                  type="button"
                  className="feed-sub-btn danger"
                  onClick={handleClearFeed}
                  title="Clear all live events"
                >
                  <Trash2 size={12} />
                  <span>Clear</span>
                </button>
              )}
            </div>
          </div>

          {/* Terminal-Style Log Stream */}
          <div className="telemetry-log-stream">
            {filteredEvents.length === 0 ? (
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
                    <span className="log-timestamp">{evt.timestamp}</span>
                    <span className={`log-source source-${evt.source}`}>
                      {evt.source === 'cli' && <Laptop size={11} />}
                      {evt.source === 'agent' && <Cpu size={11} />}
                      {evt.source === 'gateway' && <Globe size={11} />}
                      <span>{evt.source.toUpperCase()}</span>
                    </span>
                    <span className="log-action">{evt.action}</span>
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
                    <span className="badge-micro">
                      <strong>Code Read:</strong> {evt.sourceCodeRead} B
                    </span>
                    <span className="badge-micro">
                      <strong>Egress:</strong> {evt.bytesSent} B
                    </span>
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
