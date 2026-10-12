import { randomUUID } from 'node:crypto'
import { buildAuthorizeUrl, createPkce } from './pkce.mjs'

const ORIGIN = 'https://auth.openai.com'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REDIRECT_URI = 'http://localhost:1455/auth/callback'

export async function oneClickAuthorize({ email, readCode, fetchImpl = fetch, report = () => {}, securityHeaders = async () => ({}) }) {
  const { state, verifier, challenge } = createPkce()
  const cookies = new Map()
  const startedAt = new Date().toISOString()
  const deviceId = randomUUID()
  const authorizationUrl = buildAuthorizeUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI, state, challenge })

  const request = async (path, options = {}) => {
    const url = new URL(path, ORIGIN)
    const response = await fetchImpl(url, {
      redirect: 'manual',
      ...options,
      headers: {
        Accept: 'application/json, text/html',
        Origin: ORIGIN,
        ...(options.method === 'POST' ? {
          'Content-Type': 'application/json',
          'oai-device-id': deviceId,
          ...(await securityHeaders({ path: url.pathname, deviceId }))
        } : {}),
        ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(options.headers || {})
      }
    })
    for (const value of response.headers.getSetCookie?.() || []) {
      const [pair] = value.split(';')
      const [key, val] = pair.split('=')
      cookies.set(key, val)
    }
    return response
  }

  report('open_authorize_url', { authorizationUrl: authorizationUrl.href })
  let page = await request(authorizationUrl.href)
  let location = page.headers.get('location')
  if (location) page = await request(location)

  report('submit_email')
  // The email body is intentionally only the username. The current flow
  // authenticates the request with the session cookie, device ID, and provider
  // security headers. Do not invent `screen_hint`; the reference integration
  // removed that field.
  page = await request('/api/accounts/authorize/continue', {
    method: 'POST',
    body: JSON.stringify({
      username: { value: email, kind: 'email' }
    })
  })
  let data = await page.json()
  let next = data.continue_url || (data.page?.type === 'email_otp_verification' ? '/email-verification' : '/log-in/password')
  page = await request(next)

  if (new URL(page.url).pathname.includes('password')) {
    report('request_otp')
    page = await request('/api/accounts/passwordless/send-otp', { method: 'POST', body: '{}' })
    next = (await page.json()).continue_url || '/email-verification'
    page = await request(next)
  }
  if (!new URL(page.url).pathname.includes('email-verification')) throw new Error('The provider returned an unsupported login step')

  report('wait_otp')
  const code = await readCode({ since: startedAt, email })
  report('submit_otp')
  page = await request('/api/accounts/email-otp/validate', { method: 'POST', body: JSON.stringify({ code }) })
  data = await page.json()
  next = data.continue_url || '/sign-in-with-chatgpt/codex/consent'
  page = await request(next)

  // A real implementation must inspect the provider's consent form and select
  // a workspace ID returned by that form. Never invent an ID or silently fall
  // back to a different account.
  if (!new URL(page.url).pathname.includes('consent')) throw new Error('Consent page was not returned')
  throw new Error('Consent selection is provider-owned; inspect the form and POST its workspace_id before token exchange')
}

export { CLIENT_ID, REDIRECT_URI }
