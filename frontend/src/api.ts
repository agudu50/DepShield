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

export type GitHubUserProfile = {
  login: string
  name: string | null
  avatar_url: string
  html_url: string
  public_repos: number
  total_private_repos?: number | null
}

export type GitHubRepository = {
  id: number
  name: string
  full_name: string
  private: boolean
  html_url: string
  description: string | null
  default_branch: string
  language: string | null
  stargazers_count: number
  updated_at: string
}

export type GitHubManifestFile = {
  name: string
  path: string
  ecosystem: Ecosystem
  manifest_type: 'manifest' | 'lockfile'
  size: number
}

export type GitHubAnalysisReport = {
  repository: string
  branch: string
  manifest_path: string
  ecosystem: string
  manifest_type: string
  dependency_count: number
  checked_count: number
  unpinned_count: number
  vulnerability_count: number
  risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'CLEAN'
  agent_summary: string
  recommendations: string[]
  dependencies: {
    name: string
    version: string
    ecosystem: string
    status: 'checked' | 'version_range'
    vulnerabilities: {
      id: string
      aliases: string[]
      summary: string
    }[]
  }[]
}

function getApiBase(): string {
  return import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
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
  const apiBase = getApiBase()
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

export async function getGitHubUser(token: string): Promise<GitHubUserProfile> {
  const apiBase = getApiBase()
  const response = await fetch(`${apiBase}/api/v1/github/user`, {
    headers: {
      'X-GitHub-Token': token.trim(),
    },
  })
  const payload: unknown = await response.json()
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string'
        ? payload.detail
        : 'Failed to authenticate with GitHub'
    throw new Error(message)
  }
  return payload as GitHubUserProfile
}

export async function listGitHubRepos(token: string, page = 1, perPage = 50): Promise<GitHubRepository[]> {
  const apiBase = getApiBase()
  const response = await fetch(`${apiBase}/api/v1/github/repos?page=${page}&per_page=${perPage}`, {
    headers: {
      'X-GitHub-Token': token.trim(),
    },
  })
  const payload: unknown = await response.json()
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string'
        ? payload.detail
        : 'Failed to retrieve GitHub repositories'
    throw new Error(message)
  }
  return payload as GitHubRepository[]
}

export async function detectGitHubManifests(
  token: string,
  owner: string,
  repo: string,
  ref?: string,
): Promise<GitHubManifestFile[]> {
  const apiBase = getApiBase()
  const url = new URL(`${apiBase}/api/v1/github/repos/${owner}/${repo}/manifests`)
  if (ref) url.searchParams.set('ref', ref)

  const response = await fetch(url.toString(), {
    headers: {
      'X-GitHub-Token': token.trim(),
    },
  })
  const payload: unknown = await response.json()
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string'
        ? payload.detail
        : 'Failed to detect dependency manifests'
    throw new Error(message)
  }
  return payload as GitHubManifestFile[]
}

export async function analyzeGitHubRepo(
  token: string,
  owner: string,
  repo: string,
  input: {
    manifest_path: string
    ref?: string
    question?: string
    project_id?: string
  },
): Promise<GitHubAnalysisReport> {
  const apiBase = getApiBase()
  const response = await fetch(`${apiBase}/api/v1/github/repos/${owner}/${repo}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Token': token.trim(),
    },
    body: JSON.stringify(input),
  })
  const payload: unknown = await response.json()
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string'
        ? payload.detail
        : 'Repository analysis failed'
    throw new Error(message)
  }
  return payload as GitHubAnalysisReport
}
