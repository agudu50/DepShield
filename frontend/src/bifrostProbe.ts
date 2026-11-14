import type { BifrostHealth } from './api'
import type { TelemetryEvent } from './telemetry'

/** Convert a real Bifrost health round-trip into an audit-feed event. Nothing here is fabricated. */
export function bifrostHealthToEvent(h: BifrostHealth): Omit<TelemetryEvent, 'id' | 'timestamp'> {
  const base = { source: 'gateway' as const, category: 'heartbeat' as const, bytesSent: 0, sourceCodeRead: 0 }
  switch (h.status) {
    case 'live':
      return {
        ...base,
        action: 'BIFROST_PROBE_LIVE',
        target: `Bifrost · ${h.model}`,
        details: `Live completion ${h.gateway_response_id ?? '(no id)'} in ${h.latency_ms}ms, ${h.usage.total_tokens ?? 0} tokens.`,
        verdict: 'safe',
      }
    case 'unreachable':
      return {
        ...base,
        action: 'BIFROST_PROBE_FAILED',
        target: `Bifrost · ${h.configured_model}`,
        details: `Gateway did not answer: ${h.error}. AI explanations are disabled until it is reachable.`,
        verdict: 'blocked',
      }
    case 'not_configured':
      return { ...base, action: 'BIFROST_PROBE_FAILED', target: 'Bifrost', details: 'BIFROST_BASE_URL is not set on the backend.', verdict: 'warning' }
    default:
      return { ...base, action: 'BIFROST_PROBE_FAILED', target: 'DepShield backend', details: 'Backend is offline, so the gateway could not be probed.', verdict: 'blocked' }
  }
}
