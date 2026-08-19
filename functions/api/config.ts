import { isAuthenticated, jsonResponse, unauthorized, type Env } from '../_lib/auth'

const OWNER_KEY = 'owner'
// Kept in step with the frontend fallback in src/App.tsx, which is what renders
// while this request is still in flight.
const DEFAULT_OWNER = 'Smirnova'
const MAX_OWNER_LENGTH = 40

// Three layers, most specific first: what the dashboard saved, then the
// SITE_OWNER env var as a seed for a fresh database, then the built-in default.
async function readOwner(env: Env): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(OWNER_KEY)
    .first<{ value: string }>()
  return row?.value.trim() || env.SITE_OWNER?.trim() || DEFAULT_OWNER
}

// Public on purpose: the signed-out homepage shows the same title, so this
// cannot sit behind the session check. Nothing secret is exposed — the name is
// already printed at the top of every page.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return jsonResponse({ owner: await readOwner(env) })
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await isAuthenticated(request, env))) return unauthorized()

  let body: { owner?: string }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Malformed request' }, { status: 400 })
  }

  const owner = body.owner?.trim() ?? ''
  if (!owner) {
    return jsonResponse({ error: 'The name cannot be empty' }, { status: 400 })
  }
  if (owner.length > MAX_OWNER_LENGTH) {
    return jsonResponse({ error: `The name cannot be longer than ${MAX_OWNER_LENGTH} characters` }, { status: 400 })
  }

  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(OWNER_KEY, owner, new Date().toISOString())
    .run()

  return jsonResponse({ owner })
}
