import type { Env } from '../../_lib/auth'

// Public, like the notes these images are embedded in: the signed-out homepage
// renders the same entries, so an image behind the session check would break
// there. Keys are random, so nothing is enumerable.
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const key = Array.isArray(params.key) ? params.key.join('/') : params.key
  if (!key) return new Response('Not found', { status: 404 })

  const object = await env.IMAGES.get(key)
  if (!object) return new Response('Not found', { status: 404 })

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  // The key is random and an object is never overwritten, so what lives at this
  // URL cannot change.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')

  return new Response(object.body, { headers })
}
