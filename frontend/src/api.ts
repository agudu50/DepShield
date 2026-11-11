export type Ecosystem = 'npm' | 'python'

export type ScanResponse = {
  project_name: string
  ecosystem: Ecosystem
  manifest_type: 'manifest' | 'lockfile'
  dependency_count: number
  checked_count: number
  unpinned_count: number
  vulnerability_count: number
  dependencies: {
    name: string
    version: string
    ecosystem: Ecosystem
    status: 'checked' | 'version_range'
    vulnerabilities: {
      id: string
      aliases: string[]
      summary: string
    }[]
  }[]
}

function isScanResponse(value: unknown): value is ScanResponse {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('project_name' in value) ||
    typeof value.project_name !== 'string' ||
    !('ecosystem' in value) ||
    (value.ecosystem !== 'npm' && value.ecosystem !== 'python') ||
    !('manifest_type' in value) ||
    (value.manifest_type !== 'manifest' && value.manifest_type !== 'lockfile') ||
    !('dependencies' in value) ||
    !Array.isArray(value.dependencies)
  ) {
    return false
  }

  return value.dependencies.every(
    (dependency) =>
      typeof dependency === 'object' &&
      dependency !== null &&
      'name' in dependency &&
      typeof dependency.name === 'string' &&
      'version' in dependency &&
      typeof dependency.version === 'string' &&
      'status' in dependency &&
      (dependency.status === 'checked' || dependency.status === 'version_range') &&
      'vulnerabilities' in dependency &&
      Array.isArray(dependency.vulnerabilities) &&
      dependency.vulnerabilities.every(
        (vulnerability) =>
          typeof vulnerability === 'object' &&
          vulnerability !== null &&
          'id' in vulnerability &&
          typeof vulnerability.id === 'string' &&
          'aliases' in vulnerability &&
          Array.isArray(vulnerability.aliases) &&
          'summary' in vulnerability &&
          typeof vulnerability.summary === 'string',
      ),
  )
}

export async function scanManifest(input: {
  project_name: string
  ecosystem: Ecosystem
  manifest_type?: 'manifest' | 'lockfile'
  manifest: string
}): Promise<ScanResponse> {
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
  const response = await fetch(`${apiBase}/api/v1/scans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  const payload: unknown = await response.json()
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'detail' in payload &&
      typeof payload.detail === 'string'
        ? payload.detail
        : 'The scan could not be completed'
    throw new Error(message)
  }
  if (!isScanResponse(payload)) {
    throw new Error('The scan service returned an invalid response')
  }
  return payload
}
