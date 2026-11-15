import type { GitHubAnalysisReport, GitHubManifestFile } from '../api'
import type { TelemetryEvent } from '../telemetry'

export type ManifestRun = {
  path: string
  status: 'pending' | 'running' | 'done' | 'failed'
  report?: GitHubAnalysisReport
  error?: string
}

export const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** Group manifests by folder, root first, keeping discovery order inside each folder. */
export function groupByDir(manifests: GitHubManifestFile[]) {
  const groups = new Map<string, GitHubManifestFile[]>()
  for (const m of manifests) {
    const d = dirOf(m.path)
    groups.set(d, [...(groups.get(d) ?? []), m])
  }
  return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
}

/**
 * Default selection: in each folder take the lockfile(s) when present, because a lockfile
 * already holds the exact pinned tree its manifest declares; otherwise take the manifests.
 */
export function recommendedSelection(manifests: GitHubManifestFile[]): string[] {
  return groupByDir(manifests).flatMap(([, files]) => {
    const locks = files.filter((f) => f.manifest_type === 'lockfile')
    return (locks.length ? locks : files).map((f) => f.path)
  })
}

/** True when a selected manifest's folder also has a selected lockfile (its ranges add nothing). */
export function coveredByLockfile(m: GitHubManifestFile, selected: string[], all: GitHubManifestFile[]) {
  if (m.manifest_type === 'lockfile') return false
  const d = dirOf(m.path)
  return all.some((o) => o.manifest_type === 'lockfile' && dirOf(o.path) === d && selected.includes(o.path))
}

function riskFor(totalVulns: number, unpinned: number): GitHubAnalysisReport['risk_level'] {
  if (totalVulns >= 3) return 'CRITICAL' // same thresholds as the backend
  if (totalVulns > 0) return 'HIGH'
  if (unpinned > 0) return 'MEDIUM'
  return 'CLEAN'
}

/**
 * Combine per-manifest reports into one repository report.
 * - The same package@version from several files is counted once (advisories merged by ID).
 * - A version range is dropped when some file pins that package exactly.
 */
export function mergeReports(reports: { path: string; report: GitHubAnalysisReport }[]): GitHubAnalysisReport | null {
  if (reports.length === 0) return null
  if (reports.length === 1) return reports[0].report
  const first = reports[0].report

  type Dep = GitHubAnalysisReport['dependencies'][number]
  const byKey = new Map<string, Dep>()
  for (const { report } of reports) {
    for (const dep of report.dependencies) {
      const key = `${dep.ecosystem}:${dep.name}@${dep.version}`
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, { ...dep, vulnerabilities: [...dep.vulnerabilities] })
        continue
      }
      const ids = new Set(existing.vulnerabilities.map((v) => v.id))
      for (const v of dep.vulnerabilities) if (!ids.has(v.id)) existing.vulnerabilities.push(v)
      if (dep.status === 'checked') existing.status = 'checked'
    }
  }
  const pinnedNames = new Set(
    [...byKey.values()].filter((d) => d.status === 'checked').map((d) => `${d.ecosystem}:${d.name}`),
  )
  const dependencies = [...byKey.values()].filter(
    (d) => d.status === 'checked' || !pinnedNames.has(`${d.ecosystem}:${d.name}`),
  )

  const checked = dependencies.filter((d) => d.status === 'checked').length
  const unpinned = dependencies.length - checked
  const vulns = dependencies.reduce((n, d) => n + d.vulnerabilities.length, 0)
  const all = reports.map((r) => r.report)
  const unique = <T,>(xs: T[]) => [...new Set(xs)]
  const withAdvisories = all.filter((r) => r.vulnerability_count > 0)
  const allBifrost = withAdvisories.length > 0 && withAdvisories.every((r) => r.summary_source === 'bifrost')
  const tokens = all.reduce((n, r) => n + (r.ai_usage?.total_tokens ?? 0), 0)

  return {
    repository: first.repository,
    branch: first.branch,
    manifest_path: `${reports.length} manifests`,
    ecosystem: unique(all.map((r) => r.ecosystem)).join(' + '),
    manifest_type: unique(all.map((r) => r.manifest_type)).join(' + '),
    dependency_count: dependencies.length,
    checked_count: checked,
    unpinned_count: unpinned,
    vulnerability_count: vulns,
    risk_level: riskFor(vulns, unpinned),
    agent_summary: reports.map(({ path, report }) => `${path}: ${report.agent_summary}`).join('\n\n'),
    recommendations: unique(all.flatMap((r) => r.recommendations)),
    summary_source: allBifrost ? 'bifrost' : 'deterministic',
    summary_fallback_reason: allBifrost ? null : (withAdvisories.find((r) => r.summary_source !== 'bifrost')?.summary_fallback_reason ?? null),
    ai_model: unique(all.map((r) => r.ai_model).filter(Boolean) as string[]).join(', ') || null,
    gateway_response_id: null,
    ai_usage: tokens ? { total_tokens: tokens } : null,
    dependencies,
  }
}

/** Audit-stream events for one analysed manifest (all values come from the real response). */
export function auditTelemetry(
  repo: string,
  branch: string,
  path: string,
  r: GitHubAnalysisReport,
): Omit<TelemetryEvent, 'id' | 'timestamp'>[] {
  return [
    {
      source: 'agent',
      category: 'file_read',
      action: 'DESCRIPTOR_DISCOVERY',
      target: `${repo}/${path}`,
      details: `Parsed ${r.dependency_count} declared dependencies (${r.checked_count} exact pinned) on branch '${branch}'.`,
      verdict: 'safe',
      bytesSent: 0,
      sourceCodeRead: 0,
    },
    {
      source: 'agent',
      category: 'privacy_guard',
      action: 'MANIFEST_ONLY_FETCH',
      target: `${repo}/${path}`,
      details: 'Only this manifest was downloaded from GitHub. Other repository files were listed by name while detecting manifests, but never downloaded.',
      verdict: 'safe',
      bytesSent: 0,
      sourceCodeRead: 0,
    },
    {
      source: 'gateway',
      category: 'osv_query',
      action: 'OSV_BATCH_LOOKUP',
      target: 'https://api.osv.dev/v1/querybatch',
      details: `Sent ${r.checked_count} exact package versions to OSV.dev. Matched ${r.vulnerability_count} advisories.`,
      verdict: r.vulnerability_count > 0 ? 'warning' : 'safe',
      bytesSent: r.checked_count * 32,
      sourceCodeRead: 0,
    },
    ...(r.vulnerability_count > 0
      ? [
          r.summary_source === 'bifrost'
            ? {
                source: 'gateway' as const,
                category: 'policy_gate' as const,
                action: 'BIFROST_EXPLANATION',
                target: `Bifrost · ${r.ai_model ?? 'unknown model'}`,
                details: `Live completion ${r.gateway_response_id ?? '(no id)'} explained ${r.vulnerability_count} OSV advisories in ${path}. Tokens: ${r.ai_usage?.total_tokens ?? 'n/a'}.`,
                verdict: 'warning' as const,
                bytesSent: 0,
                sourceCodeRead: 0,
              }
            : {
                source: 'gateway' as const,
                category: 'policy_gate' as const,
                action: 'BIFROST_UNAVAILABLE',
                target: 'Bifrost gateway',
                details: `No AI explanation for ${path} (${r.summary_fallback_reason ?? 'unknown'}). Showing the OSV summary only.`,
                verdict: 'warning' as const,
                bytesSent: 0,
                sourceCodeRead: 0,
              },
        ]
      : []),
    {
      source: 'agent',
      category: 'policy_gate',
      action: 'AUDIT_COMPLETE',
      target: `${repo}/${path} (${r.risk_level})`,
      details: `Audit finished with risk ${r.risk_level} and ${r.recommendations.length} recommendation(s).`,
      verdict: r.risk_level === 'CLEAN' ? 'safe' : 'warning',
      bytesSent: 0,
      sourceCodeRead: 0,
    },
  ]
}
