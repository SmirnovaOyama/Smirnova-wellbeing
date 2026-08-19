import { isAuthenticated, jsonResponse, unauthorized, type Env } from '../../_lib/auth'
import { METRIC_TIERS, TIME_PATTERN, VALID_TIERS, type EntryRow } from '../../_lib/types'

interface UpdateBody {
  /** Explicit null strips the grade, turning the row into a text-only entry. */
  tier?: string | null
  time?: string
  note?: string | null
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!(await isAuthenticated(request, env))) return unauthorized()

  const id = Number(params.id)
  if (!Number.isInteger(id)) {
    return jsonResponse({ error: 'Invalid id' }, { status: 400 })
  }

  let body: UpdateBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Malformed request' }, { status: 400 })
  }

  const existing = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>()
  if (!existing) {
    return jsonResponse({ error: 'Entry not found' }, { status: 404 })
  }

  // Which grades are legal depends on the metric this row belongs to.
  const allowedTiers = METRIC_TIERS[existing.metric_id] ?? VALID_TIERS
  if (body.tier !== undefined && body.tier !== null && !allowedTiers.has(body.tier)) {
    return jsonResponse({ error: 'Invalid grade' }, { status: 400 })
  }
  if (body.time !== undefined && !TIME_PATTERN.test(body.time)) {
    return jsonResponse({ error: 'Invalid time (expected HH:MM)' }, { status: 400 })
  }

  const now = new Date().toISOString()
  // `?? existing` would swallow an explicit null, which is exactly how the
  // grade gets stripped — so absence and null have to be told apart here.
  const tier = body.tier !== undefined ? body.tier : existing.tier
  const time = body.time ?? existing.time
  const rawNote = body.note !== undefined ? body.note : existing.note
  const note = rawNote?.trim() || null

  if (tier === null && note === null) {
    return jsonResponse({ error: 'An entry without a grade needs some text' }, { status: 400 })
  }

  await env.DB.prepare('UPDATE entries SET tier = ?, time = ?, note = ?, updated_at = ? WHERE id = ?')
    .bind(tier, time, note, now, id)
    .run()

  const entry = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>()
  return jsonResponse({ entry })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!(await isAuthenticated(request, env))) return unauthorized()

  const id = Number(params.id)
  if (!Number.isInteger(id)) {
    return jsonResponse({ error: 'Invalid id' }, { status: 400 })
  }

  const existing = await env.DB.prepare('SELECT id FROM entries WHERE id = ?').bind(id).first()
  if (!existing) {
    return jsonResponse({ error: 'Entry not found' }, { status: 404 })
  }

  await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run()

  return jsonResponse({ ok: true })
}
