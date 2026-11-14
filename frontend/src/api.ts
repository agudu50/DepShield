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
  /** 'bifrost' only when the summary is a live gateway completion; otherwise a server template. */
  summary_source?: 'bifrost' | 'deterministic'
  summary_fallback_reason?: 'bifrost_unavailable' | 'bifrost_not_configured' | null
  ai_model?: string | null
  gateway_response_id?: string | null
  ai_usage?: Record<string, number> | null
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

const GITHUB_API_DIRECT = 'https://api.github.com'

const MANIFEST_LOOKUP: Record<string, [Ecosystem, 'manifest' | 'lockfile']> = {
  'package.json': ['npm', 'manifest'],
  'package-lock.json': ['npm', 'lockfile'],
  'npm-shrinkwrap.json': ['npm', 'lockfile'],
  'requirements.txt': ['python', 'manifest'],
  'pyproject.toml': ['python', 'manifest'],
  'uv.lock': ['python', 'lockfile'],
  'poetry.lock': ['python', 'lockfile'],
  'Pipfile.lock': ['python', 'lockfile'],
}

function getApiBase(): string {
  return import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
}

function cleanToken(token: string): string {
  return token.trim().replace(/[\r\n\t]/g, '')
}

/** Check if the local backend is responsive */
export async function checkBackendHealth(): Promise<{ online: boolean; message?: string }> {
  const apiBase = getApiBase()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(`${apiBase}/`, { signal: controller.signal })
    clearTimeout(timer)
    return { online: res.ok }
  } catch {
    return { online: false, message: 'Backend service offline at ' + apiBase }
  }
}

export type BifrostHealth =
  | { status: 'live'; model: string; configured_model: string; gateway_response_id: string | null; usage: Record<string, number>; latency_ms: number }
  | { status: 'unreachable'; configured_model: string; error: string }
  | { status: 'not_configured' }
  | { status: 'backend_offline' }

export type AIModel = {
  id: string
  provider: string
  name: string
  /** local = runs on your machine, free = free model id, free_tier = free key with rate limits */
  tier?: 'local' | 'free' | 'free_tier' | 'paid'
}
export type AIModelCatalog = { default: string; fallbacks: string[]; models: AIModel[] }

/** Models the backend allows; Bifrost routes each one by its "provider/" prefix. */
export async function listAIModels(): Promise<AIModelCatalog | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/v1/ai/models`, { signal: AbortSignal.timeout(5000) })
    return res.ok ? ((await res.json()) as AIModelCatalog) : null
  } catch {
    return null
  }
}

/** Round-trips a real, tiny completion through the Bifrost gateway via the backend. */
export async function checkBifrostHealth(model?: string): Promise<BifrostHealth> {
  try {
    const qs = model ? `?model=${encodeURIComponent(model)}` : ''
    const res = await fetch(`${getApiBase()}/api/health/bifrost${qs}`, { signal: AbortSignal.timeout(40000) })
    if (!res.ok) return { status: 'backend_offline' }
    return (await res.json()) as BifrostHealth
  } catch {
    return { status: 'backend_offline' }
  }
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
  try {
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
  } catch (error) {
    if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
      throw new Error(
        `Cannot reach the backend API at ${apiBase}. Ensure the backend is running with 'cd backend; py -3.12 -m uvicorn app.main:app --reload'`,
      )
    }
    throw error
  }
}

export async function getGitHubUser(rawToken: string): Promise<GitHubUserProfile> {
  const token = cleanToken(rawToken)
  if (!token) {
    throw new Error('GitHub token cannot be empty.')
  }

  const apiBase = getApiBase()

  // 1. Try DepShield backend first
  try {
    const response = await fetch(`${apiBase}/api/v1/github/user`, {
      headers: {
        'X-GitHub-Token': token,
      },
    })
    if (response.ok) {
      const payload: unknown = await response.json()
      return payload as GitHubUserProfile
    }
    if (response.status === 401) {
      throw new Error('Invalid or expired GitHub token. Please verify your token on GitHub.')
    }
    // Only throw explicit client errors (< 500). If backend gives 502/503/504 (upstream DNS/network issue),
    // smoothly fall through to direct browser fetch below.
    if (response.status < 500) {
      const payload: unknown = await response.json().catch(() => null)
      if (payload && typeof payload === 'object' && 'detail' in payload && typeof payload.detail === 'string') {
        throw new Error(payload.detail)
      }
    }
  } catch (err) {
    // If backend replied with explicit token error, throw it; otherwise let browser fallback handle it
    if (err instanceof Error && err.message.toLowerCase().includes('invalid or expired')) {
      throw err
    }
  }

  // 2. Direct GitHub API fallback (GitHub supports CORS directly from browser)
  try {
    const ghRes = await fetch(`${GITHUB_API_DIRECT}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })
    if (ghRes.status === 401) {
      throw new Error(
        'Invalid or expired GitHub token. Please ensure your Personal Access Token has the "repo" or "public_repo" scope.',
      )
    }
    if (!ghRes.ok) {
      const errData = await ghRes.json().catch(() => ({}))
      const msg = errData?.message || ghRes.statusText
      throw new Error(`GitHub authentication failed: ${msg}`)
    }
    const data = await ghRes.json()
    return {
      login: data.login,
      name: data.name ?? null,
      avatar_url: data.avatar_url ?? '',
      html_url: data.html_url ?? '',
      public_repos: data.public_repos ?? 0,
      total_private_repos: data.total_private_repos ?? null,
    }
  } catch (ghErr) {
    if (ghErr instanceof Error && !ghErr.message.toLowerCase().includes('fetch')) {
      throw ghErr
    }
    throw new Error(
      `Cannot connect to GitHub API or local backend (${apiBase}). Please check your internet connection or start the backend.`,
    )
  }
}

export async function listGitHubRepos(rawToken: string, page = 1, perPage = 50): Promise<GitHubRepository[]> {
  const token = cleanToken(rawToken)
  const apiBase = getApiBase()

  // 1. Try backend first
  try {
    const response = await fetch(`${apiBase}/api/v1/github/repos?page=${page}&per_page=${perPage}`, {
      headers: {
        'X-GitHub-Token': token,
      },
    })
    if (response.ok) {
      const payload: unknown = await response.json()
      return payload as GitHubRepository[]
    }
  } catch {
    // Fall back to direct GitHub API if backend is offline
  }

  // 2. Direct GitHub API fallback
  try {
    const params = new URLSearchParams({
      sort: 'updated',
      direction: 'desc',
      page: String(page),
      per_page: String(perPage),
      affiliation: 'owner,collaborator,organization_member',
    })
    const res = await fetch(`${GITHUB_API_DIRECT}/user/repos?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })
    if (!res.ok) {
      throw new Error('Failed to retrieve GitHub repositories.')
    }
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data.map((item: any) => ({
      id: item.id,
      name: item.name,
      full_name: item.full_name,
      private: Boolean(item.private),
      html_url: item.html_url,
      description: item.description ?? null,
      default_branch: item.default_branch || 'main',
      language: item.language ?? null,
      stargazers_count: item.stargazers_count || 0,
      updated_at: item.updated_at || '',
    }))
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to list GitHub repositories')
  }
}

export async function detectGitHubManifests(
  rawToken: string,
  owner: string,
  repo: string,
  ref?: string,
): Promise<GitHubManifestFile[]> {
  const token = cleanToken(rawToken)
  const apiBase = getApiBase()

  // 1. Try backend
  try {
    const url = new URL(`${apiBase}/api/v1/github/repos/${owner}/${repo}/manifests`)
    if (ref) url.searchParams.set('ref', ref)
    const response = await fetch(url.toString(), {
      headers: { 'X-GitHub-Token': token },
    })
    if (response.ok) {
      const payload: unknown = await response.json()
      return payload as GitHubManifestFile[]
    }
  } catch {
    // Fall back to direct GitHub API
  }

  // 2. Direct GitHub API fallback
  const dirs = ['', 'backend', 'frontend', 'server', 'client', 'src']
  const found: GitHubManifestFile[] = []
  const seen = new Set<string>()

  for (const d of dirs) {
    try {
      const pathPart = d ? `/${encodeURIComponent(d)}` : ''
      const url = new URL(`${GITHUB_API_DIRECT}/repos/${owner}/${repo}/contents${pathPart}`)
      if (ref) url.searchParams.set('ref', ref)

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      })
      if (!res.ok) continue
      const items = await res.json()
      if (Array.isArray(items)) {
        for (const f of items) {
          const fname = f.name
          const fpath = f.path
          if (MANIFEST_LOOKUP[fname] && !seen.has(fpath)) {
            seen.add(fpath)
            const [eco, mtype] = MANIFEST_LOOKUP[fname]
            found.push({
              name: fname,
              path: fpath,
              ecosystem: eco,
              manifest_type: mtype,
              size: f.size || 0,
            })
          }
        }
      }
    } catch {
      continue
    }
  }

  return found
}

export async function analyzeGitHubRepo(
  rawToken: string,
  owner: string,
  repo: string,
  input: {
    manifest_path: string
    ref?: string
    question?: string
    project_id?: string
    model?: string
  },
): Promise<GitHubAnalysisReport> {
  const token = cleanToken(rawToken)
  const apiBase = getApiBase()

  try {
    const response = await fetch(`${apiBase}/api/v1/github/repos/${owner}/${repo}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Token': token,
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
  } catch (error) {
    if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
      throw new Error(
        `Cannot connect to DepShield backend at ${apiBase}. To run the AI Security Agent, start the backend with: 'cd backend; py -3.12 -m uvicorn app.main:app --reload'`,
      )
    }
    throw error
  }
}
