/**
 * Minimal browser client for the public OSV.dev API (CORS-enabled).
 * Only package names, versions and advisory IDs are sent; never code or paths.
 */

export type OsvSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | 'UNKNOWN'

export interface OsvAdvisory {
  id: string
  summary: string | null
  details: string | null
  aliases: string[]
  published: string | null
  withdrawn: string | null
  severity: OsvSeverity
  score: number | null
  vector: string | null
  cwes: string[]
  /** Fixed versions for the queried package (empty when no fix is published). */
  fixed: string[]
  /** Set when the advisory says "last affected X" instead of naming a fix. */
  lastAffected: string | null
}

type RawVuln = {
  id: string
  summary?: string
  details?: string
  aliases?: string[]
  published?: string
  withdrawn?: string
  severity?: { type: string; score: string }[]
  database_specific?: { severity?: string; cwe_ids?: string[] }
  affected?: {
    package?: { name?: string; ecosystem?: string }
    ranges?: { events?: Record<string, string>[] }[]
  }[]
}

export const osvEcosystem = (eco: string) => (/py/i.test(eco) ? 'PyPI' : 'npm')

/* ── CVSS v3.x base score (FIRST spec) ─────────────────────────── */
function cvss3(vector: string): number | null {
  const m = Object.fromEntries(vector.split('/').slice(1).map((p) => p.split(':')))
  const W: Record<string, Record<string, number>> = {
    AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
    AC: { L: 0.77, H: 0.44 },
    UI: { N: 0.85, R: 0.62 },
    CIA: { H: 0.56, L: 0.22, N: 0 },
  }
  const changed = m.S === 'C'
  const PR = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR as 'N' | 'L' | 'H']
  const [AV, AC, UI] = [W.AV[m.AV], W.AC[m.AC], W.UI[m.UI]]
  const [C, I, A] = [W.CIA[m.C], W.CIA[m.I], W.CIA[m.A]]
  if ([AV, AC, UI, C, I, A, PR].some((x) => x === undefined)) return null
  const iss = 1 - (1 - C) * (1 - I) * (1 - A)
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss
  if (impact <= 0) return 0
  const exploit = 8.22 * AV * AC * PR * UI
  const roundUp = (x: number) => Math.ceil(x * 10 - 1e-9) / 10
  return roundUp(Math.min(changed ? 1.08 * (impact + exploit) : impact + exploit, 10))
}

function ratingFor(score: number): OsvSeverity {
  if (score === 0) return 'NONE'
  if (score < 4) return 'LOW'
  if (score < 7) return 'MEDIUM'
  if (score < 9) return 'HIGH'
  return 'CRITICAL'
}

/* ── Loose version ordering (good enough for npm semver and PEP 440 releases) ── */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/i, '').split(/[.\-+_]/)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return /^\d/.test(y ?? '') ? -1 : 1 // 1.0 < 1.0.1, but 1.0 > 1.0-rc1
    if (y === undefined) return /^\d/.test(x) ? 1 : -1
    const nx = /^\d+$/.test(x) ? Number(x) : NaN
    const ny = /^\d+$/.test(y) ? Number(y) : NaN
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny
    } else if (x !== y) {
      return x.localeCompare(y)
    }
  }
  return 0
}

function normalize(raw: RawVuln, pkg: string, ecosystem: string): OsvAdvisory {
  const v3 = raw.severity?.find((s) => s.type.startsWith('CVSS_V3'))
  const anyVector = v3 ?? raw.severity?.[0]
  const score = v3 ? cvss3(v3.score) : null
  const ghSeverity = raw.database_specific?.severity?.toUpperCase()
  const severity: OsvSeverity =
    ghSeverity === 'MODERATE' ? 'MEDIUM'
      : ghSeverity && ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(ghSeverity) ? (ghSeverity as OsvSeverity)
        : score !== null ? ratingFor(score) : 'UNKNOWN'

  const fixed: string[] = []
  let lastAffected: string | null = null
  for (const a of raw.affected ?? []) {
    const sameName = a.package?.name?.toLowerCase().replace(/[-_.]+/g, '-') === pkg.toLowerCase().replace(/[-_.]+/g, '-')
    if (!sameName || (a.package?.ecosystem && a.package.ecosystem !== ecosystem)) continue
    for (const r of a.ranges ?? []) {
      for (const e of r.events ?? []) {
        if (e.fixed) fixed.push(e.fixed)
        if (e.last_affected) lastAffected = e.last_affected
      }
    }
  }
  return {
    id: raw.id,
    summary: raw.summary ?? null,
    details: raw.details ?? null,
    aliases: raw.aliases ?? [],
    published: raw.published ?? null,
    withdrawn: raw.withdrawn ?? null,
    severity,
    score,
    vector: anyVector?.score ?? null,
    cwes: raw.database_specific?.cwe_ids ?? [],
    fixed: [...new Set(fixed)].sort(compareVersions),
    lastAffected,
  }
}

const packageCache = new Map<string, Promise<OsvAdvisory[]>>()

/** All OSV advisories affecting one exact package version (cached per session). */
export function queryPackage(name: string, ecosystem: string, version: string): Promise<OsvAdvisory[]> {
  const eco = osvEcosystem(ecosystem)
  const key = `${eco}:${name}@${version}`
  if (!packageCache.has(key)) {
    const p = fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: { name, ecosystem: eco }, version }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`OSV returned ${r.status}`)
        return r.json() as Promise<{ vulns?: RawVuln[] }>
      })
      .then((d) => (d.vulns ?? []).map((v) => normalize(v, name, eco)))
    p.catch(() => packageCache.delete(key)) // let a later attempt retry
    packageCache.set(key, p)
  }
  return packageCache.get(key)!
}

/** Smallest version that is past every advisory with a published fix. */
export function safeVersion(current: string, advisories: OsvAdvisory[]) {
  let target: string | null = null
  const unfixed: string[] = []
  for (const a of advisories) {
    if (a.withdrawn) continue
    const next = a.fixed.find((f) => compareVersions(f, current) > 0)
    if (!next) {
      unfixed.push(a.id)
      continue
    }
    if (!target || compareVersions(next, target) > 0) target = next
  }
  return { target, unfixed }
}

export function upgradeCommand(name: string, ecosystem: string, target: string | null) {
  if (osvEcosystem(ecosystem) === 'PyPI') return target ? `pip install "${name}>=${target}"` : `pip install --upgrade ${name}`
  return target ? `npm install ${name}@${target}` : `npm install ${name}@latest`
}

export const SEVERITY_ORDER: OsvSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE', 'UNKNOWN']

/** What an advisory ID prefix means, in plain words. */
export function describeId(id: string): { source: string; note: string } {
  const p = id.split('-')[0].toUpperCase()
  const map: Record<string, { source: string; note: string }> = {
    GHSA: { source: 'GitHub Advisory Database', note: 'Reviewed by GitHub, usually with a severity rating and a fixed version.' },
    CVE: { source: 'CVE Program', note: 'The industry-wide identifier. Other databases often list the same issue under their own ID.' },
    PYSEC: { source: 'Python Packaging Advisory Database', note: 'Maintained by the Python Packaging Authority for packages on PyPI.' },
    MAL: { source: 'OpenSSF Malicious Packages', note: 'This version was published with intentionally malicious code. Remove it.' },
    OSV: { source: 'OSV.dev', note: 'Recorded directly in the Open Source Vulnerabilities database.' },
    RUSTSEC: { source: 'RustSec Advisory Database', note: 'Advisories for Rust crates.' },
    GO: { source: 'Go Vulnerability Database', note: 'Advisories for Go modules.' },
  }
  return map[p] ?? { source: 'OSV.dev', note: 'An advisory recorded in the OSV.dev database.' }
}
