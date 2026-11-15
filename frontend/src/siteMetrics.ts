/**
 * Anonymous, public site metrics.
 * A visitor is a random UUID kept in this browser; nothing else identifies you.
 * Visits aren't counted when Do Not Track or Global Privacy Control is on.
 */

export type SiteSummary = {
  available: boolean
  page_views?: number
  unique_visitors?: number
  visitors_today?: number
  here_now?: number
  manifests_audited?: number
  packages_checked?: number
  advisories_found?: number
  generated_at?: string
}

const KEY = 'depshield_visitor_id'
const api = () => import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export function trackingAllowed(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string }
  const dnt = nav.doNotTrack ?? (window as unknown as { doNotTrack?: string }).doNotTrack ?? nav.msDoNotTrack
  return !(dnt === '1' || dnt === 'yes' || nav.globalPrivacyControl === true)
}

function visitorId(): string | null {
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return null // storage blocked: don't count rather than count twice
  }
}

function send(heartbeat: boolean) {
  const id = visitorId()
  if (!id) return
  void fetch(`${api()}/api/v1/metrics/visit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitor_id: id, heartbeat }),
    keepalive: true,
  }).catch(() => {})
}

/** Count this page view and keep "here now" fresh while the tab is visible. Returns a cleanup. */
export function startVisitTracking(): () => void {
  if (!trackingAllowed()) return () => {}
  send(false)
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') send(true)
  }, 60_000)
  const onVisible = () => document.visibilityState === 'visible' && send(true)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

export async function fetchSiteSummary(): Promise<SiteSummary> {
  try {
    const res = await fetch(`${api()}/api/v1/metrics/summary`, { signal: AbortSignal.timeout(6000) })
    return res.ok ? ((await res.json()) as SiteSummary) : { available: false }
  } catch {
    return { available: false }
  }
}
