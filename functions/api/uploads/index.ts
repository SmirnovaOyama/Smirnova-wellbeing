import { isAuthenticated, jsonResponse, unauthorized, type Env } from '../../_lib/auth'

// Raw-body upload rather than multipart: the browser sends the File directly
// with its own type, so there is no form to parse on either side.
const MAX_BYTES = 5 * 1024 * 1024

// An allowlist, not a block list — the extension is taken from this map, so a
// type that is not here can never reach the bucket.
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await isAuthenticated(request, env))) return unauthorized()

  const contentType = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  const extension = EXTENSIONS[contentType]
  if (!extension) {
    return jsonResponse({ error: 'Only PNG, JPEG, GIF, WebP and AVIF images can be uploaded' }, { status: 415 })
  }

  // Refuse oversized uploads on the header, before buffering the whole body.
  const declared = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return jsonResponse({ error: 'Images have to be 5 MB or smaller' }, { status: 413 })
  }

  const body = await request.arrayBuffer()
  if (body.byteLength === 0) {
    return jsonResponse({ error: 'The image is empty' }, { status: 400 })
  }
  if (body.byteLength > MAX_BYTES) {
    return jsonResponse({ error: 'Images have to be 5 MB or smaller' }, { status: 413 })
  }

  // Random key, never reused — which is what lets the GET route mark the object
  // immutable, and keeps an unreferenced image from being guessable.
  const month = new Date().toISOString().slice(0, 7)
  const key = `${month}/${crypto.randomUUID()}.${extension}`

  await env.IMAGES.put(key, body, { httpMetadata: { contentType } })

  return jsonResponse({ url: `/api/uploads/${key}` })
}
