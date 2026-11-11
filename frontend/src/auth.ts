import { createAuthClient } from '@neon/neon-js/auth'
import { BetterAuthReactAdapter } from '@neon/neon-js/auth/react/adapters'

const authUrl = import.meta.env.VITE_NEON_AUTH_URL?.trim()

export const authClient = authUrl
  ? createAuthClient(authUrl, {
      adapter: BetterAuthReactAdapter({
        fetchOptions: { credentials: 'include' },
      }),
    })
  : null

export async function authenticatedApiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!authClient) {
    throw new Error('Neon Auth is not configured in the frontend')
  }

  const sessionResult = await authClient.getSession({ query: {} })
  if (sessionResult.error) {
    throw new Error(sessionResult.error.message)
  }
  const token = sessionResult.data?.session?.token
  if (!token) {
    throw new Error('Sign in before using organization features')
  }

  const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  })
  const payload: unknown = response.status === 204 ? undefined : await response.json()
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'detail' in payload &&
      typeof payload.detail === 'string'
        ? payload.detail
        : 'The API request could not be completed'
    throw new Error(message)
  }
  return payload as T
}
