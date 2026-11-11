import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { authClient, authenticatedApiRequest } from './auth'

type UserSummary = { id: string; email: string; name: string }
type Organization = { id: string; name: string; role: string }
type Project = { id: string; organization_id: string; name: string }
type Investigation = {
  id: string
  status: string
  created_at?: string
  completed_at?: string | null
  answer: string | null
  evidence: { source: string; id: string; aliases: string[]; summary: string }[]
  events: { id: number; event_type: string; payload: Record<string, unknown>; created_at: string }[]
}
type InvestigationSummary = {
  id: string
  project_id: string
  ecosystem: string
  package_name: string
  version: string
  status: string
  created_at: string
  completed_at: string | null
}
type ScanResult = {
  id: string
  project_id: string
  project_name: string
  ecosystem: 'npm' | 'python'
  manifest_type: 'manifest' | 'lockfile'
  dependency_count: number
  checked_count: number
  unpinned_count: number
  vulnerability_count: number
  dependencies: {
    name: string
    version: string
    status: 'checked' | 'version_range'
    vulnerabilities: { id: string; aliases: string[]; summary: string }[]
  }[]
  created_at: string
}
type ScanSummary = {
  id: string
  ecosystem: string
  created_at: string
  dependency_count: number
  checked_count: number
  unpinned_count: number
  vulnerability_count: number
}
type ProjectInventory = {
  project_id: string
  manager: string
  revision: number
  updated_at: string
  packages: { name: string; version: string }[]
}
type Member = { user_id: string; organization_id: string; role: string; created_at: string }
type Invitation = {
  id: string
  email: string
  role: 'admin' | 'member'
  inviter_user_id: string
  created_at: string
  expires_at: string
}

function exampleScanInput(
  ecosystem: 'npm' | 'python',
  manifestType: 'manifest' | 'lockfile',
): string {
  if (ecosystem === 'npm' && manifestType === 'lockfile') {
    return '{\n  "name": "my-project",\n  "lockfileVersion": 3,\n  "packages": {\n    "": { "name": "my-project" },\n    "node_modules/lodash": { "version": "4.17.15" }\n  }\n}'
  }
  if (ecosystem === 'python' && manifestType === 'lockfile') {
    return '[[package]]\nname = "requests"\nversion = "2.31.0"'
  }
  return ecosystem === 'npm'
    ? '{\n  "dependencies": {\n    "lodash": "4.17.15"\n  }\n}'
    : 'requests==2.31.0\njinja2>=3.0'
}

export default function WorkspacePanel() {
  const authorizationParams = new URLSearchParams(window.location.search)
  const cliCallback = authorizationParams.get('depshield_callback')
  const cliState = authorizationParams.get('depshield_state')
  const validCliCallback = (() => {
    if (!cliCallback || !cliState || cliState.length > 128) return false
    try {
      const callback = new URL(cliCallback)
      return callback.protocol === 'http:' &&
        callback.hostname === '127.0.0.1' &&
        callback.port !== '' &&
        !callback.username &&
        !callback.password &&
        callback.pathname === '/oauth/callback' &&
        callback.search === '' &&
        callback.hash === ''
    } catch {
      return false
    }
  })()
  const [user, setUser] = useState<UserSummary | null>(null)
  const [loading, setLoading] = useState(Boolean(authClient))
  const [isSignUp, setIsSignUp] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [organizationId, setOrganizationId] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [projectName, setProjectName] = useState('')
  const [ecosystem, setEcosystem] = useState<'npm' | 'python'>('npm')
  const [packageName, setPackageName] = useState('lodash')
  const [version, setVersion] = useState('4.17.15')
  const [question, setQuestion] = useState('Explain the verified advisory evidence.')
  const [investigation, setInvestigation] = useState<Investigation | null>(null)
  const [investigationHistory, setInvestigationHistory] = useState<InvestigationSummary[]>([])
  const [scanEcosystem, setScanEcosystem] = useState<'npm' | 'python'>('npm')
  const [scanManifestType, setScanManifestType] = useState<'manifest' | 'lockfile'>('manifest')
  const [scanManifest, setScanManifest] = useState('{\n  "dependencies": {\n    "lodash": "4.17.15"\n  }\n}')
  const [savedScan, setSavedScan] = useState<ScanResult | null>(null)
  const [scanHistory, setScanHistory] = useState<ScanSummary[]>([])
  const [projectInventory, setProjectInventory] = useState<ProjectInventory | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [issuedInviteToken, setIssuedInviteToken] = useState('')
  const [inviteToken, setInviteToken] = useState('')
  const [memberRoles, setMemberRoles] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [cliAuthNotice, setCliAuthNotice] = useState('')
  const [cliAuthError, setCliAuthError] = useState('')
  const canManageOrganization = organizations.some(
    (organization) =>
      organization.id === organizationId &&
      (organization.role === 'owner' || organization.role === 'admin'),
  )

  async function restoreSession() {
    if (!authClient) {
      setLoading(false)
      return
    }

    const result = await authClient.getSession({ query: {} })
    if (result.error) {
      throw new Error(result.error.message)
    }
    const currentUser = result.data?.user
    setUser(
      currentUser
        ? {
            id: currentUser.id,
            email: currentUser.email,
            name: currentUser.name,
          }
        : null,
    )
  }

  async function authorizeCli() {
    if (!validCliCallback || !cliCallback || !cliState || !authClient) {
      setCliAuthError('This CLI authorization request is invalid or expired.')
      return
    }
    setCliAuthError('')
    setCliAuthNotice('')
    try {
      const result = await authClient.getSession({ query: {} })
      if (result.error) throw new Error(result.error.message)
      const token = result.data?.session?.token
      if (!token) throw new Error('Sign in before authorizing the DepShield CLI.')
      const response = await fetch(cliCallback, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ state: cliState, token }),
      })
      if (!response.ok) throw new Error('The local CLI authorization callback rejected the request.')
      setCliAuthNotice('DepShield CLI authorized. You can close this browser tab.')
    } catch (authorizationError) {
      setCliAuthError(
        authorizationError instanceof Error
          ? authorizationError.message
          : 'DepShield CLI authorization failed',
      )
    }
  }

  useEffect(() => {
    let active = true
    if (!authClient) {
      setLoading(false)
      return () => {
        active = false
      }
    }

    void authClient
      .getSession({ query: {} })
      .then((result) => {
        if (result.error) throw new Error(result.error.message)
        const currentUser = result.data?.user
        if (active) {
          setUser(
            currentUser
              ? { id: currentUser.id, email: currentUser.email, name: currentUser.name }
              : null,
          )
        }
      })
      .catch((sessionError: unknown) => {
        if (active) setError(sessionError instanceof Error ? sessionError.message : 'Session could not be restored')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    if (!user) {
      setOrganizations([])
      setOrganizationId('')
      setProjects([])
      setProjectId('')
      return () => {
        active = false
      }
    }

    void authenticatedApiRequest<Organization[]>('/api/v1/organizations')
      .then((items) => {
        if (!active) return
        setOrganizations(items)
        setOrganizationId((current) =>
          items.some((organization) => organization.id === current)
            ? current
            : (items[0]?.id ?? ''),
        )
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Organizations could not be loaded')
      })

    return () => {
      active = false
    }
  }, [user])

  useEffect(() => {
    let active = true
    if (!organizationId) {
      setProjects([])
      setProjectId('')
      return () => {
        active = false
      }
    }

    void authenticatedApiRequest<Project[]>(
      `/api/v1/organizations/${organizationId}/projects`,
    )
      .then((items) => {
        if (!active) return
        setProjects(items)
        setProjectId((current) =>
          items.some((project) => project.id === current) ? current : (items[0]?.id ?? ''),
        )
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Projects could not be loaded')
      })

    return () => {
      active = false
    }
  }, [organizationId])

  useEffect(() => {
    let active = true
    setMembers([])
    setInvitations([])
    if (!organizationId) {
      return () => {
        active = false
      }
    }

    void Promise.all([
      authenticatedApiRequest<Member[]>(`/api/v1/organizations/${organizationId}/members`),
      authenticatedApiRequest<Invitation[]>(`/api/v1/organizations/${organizationId}/invitations`),
    ])
      .then(([nextMembers, nextInvitations]) => {
        if (!active) return
        setMembers(nextMembers)
        setInvitations(nextInvitations)
        setMemberRoles(Object.fromEntries(nextMembers.map((member) => [member.user_id, member.role])))
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Organization members could not be loaded')
      })

    return () => {
      active = false
    }
  }, [organizationId])

  useEffect(() => {
    let active = true
    setScanHistory([])
    setSavedScan(null)
    setProjectInventory(null)
    setInvestigationHistory([])
    if (!projectId) {
      return () => {
        active = false
      }
    }
    void Promise.all([
      authenticatedApiRequest<ScanSummary[]>(`/api/v1/projects/${projectId}/scans`),
      authenticatedApiRequest<ProjectInventory | null>(
        `/api/v1/projects/${projectId}/inventory`,
      ),
      authenticatedApiRequest<InvestigationSummary[]>(
        `/api/v1/agent/projects/${projectId}/investigations`,
      ),
    ])
      .then(([scans, inventory, investigations]) => {
        if (!active) return
        setScanHistory(scans)
        setProjectInventory(inventory)
        setInvestigationHistory(investigations)
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Scan history could not be loaded')
      })
    return () => {
      active = false
    }
  }, [projectId])

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!authClient) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password })
      if (result.error) throw new Error(result.error.message)
      await restoreSession()
      if (isSignUp) {
        setNotice('Account created. If you do not have a session yet, verify your email and sign in.')
      }
      setPassword('')
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!authClient) return
    setBusy(true)
    setError('')
    try {
      const result = await authClient.signOut({})
      if (result.error) throw new Error(result.error.message)
      setUser(null)
      setInvestigation(null)
      setSavedScan(null)
      setMembers([])
      setInvitations([])
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Sign out failed')
    } finally {
      setBusy(false)
    }
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const organization = await authenticatedApiRequest<Organization>('/api/v1/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: organizationName }),
      })
      setOrganizations((current) => [...current, organization])
      setOrganizationId(organization.id)
      setOrganizationName('')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Organization could not be created')
    } finally {
      setBusy(false)
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!organizationId) return
    setBusy(true)
    setError('')
    try {
      const project = await authenticatedApiRequest<Project>(
        `/api/v1/organizations/${organizationId}/projects`,
        { method: 'POST', body: JSON.stringify({ name: projectName }) },
      )
      setProjects((current) => [...current, project])
      setProjectId(project.id)
      setProjectName('')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Project could not be created')
    } finally {
      setBusy(false)
    }
  }

  async function submitInvestigation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!projectId) return
    setBusy(true)
    setError('')
    setInvestigation(null)
    try {
      const created = await authenticatedApiRequest<{ id: string }>(
        '/api/v1/agent/investigations',
        {
          method: 'POST',
          body: JSON.stringify({
            project_id: projectId,
            ecosystem,
            package_name: packageName,
            version,
            question,
          }),
        },
      )
      const detail = await authenticatedApiRequest<Investigation>(
        `/api/v1/agent/investigations/${created.id}`,
      )
      setInvestigation(detail)
      setInvestigationHistory((current) => [
        {
          id: detail.id,
          project_id: projectId,
          ecosystem,
          package_name: packageName,
          version,
          status: detail.status,
          created_at: detail.created_at ?? new Date().toISOString(),
          completed_at: detail.completed_at ?? new Date().toISOString(),
        },
        ...current.filter((item) => item.id !== detail.id),
      ])
    } catch (investigationError) {
      setError(
        investigationError instanceof Error
          ? investigationError.message
          : 'Investigation could not be completed',
      )
    } finally {
      setBusy(false)
    }
  }

  async function submitProjectScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!projectId) return
    setBusy(true)
    setError('')
    try {
      const result = await authenticatedApiRequest<ScanResult>(
        `/api/v1/projects/${projectId}/scans`,
        {
          method: 'POST',
          body: JSON.stringify({
            ecosystem: scanEcosystem,
            manifest_type: scanManifestType,
            manifest: scanManifest,
          }),
        },
      )
      setSavedScan(result)
      setScanHistory((current) => [
        {
          id: result.id,
          ecosystem: result.ecosystem,
          created_at: result.created_at,
          dependency_count: result.dependency_count,
          checked_count: result.checked_count,
          unpinned_count: result.unpinned_count,
          vulnerability_count: result.vulnerability_count,
        },
        ...current.filter((item) => item.id !== result.id),
      ])
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'The scan could not be saved')
    } finally {
      setBusy(false)
    }
  }

  async function openSavedScan(scanId: string) {
    setBusy(true)
    setError('')
    try {
      setSavedScan(await authenticatedApiRequest<ScanResult>(`/api/v1/scans/${scanId}`))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Scan result could not be loaded')
    } finally {
      setBusy(false)
    }
  }

  async function openInvestigation(investigationId: string) {
    setBusy(true)
    setError('')
    try {
      setInvestigation(
        await authenticatedApiRequest<Investigation>(
          `/api/v1/agent/investigations/${investigationId}`,
        ),
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Investigation could not be loaded')
    } finally {
      setBusy(false)
    }
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!organizationId) return
    setBusy(true)
    setError('')
    setIssuedInviteToken('')
    try {
      const result = await authenticatedApiRequest<{ invitation: Invitation; token: string }>(
        `/api/v1/organizations/${organizationId}/invitations`,
        {
          method: 'POST',
          body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
        },
      )
      setInvitations((current) => [result.invitation, ...current])
      setIssuedInviteToken(result.token)
      setInviteEmail('')
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Invitation could not be created')
    } finally {
      setBusy(false)
    }
  }

  async function acceptInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const membership = await authenticatedApiRequest<Member>('/api/v1/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token: inviteToken.trim() }),
      })
      setInviteToken('')
      setNotice('Invitation accepted. Select the organization to open its projects.')
      const refreshed = await authenticatedApiRequest<Organization[]>('/api/v1/organizations')
      setOrganizations(refreshed)
      setOrganizationId(membership.organization_id)
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : 'Invitation could not be accepted')
    } finally {
      setBusy(false)
    }
  }

  async function updateMemberRole(member: Member) {
    if (!organizationId) return
    setBusy(true)
    setError('')
    try {
      const updated = await authenticatedApiRequest<Member>(
        `/api/v1/organizations/${organizationId}/members/${encodeURIComponent(member.user_id)}`,
        { method: 'PATCH', body: JSON.stringify({ role: memberRoles[member.user_id] }) },
      )
      setMembers((current) => current.map((item) => item.user_id === updated.user_id ? updated : item))
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : 'Member role could not be updated')
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(member: Member) {
    if (!organizationId) return
    setBusy(true)
    setError('')
    try {
      await authenticatedApiRequest<void>(
        `/api/v1/organizations/${organizationId}/members/${encodeURIComponent(member.user_id)}`,
        { method: 'DELETE' },
      )
      setMembers((current) => current.filter((item) => item.user_id !== member.user_id))
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Member could not be removed')
    } finally {
      setBusy(false)
    }
  }

  async function revokeInvitation(invitationId: string) {
    if (!organizationId) return
    setBusy(true)
    setError('')
    try {
      await authenticatedApiRequest<void>(
        `/api/v1/organizations/${organizationId}/invitations/${invitationId}`,
        { method: 'DELETE' },
      )
      setInvitations((current) => current.filter((invitation) => invitation.id !== invitationId))
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Invitation could not be revoked')
    } finally {
      setBusy(false)
    }
  }

  if (!authClient) {
    return (
      <section className="panel workspace-panel" aria-labelledby="workspace-title">
        <div className="panel-header">
          <div>
            <h3 id="workspace-title">Sign-in and investigation workspace</h3>
            <p className="scan-help">Set VITE_NEON_AUTH_URL to the Managed Auth base URL to enable this feature.</p>
          </div>
          <span className="panel-tag">Not configured</span>
        </div>
      </section>
    )
  }

  return (
    <section className="panel workspace-panel" aria-labelledby="workspace-title">
      <div className="panel-header">
        <div>
          <h3 id="workspace-title">Secure investigation workspace</h3>
          <p className="scan-help">Neon Auth sessions protect organization and project data; investigation runs and evidence are retained in PostgreSQL.</p>
        </div>
        {user && (
          <button type="button" className="secondary-button small-button" onClick={() => void signOut()} disabled={busy}>
            Sign out
          </button>
        )}
      </div>

      {cliCallback && (
        <div className="workspace-form" role="group" aria-labelledby="cli-auth-title">
          <h4 id="cli-auth-title">Authorize DepShield CLI</h4>
          <p className="scan-help">
            This gives the local CLI access to your DepShield projects. The token is sent only to
            the one-time loopback callback and stored in your operating-system credential store.
          </p>
          {!validCliCallback && <p className="scan-error" role="alert">This CLI authorization request is invalid.</p>}
          {cliAuthError && <p className="scan-error" role="alert">{cliAuthError}</p>}
          {cliAuthNotice && <p className="scan-help" role="status">{cliAuthNotice}</p>}
          {validCliCallback && !cliAuthNotice && (
            <button type="button" className="primary-button" onClick={() => void authorizeCli()} disabled={busy || !user}>
              {user ? 'Authorize this CLI' : 'Sign in to authorize'}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <p role="status">Restoring your session...</p>
      ) : !user ? (
        <form className="scan-form workspace-form" onSubmit={(event) => void submitAuth(event)}>
          <div className="workspace-form-header">
            <strong>{isSignUp ? 'Create account' : 'Sign in'}</strong>
            <button type="button" className="text-button" onClick={() => setIsSignUp((current) => !current)}>
              {isSignUp ? 'Already have an account?' : 'Create an account'}
            </button>
          </div>
          {isSignUp && (
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required />
            </label>
          )}
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && <p className="scan-error" role="alert">{error}</p>}
          {notice && <p className="scan-help" role="status">{notice}</p>}
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? 'Please wait...' : isSignUp ? 'Create account' : 'Sign in'}
          </button>
        </form>
      ) : (
        <div className="workspace-content">
          <p className="workspace-user">Signed in as <strong>{user.email}</strong></p>
          <div className="workspace-grid">
            <form className="scan-form workspace-form" onSubmit={(event) => void createOrganization(event)}>
              <h4>Organization</h4>
              {organizations.length > 0 && (
                <label>
                  Select organization
                  <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
                    {organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name} ({organization.role})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                New organization
                <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} maxLength={120} required />
              </label>
              <button type="submit" className="secondary-button" disabled={busy}>Create organization</button>
            </form>

            {organizationId && canManageOrganization && (
              <form className="scan-form workspace-form" onSubmit={(event) => void createProject(event)}>
                <h4>Project</h4>
                {projects.length > 0 && (
                  <label>
                    Select project
                    <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                  </label>
                )}
                <label>
                  New project
                  <input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={100} required />
                </label>
                <button type="submit" className="secondary-button" disabled={busy}>Create project</button>
              </form>
            )}
            {organizationId && (
              <div className="scan-form workspace-form">
                <h4>Organization members</h4>
                {members.map((member) => (
                  <div className="workspace-member" key={member.user_id}>
                    <span>{member.user_id === user.id ? `${member.user_id} (you)` : member.user_id}</span>
                    {canManageOrganization ? (
                      <>
                        <select
                          aria-label={`Role for ${member.user_id}`}
                          value={memberRoles[member.user_id] ?? member.role}
                          onChange={(event) => setMemberRoles((current) => ({ ...current, [member.user_id]: event.target.value }))}
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                        <button type="button" className="secondary-button small-button" disabled={busy || member.role === memberRoles[member.user_id]} onClick={() => void updateMemberRole(member)}>Save</button>
                        <button type="button" className="text-button" disabled={busy} onClick={() => void removeMember(member)}>Remove</button>
                      </>
                    ) : <span>{member.role}</span>}
                  </div>
                ))}
                {canManageOrganization && <form className="scan-form workspace-form" onSubmit={(event) => void createInvitation(event)}>
                  <h4>Invite a member</h4>
                  <label>
                    Invitee email
                    <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required />
                  </label>
                  <label>
                    Role
                    <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value === 'admin' ? 'admin' : 'member')}>
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                  <button type="submit" className="secondary-button" disabled={busy}>Create invitation</button>
                  {issuedInviteToken && <p className="scan-help" role="status">Copy this one-time invitation token and share it privately with the matching email address: <code>{issuedInviteToken}</code></p>}
                  {invitations.map((invitation) => (
                    <div className="workspace-member" key={invitation.id}>
                      <span>{invitation.email} ({invitation.role})</span>
                      <button type="button" className="text-button" disabled={busy} onClick={() => void revokeInvitation(invitation.id)}>Revoke</button>
                    </div>
                  ))}
                </form>}
              </div>
            )}
          </div>

          <form className="scan-form workspace-form" onSubmit={(event) => void acceptInvitation(event)}>
            <h4>Accept an organization invitation</h4>
            <label>
              Invitation token
              <input value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} minLength={32} maxLength={128} required />
            </label>
            <button type="submit" className="secondary-button" disabled={busy}>Accept invitation</button>
          </form>

          {projectId && (
            <>
            <form className="scan-form workspace-form" onSubmit={(event) => void submitProjectScan(event)}>
              <h4>Scan and save to this project</h4>
              <p className="scan-help">Saved scans retain the parsed results, not the original manifest. Data is automatically deleted after 90 days.</p>
              <div className="workspace-grid">
                <label>
                  Ecosystem
                  <select value={scanEcosystem} onChange={(event) => {
                    const next = event.target.value === 'python' ? 'python' : 'npm'
                    setScanEcosystem(next)
                    setScanManifest(exampleScanInput(next, scanManifestType))
                  }}>
                    <option value="npm">npm</option>
                    <option value="python">Python</option>
                  </select>
                </label>
                <label>
                  File type
                  <select value={scanManifestType} onChange={(event) => {
                    const next = event.target.value === 'lockfile' ? 'lockfile' : 'manifest'
                    setScanManifestType(next)
                    setScanManifest(exampleScanInput(scanEcosystem, next))
                  }}>
                    <option value="manifest">Manifest</option>
                    <option value="lockfile">Lockfile</option>
                  </select>
                </label>
                <label className="manifest-field">
                  {scanManifestType === 'lockfile'
                    ? scanEcosystem === 'npm'
                      ? 'package-lock.json'
                      : 'poetry.lock, uv.lock, or Pipfile.lock'
                    : scanEcosystem === 'npm'
                      ? 'package.json'
                      : 'requirements.txt'}
                  <textarea value={scanManifest} onChange={(event) => setScanManifest(event.target.value)} required rows={7} spellCheck={false} />
                </label>
              </div>
              <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Scanning...' : 'Run and save scan'}</button>
            </form>
            <div className="scan-form workspace-form">
              <h4>Synced dependency inventory</h4>
              {!projectInventory ? (
                <p className="scan-help">No CLI inventory has been synchronized for this project.</p>
              ) : (
                <>
                  <p className="scan-help">
                    {projectInventory.packages.length} package versions · {projectInventory.manager} ·
                    {' '}revision {projectInventory.revision} · updated {new Date(projectInventory.updated_at).toLocaleString()}
                  </p>
                  <ul className="mini-list">
                    {projectInventory.packages.slice(0, 20).map((packageItem) => (
                      <li key={`${packageItem.name}-${packageItem.version}`}>
                        {packageItem.name}@{packageItem.version}
                      </li>
                    ))}
                  </ul>
                  {projectInventory.packages.length > 20 && (
                    <p className="scan-help">Showing 20 of {projectInventory.packages.length} packages.</p>
                  )}
                </>
              )}
            </div>
            <div className="scan-form workspace-form">
              <h4>Saved scan history</h4>
              {scanHistory.length === 0 ? <p className="scan-help">No saved scans for this project yet.</p> : scanHistory.map((item) => (
                <button type="button" className="secondary-button small-button" key={item.id} disabled={busy} onClick={() => void openSavedScan(item.id)}>
                  {new Date(item.created_at).toLocaleString()} · {item.ecosystem} · {item.vulnerability_count} advisories
                </button>
              ))}
            </div>
            </>
          )}

          {projectId && (
            <form className="scan-form workspace-form investigation-form" onSubmit={(event) => void submitInvestigation(event)}>
              <h4>Investigate an exact dependency version</h4>
              <div className="workspace-grid">
                <label>
                  Ecosystem
                  <select value={ecosystem} onChange={(event) => setEcosystem(event.target.value === 'python' ? 'python' : 'npm')}>
                    <option value="npm">npm</option>
                    <option value="python">Python</option>
                  </select>
                </label>
                <label>
                  Package
                  <input value={packageName} onChange={(event) => setPackageName(event.target.value)} maxLength={214} required />
                </label>
                <label>
                  Exact version
                  <input value={version} onChange={(event) => setVersion(event.target.value)} maxLength={100} required />
                </label>
              </div>
              <label>
                Question
                <input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1000} required />
              </label>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? 'Investigating...' : 'Run investigation'}
              </button>
            </form>
          )}

          {projectId && (
            <div className="scan-form workspace-form">
              <h4>Investigation history</h4>
              {investigationHistory.length === 0 ? (
                <p className="scan-help">No saved investigations for this project yet.</p>
              ) : (
                investigationHistory.map((item) => (
                  <button
                    type="button"
                    className="secondary-button small-button"
                    key={item.id}
                    disabled={busy}
                    onClick={() => void openInvestigation(item.id)}
                  >
                    {new Date(item.created_at).toLocaleString()} · {item.package_name}@{item.version} · {item.status}
                  </button>
                ))
              )}
            </div>
          )}

          {error && <p className="scan-error" role="alert">{error}</p>}
          {investigation && (
            <div className="investigation-result" aria-live="polite">
              <div className="panel-header">
                <h4>Investigation {investigation.status}</h4>
                <span className="panel-tag">{investigation.evidence.length} OSV matches</span>
              </div>
              <p>{investigation.answer}</p>
              {investigation.evidence.length > 0 && (
                <ul className="mini-list">
                  {investigation.evidence.map((item) => (
                    <li key={`${item.source}-${item.id}`}>
                      {item.source}: {item.id}
                      {item.aliases.length > 0 && ` · ${item.aliases.join(', ')}`}
                      {item.summary && ` — ${item.summary}`}
                    </li>
                  ))}
                </ul>
              )}
              <ol className="event-timeline">
                {investigation.events.map((item) => (
                  <li key={item.id}>
                    <strong>{item.event_type}</strong>
                    {item.event_type === 'preflight.decision' && (
                      <span>
                        Decision: {String(item.payload.decision)} · policy {String(item.payload.policy_version)}
                      </span>
                    )}
                    {item.event_type === 'registry.metadata_received' && (
                      <span>Untrusted registry metadata recorded: {Object.keys(item.payload).join(', ')}</span>
                    )}
                    <time>{new Date(item.created_at).toLocaleString()}</time>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {savedScan && (
            <div className="investigation-result" aria-live="polite">
              <div className="panel-header">
                <h4>Saved scan results</h4>
                <span className="panel-tag">{savedScan.vulnerability_count} OSV matches</span>
              </div>
              <p>{savedScan.dependency_count} dependencies · {savedScan.checked_count} exact versions checked · {savedScan.unpinned_count} ranges unchecked</p>
              <ul className="mini-list">
                {savedScan.dependencies.map((dependency) => (
                  <li key={`${dependency.name}-${dependency.version}`}>
                    {dependency.name}@{dependency.version} — {dependency.status === 'checked' ? `${dependency.vulnerabilities.length} advisories` : 'version range unchecked'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
