export interface TelemetryEvent {
  id: string
  timestamp: string
  /** Epoch ms; absent on events recorded before this field existed. */
  at?: number
  source: 'agent' | 'cli' | 'gateway'
  category: 'file_read' | 'osv_query' | 'policy_gate' | 'privacy_guard' | 'heartbeat'
  action: string
  target: string
  details: string
  verdict: 'safe' | 'warning' | 'blocked' | 'info'
  bytesSent: number
  sourceCodeRead: number
  project?: string
}

const STORAGE_KEY = 'depshield_telemetry_events'
const listeners: Set<(events: TelemetryEvent[]) => void> = new Set()

/**
 * Events older builds wrote that asserted checks nothing actually performed
 * ("sandbox boundary enforced", a canned "isolation probe passed"). Drop them on read.
 */
const RETIRED_ACTIONS = new Set(['SOURCE_CODE_SANDBOX', 'SANDBOX_ISOLATION_PROBE', 'EXFILTRATION_PROOF'])

export function getStoredEvents(): TelemetryEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((e: TelemetryEvent) => !RETIRED_ACTIONS.has(e?.action)) : []
  } catch {
    return []
  }
}

export function saveEvents(events: TelemetryEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, 100)))
  } catch {
    // Ignore storage quota errors
  }
  listeners.forEach((fn) => fn(events))
}

export function addTelemetryEvent(
  event: Omit<TelemetryEvent, 'id' | 'timestamp'>,
): TelemetryEvent {
  const now = new Date()
  const ts =
    now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0')
  const newEvt: TelemetryEvent = {
    ...event,
    id: `evt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: ts,
    at: now.getTime(),
  }

  const current = getStoredEvents()
  const updated = [newEvt, ...current].slice(0, 100)
  saveEvents(updated)
  return newEvt
}

export function addTelemetryBatch(
  events: Omit<TelemetryEvent, 'id' | 'timestamp'>[],
): void {
  const now = new Date()
  const baseTime = now.getTime()
  const newItems: TelemetryEvent[] = events.map((evt, idx) => {
    const itemDate = new Date(baseTime + idx * 80)
    const ts =
      itemDate.toTimeString().split(' ')[0] +
      '.' +
      String(itemDate.getMilliseconds()).padStart(3, '0')
    return {
      ...evt,
      id: `evt-${baseTime}-${idx}-${Math.floor(Math.random() * 1000)}`,
      timestamp: ts,
      at: itemDate.getTime(),
    }
  })

  const current = getStoredEvents()
  const updated = [...newItems.reverse(), ...current].slice(0, 100)
  saveEvents(updated)
}

export function clearTelemetryEvents(): void {
  saveEvents([])
}

export function subscribeTelemetry(fn: (events: TelemetryEvent[]) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

