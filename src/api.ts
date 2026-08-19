import type { Tier } from './data/metrics'

export interface ApiEntry {
  id: number
  metric_id: string
  /** YYYY-MM-DD, local. */
  date: string
  /** HH:MM, local. Several entries can share a date. */
  time: string
  /** null on a text-only entry, which carries a note instead of a grade. */
  tier: Tier | null
  note: string | null
  created_at: string
  updated_at: string
}

class ApiError extends Error {
  /** HTTP status, or 0 for a failure raised before the request went out. */
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// The session cookie lasts 30 days and can lapse mid-visit — or be signed out
// from another tab. Every response passes through here, so this is the one
// place that can notice and let the app drop back to the login screen instead
// of leaving a dashboard where every action fails.
let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

async function failure(res: Response, fallback: string): Promise<ApiError> {
  if (res.status === 401) onUnauthorized?.()
  const body = await res.json().catch(() => null)
  return new ApiError((body && body.error) || fallback, res.status)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    throw await failure(res, `Request failed with status ${res.status}`)
  }
  return res.json()
}

export function getSession(): Promise<{ authenticated: boolean }> {
  return request('/api/session')
}

/** Display config, stored server-side so the owner name survives a redeploy. */
export function getConfig(): Promise<{ owner: string }> {
  return request('/api/config')
}

export function setConfig(owner: string): Promise<{ owner: string }> {
  return request('/api/config', { method: 'PUT', body: JSON.stringify({ owner }) })
}

export function login(password: string): Promise<{ ok: true }> {
  return request('/api/login', { method: 'POST', body: JSON.stringify({ password }) })
}

export function logout(): Promise<{ ok: true }> {
  return request('/api/logout', { method: 'POST' })
}

export function getEntries(): Promise<{ entries: ApiEntry[] }> {
  return request('/api/entries')
}

export function createEntry(input: {
  metricId: string
  date: string
  time: string
  /** null records text only — the note is then required. */
  tier: Tier | null
  note?: string | null
}): Promise<{ entry: ApiEntry }> {
  return request('/api/entries', { method: 'POST', body: JSON.stringify(input) })
}

export function updateEntry(
  id: number,
  input: { tier?: Tier | null; time?: string; note?: string | null },
): Promise<{ entry: ApiEntry }> {
  return request(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function deleteEntry(id: number): Promise<{ ok: true }> {
  return request(`/api/entries/${id}`, { method: 'DELETE' })
}

/** Kept in step with MAX_BYTES in functions/api/uploads/index.ts, so an
 *  oversized file is refused before it is uploaded rather than after. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// Not routed through `request` above: the body is the raw File, sent with its
// own content type, so the JSON header that helper sets would be wrong.
export async function uploadImage(file: File): Promise<{ url: string }> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ApiError('Images have to be 5 MB or smaller', 0)
  }

  const res = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type },
    body: file,
  })

  if (!res.ok) {
    throw await failure(res, `Upload failed with status ${res.status}`)
  }
  return res.json()
}

export { ApiError }
