import { isAuthenticated, jsonResponse, unauthorized, type Env } from '../../_lib/auth'
import { DATE_PATTERN, METRIC_TIERS, TIME_PATTERN, type EntryRow } from '../../_lib/types'

// Reading entries is public by design — the homepage displays them to anyone
// without sign-in. Writing (below) still requires an authenticated admin session.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT * FROM entries ORDER BY date ASC, time ASC, id ASC',
  ).all<EntryRow>()
  return jsonResponse({ entries: results })
}

interface CreateBody {
  metricId?: string
  date?: string
  time?: string
  /** null or absent makes this a text-only entry, which then needs a note. */
  tier?: string | null
  note?: string | null
}

// A day holds as many check-ins as you make, so this always inserts a new row —
// correcting an earlier one goes through PATCH /api/entries/:id instead.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await isAuthenticated(request, env))) return unauthorized()

  let body: CreateBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Malformed request' }, { status: 400 })
  }

  const { metricId, date, time } = body
  const allowedTiers = metricId ? METRIC_TIERS[metricId] : undefined
  const tier = body.tier ?? null
  const note = typeof body.note === 'string' ? body.note.trim() : ''

  if (!metricId || !allowedTiers) {
    return jsonResponse({ error: 'Unknown metric' }, { status: 400 })
  }
  if (!date || !DATE_PATTERN.test(date)) {
    return jsonResponse({ error: 'Invalid date (expected YYYY-MM-DD)' }, { status: 400 })
  }
  if (!time || !TIME_PATTERN.test(time)) {
    return jsonResponse({ error: 'Invalid time (expected HH:MM)' }, { status: 400 })
  }
  if (tier !== null && !allowedTiers.has(tier)) {
    return jsonResponse({ error: 'Invalid grade' }, { status: 400 })
  }
  // Mirrors the CHECK in migration 0003 — without a grade the note is the whole
  // record, so an empty one would store a blank line.
  if (tier === null && note === '') {
    return jsonResponse({ error: 'An entry without a grade needs some text' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { meta } = await env.DB.prepare(
    `INSERT INTO entries (metric_id, date, time, tier, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(metricId, date, time, tier, note || null, now, now)
    .run()

  const entry = await env.DB.prepare('SELECT * FROM entries WHERE id = ?')
    .bind(meta.last_row_id)
    .first<EntryRow>()

  return jsonResponse({ entry })
}
