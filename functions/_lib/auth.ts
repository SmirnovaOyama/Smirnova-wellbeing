export interface Env {
  DB: D1Database
  ADMIN_PASSWORD_HASH: string
  SESSION_SECRET: string
  /** Name shown in the page title. Optional — see functions/api/config.ts. */
  SITE_OWNER?: string
  /** Images pasted into notes. See functions/api/uploads/. */
  IMAGES: R2Bucket
}

const PBKDF2_ITERATIONS = 100_000
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000
export const SESSION_COOKIE = 'session'

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
}

// Stored format: "<salt-hex>:<derived-key-hex>"
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await pbkdf2(password, salt)
  return `${toHex(salt)}:${toHex(derived)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const derived = await pbkdf2(password, fromHex(saltHex))
  return timingSafeEqual(toHex(derived), hashHex)
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return toHex(sig)
}

// Stateless session token: "<expiry-ms>.<hmac-signature>"
export async function createSessionToken(secret: string): Promise<string> {
  const expires = Date.now() + SESSION_DURATION_MS
  const sig = await hmac(secret, String(expires))
  return `${expires}.${sig}`
}

export async function verifySessionToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false
  const [expiresStr, sig] = token.split('.')
  if (!expiresStr || !sig) return false
  const expires = Number(expiresStr)
  if (!Number.isFinite(expires) || expires < Date.now()) return false
  const expected = await hmac(secret, expiresStr)
  return timingSafeEqual(expected, sig)
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex === -1) continue
    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

// The Secure attribute is only valid on https:// origins; local dev over
// plain http would otherwise have the cookie silently dropped by the browser.
export function sessionCookieHeader(token: string, secure: boolean): string {
  const secureAttr = secure ? ' Secure;' : ''
  return `${SESSION_COOKIE}=${token}; HttpOnly;${secureAttr} SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`
}

export function clearSessionCookieHeader(secure: boolean): string {
  const secureAttr = secure ? ' Secure;' : ''
  return `${SESSION_COOKIE}=; HttpOnly;${secureAttr} SameSite=Strict; Path=/; Max-Age=0`
}

export function isHttpsRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
}

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const cookies = parseCookies(request.headers.get('Cookie'))
  return verifySessionToken(cookies[SESSION_COOKIE], env.SESSION_SECRET)
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
}

export function unauthorized(): Response {
  return jsonResponse({ error: 'Not signed in, or the session has expired' }, { status: 401 })
}
