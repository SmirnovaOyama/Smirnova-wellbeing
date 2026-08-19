import {
  verifyPassword,
  createSessionToken,
  sessionCookieHeader,
  isHttpsRequest,
  jsonResponse,
  type Env,
} from '../_lib/auth'

interface LoginBody {
  password?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: LoginBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Malformed request' }, { status: 400 })
  }

  if (!body.password) {
    return jsonResponse({ error: 'Password required' }, { status: 400 })
  }

  const valid = await verifyPassword(body.password, env.ADMIN_PASSWORD_HASH)
  if (!valid) {
    return jsonResponse({ error: 'Wrong password' }, { status: 401 })
  }

  const token = await createSessionToken(env.SESSION_SECRET)
  return jsonResponse({ ok: true }, { headers: { 'Set-Cookie': sessionCookieHeader(token, isHttpsRequest(request)) } })
}
