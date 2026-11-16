/**
 * Base URL of the DepShield backend.
 * VITE_API_BASE_URL (baked in at build time) wins. If a build forgot to set it,
 * production falls back to the hosted backend instead of the visitor's own localhost.
 */
const PRODUCTION_API = 'https://depshield-backend.onrender.com'
const DEV_API = 'http://localhost:8000'

export function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim()
  const url = configured || (import.meta.env.PROD ? PRODUCTION_API : DEV_API)
  return url.replace(/\/+$/, '')
}
