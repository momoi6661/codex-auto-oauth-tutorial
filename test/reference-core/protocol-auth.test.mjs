import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Response } from 'node-fetch'
import { authorizeWithProtocol } from '../../src/reference-core/protocol-auth.mjs'
import { executeScript } from '../../src/reference-core/executor.mjs'
import { matchMailboxMessage } from '../../src/reference-core/imap-code.mjs'
import { sentinelSDK } from './sentinel-fixture.mjs'

const origin = 'https://auth.openai.com'
const callback = 'http://localhost:1455/auth/callback'
const jwt = value => `header.${Buffer.from(JSON.stringify(value)).toString('base64url')}.signature`
const json = (data, headers = {}) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', ...headers } })
const redirect = location => new Response(null, { status: 302, headers: { location } })
const makeTask = (context = {}) => ({ mode: 'oauth_protocol', resultType: 'code', script: "return { type: 'code', code: '123456' }", context: { loginEmail: 'owner@example.com', since: new Date().toISOString(), ...context } })

// Emulates a provider across real cookie/session boundaries; no live credentials.
function provider(options = {}) {
  let auth, sentCode = false, sentinelCalls = 0, deviceID
  const requests = [], stages = [], reads = []
  const fetch = async (target, init) => {
    const url = new URL(target)
    requests.push({ url, init })
    assert.equal(init.redirect, 'manual')
    if (url.origin === 'https://sentinel.openai.com') {
      assert.equal(init.headers.Cookie, undefined, 'OAuth cookies must not be forwarded to Sentinel')
      if (url.pathname.endsWith('/sdk.js')) return new Response(sentinelSDK, { headers: { 'content-type': 'application/javascript' } })
      assert.equal(url.pathname, '/backend-api/sentinel/req')
      const payload = JSON.parse(init.body)
      assert.equal(payload.flow, 'authorize_continue')
      assert.equal(payload.p, 'gAAAAACrequirements')
      deviceID ||= payload.id
      assert.equal(payload.id, deviceID)
      return json({ token: `challenge-${++sentinelCalls}`, proofofwork: { required: true },
        turnstile: { required: true, dx: 'fixture-challenge' }, so: { required: true } })
    }
    assert.equal(url.origin, origin)
    if (url.pathname === '/oauth/authorize') {
      auth = url
      assert.equal(auth.searchParams.get('code_challenge_method'), 'S256')
      assert.equal(auth.searchParams.get('redirect_uri'), callback)
      assert.match(auth.searchParams.get('state'), /^[\w-]{32}$/)
      if (options.challenge) return new Response('<title>Just a moment</title>', { status: 403 })
      return redirect('/log-in')
    }
    if (url.pathname === '/log-in') {
      const response = new Response('<html><script src="/sentinel.js"></script>Log in</html>', { headers: { 'set-cookie': 'login_session=fresh; Secure; HttpOnly; Path=/' } })
      response.headers.append('set-cookie', 'oai-did=test-device; Secure; Path=/')
      return response
    }
    assert.match(init.headers.Cookie || '', /login_session=fresh/)
    if (init.method === 'POST' && url.pathname.startsWith('/api/')) assert.equal(init.headers.Origin, origin)
    if (init.method === 'POST' && /authorize\/continue|send-otp|email-otp/.test(url.pathname)) {
      const sentinel = JSON.parse(init.headers['openai-sentinel-token'])
      assert.equal(sentinel.c, `challenge-${sentinelCalls}`, 'each protected step needs fresh evidence')
      assert.equal(sentinel.p, `gAAAAABproof-${sentinel.c}`)
      assert.equal(sentinel.id, init.headers['oai-device-id'])
      assert.equal(sentinel.id, deviceID)
      assert.equal(sentinel.t, 'turnstile-evidence')
      assert.equal(JSON.parse(init.headers['openai-sentinel-so-token']).c, sentinel.c)
      assert.match(init.headers.Cookie, new RegExp(`oai-did=${deviceID}`))
    }
    if (url.pathname === '/api/accounts/authorize/continue') {
      assert.deepEqual(JSON.parse(init.body), { username: { value: 'owner@example.com', kind: 'email' } })
      if (options.signup) return json({ continue_url: '/about-you' })
      if (options.pageType) return json({ page: { type: options.pageType } })
      if (options.sentinel) return json({ error: { code: 'sentinel_required' } })
      if (options.passwordRedirect) return json({ continue_url: '/login-route' })
      if (options.password) return json({ continue_url: '/log-in/password', page: { type: 'password' } })
      sentCode = true
      if (url.pathname === '/api/accounts/email-otp/resend') return json({ success: true })
      return json({ continue_url: '/email-verification' })
    }
    if (url.pathname === '/login-route') return redirect('/log-in/password')
    if (url.pathname === '/log-in/password') return new Response('<html>Password or email code</html>', { headers: { 'set-cookie': 'oai-did=test-device; Secure; Path=/' } })
    if (url.pathname === '/api/accounts/passwordless/send-otp' || url.pathname === '/api/accounts/email-otp/resend') {
      if (init.headers.Referer.endsWith('/log-in/password')) assert.equal(init.headers['oai-device-id'], 'test-device')
      else assert.equal(init.headers.Referer, origin + '/email-verification')
      if (options.sendRejected) return new Response('private credentials', { status: 403 })
      if (options.htmlSendResponse) return new Response('<html>Provider error</html>', { headers: { 'content-type': 'text/html' } })
      if (options.codeUnavailable) return json({ continue_url: '/log-in/password' })
      sentCode = true
      if (options.emptySendResponse) return new Response(null)
      return json({ page: { type: 'email_otp_verification' } })
    }
    if (url.pathname === '/email-verification') return new Response('<html>Email code</html>')
    if (url.pathname === '/api/accounts/email-otp/validate') {
      assert.equal(JSON.parse(init.body).code, '123456')
      if (options.codeRejected) return new Response('private token and email', { status: 400 })
      if (options.signupAfterCode) return json({ continue_url: '/about-you' })
      if (options.external) return json({ continue_url: 'https://elsewhere.example/private' })
      if (options.consentHTML) return json({ continue_url: '/sign-in-with-chatgpt/codex/consent' })
      if (options.workspaces) return json({ continue_url: '/sign-in-with-chatgpt/codex/consent' }, { 'set-cookie': `oai-client-auth-session=${options.encodedCookie ? encodeURIComponent(JSON.stringify(jwt({ workspaces: options.workspaces }))) : options.firstSegmentCookie ? Buffer.from(JSON.stringify({ workspaces: options.workspaces })).toString('base64url') + '.signature' : jwt({ workspaces: options.workspaces })}; Secure; Path=${options.cookiePath || '/'}` })
      return json({ continue_url: `${callback}?code=oauth-code&state=${options.badState ? 'different' : auth.searchParams.get('state')}` })
    }
    if (url.pathname === '/sign-in-with-chatgpt/codex/consent') {
      if (options.personalConsent && init.method === 'POST') {
        const form = new URLSearchParams(init.body)
        assert.equal(form.get('csrf'), 'test-csrf')
        assert.equal(form.get('intent'), 'allow')
        assert.equal(form.has('workspace_id'), false)
        return redirect(`${callback}?code=oauth-code&state=${auth.searchParams.get('state')}`)
      }
      return new Response(options.consentHTML || '<html>Consent</html>')
    }
    if (url.pathname === '/api/accounts/workspace/select') {
      assert.equal(JSON.parse(init.body).workspace_id, options.expectedWorkspace)
      return json({ continue_url: `${callback}?code=oauth-code&state=${auth.searchParams.get('state')}` })
    }
    if (url.pathname === '/oauth/token') {
      const form = new URLSearchParams(init.body)
      assert.equal(form.get('code'), 'oauth-code')
      assert.equal(form.get('grant_type'), 'authorization_code')
      assert.equal(form.get('redirect_uri'), callback)
      assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'))
      assert.equal(form.get('client_id'), auth.searchParams.get('client_id'))
      return json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600,
        id_token: jwt({ email: options.wrongEmail ? 'other@example.com' : 'owner@example.com', 'https://api.openai.com/auth': { chatgpt_account_id: options.accountID || 'account-1' } }), ...options.tokenOverrides })
    }
    throw Error(`Unexpected request ${url.pathname}`)
  }
  const reader = async task => {
    reads.push(task)
    if (task.operation === 'mailbox_snapshot') {
      assert.equal(requests.length, 0, 'snapshot must precede code delivery')
      return { type: 'mailbox_snapshot', uidNext: 42, uidValidity: 'same' }
    }
    assert.equal(sentCode, true, 'only read after provider enters email verification')
    if (task.mailbox) { assert.equal(task.mailbox.minUID, 42); assert.equal(task.mailbox.uidValidity, 'same') }
    if (options.readerError) return options.readerError
    return { type: 'code', code: '123456' }
  }
  return { fetch, reader, requests, reads, stages, report: stage => stages.push(stage) }
}

test('API code -> isolated cookies -> PKCE -> one authorization file', async () => {
  const mock = provider()
  const result = await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.type, 'auth_file', JSON.stringify(result))
  const auth = JSON.parse(result.auth)
  assert.equal(auth.email, 'owner@example.com')
  assert.equal(auth.account_id, 'account-1')
  assert.equal(auth.type, 'codex')
  assert.ok(Date.parse(auth.expired) > Date.now())
  assert.equal(auth.expires_at, auth.expired, 'panel importer must receive its supported expiry field')
  assert.equal(mock.reads.length, 1)
  assert.deepEqual(mock.stages, ['protocol_start', 'email_login', 'requesting_code', 'waiting_code', 'submitting_code', 'token_exchange'])
})

test('proxy failures stop login without leaking credentials or reading codes', async () => {
  const task = { ...makeTask(), proxyURL: 'http://user:private-password@proxy.example:8080' }
  let reads = 0
  const reader = async () => { reads++; return { type: 'code', code: '123456' } }
  for (const fetch of [
    async () => new Response('', { status: 407 }),
    async () => { throw Object.assign(new Error(task.proxyURL), { code: 'PROXY_CONNECTION_FAILED' }) }
  ]) {
    const result = await authorizeWithProtocol(task, reader, undefined, undefined, fetch)
    assert.match(result.error.code, /^PROXY_(AUTH|CONNECTION)_FAILED$/)
    assert.doesNotMatch(result.error.message, /private-password/)
  }
  assert.equal(reads, 0)
})

test('IMAP captures a new UID boundary before protocol login', async () => {
  const mock = provider(), task = { ...makeTask(), mailbox: { host: 'imap.example.com' } }
  const result = await authorizeWithProtocol(task, mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.type, 'auth_file')
  assert.equal(mock.stages[0], 'mailbox_connect')
  assert.equal(mock.reads.length, 2)
  assert.equal(task.mailbox.minUID, undefined, 'input task must not be mutated')
})

for (const seconds of [30, 45]) test(`resends once after ${seconds} seconds while keeping the mailbox reader and snapshot`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const mock = provider()
  let started, deliver
  const ready = new Promise(resolve => { started = resolve })
  const code = new Promise(resolve => { deliver = resolve })
  let reads = 0
  const reader = async (task, options) => {
    if (task.operation === 'mailbox_snapshot') return mock.reader(task)
    reads++
    assert.equal(task.mailbox.minUID, 42)
    assert.ok(options.timeout > 60000)
    started()
    return code
  }
  const fetch = async (url, init) => {
    const response = await mock.fetch(url, init)
    if (new URL(url).pathname === '/api/accounts/email-otp/resend') deliver({ type: 'code', code: '123456' })
    return response
  }
  const pending = authorizeWithProtocol({ ...makeTask(), ...(seconds === 30 ? {} : { resendAfterSeconds: seconds }), mailbox: { host: 'imap.example.com' } }, reader, undefined, mock.report, fetch)
  await ready
  t.mock.timers.tick(seconds * 1000 - 1)
  assert.equal(mock.requests.filter(r => r.url.pathname.endsWith('/resend')).length, 0)
  t.mock.timers.tick(1)
  assert.equal((await pending).type, 'auth_file')
  assert.equal(reads, 1)
  assert.equal(mock.requests.filter(r => r.url.pathname.endsWith('/resend')).length, 1)
})

test('password page switches to email-code protocol without submitting a password', async () => {
  const mock = provider({ password: true })
  assert.equal((await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)).type, 'auth_file')
  assert.equal(mock.requests.filter(r => r.url.pathname === '/api/accounts/passwordless/send-otp').length, 1)
})

test('successful empty OTP send response continues to email verification', async () => {
  const mock = provider({ password: true, emptySendResponse: true })
  assert.equal((await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)).type, 'auth_file')
  assert.equal(mock.reads.length, 1)
})

test('HTML from an OTP API is rejected before waiting for an email', async () => {
  const mock = provider({ password: true, htmlSendResponse: true })
  const result = await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.error.code, 'PROVIDER_INVALID_RESPONSE')
  assert.equal(result.error.httpStatus, 200)
  assert.equal(mock.reads.length, 0)
})

test('redirected password page switches to email code using its session cookies', async () => {
  const mock = provider({ passwordRedirect: true })
  assert.equal((await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)).type, 'auth_file')
  assert.equal(mock.requests.filter(r => r.url.pathname === '/api/accounts/passwordless/send-otp').length, 1)
  assert.equal(mock.requests.some(r => r.url.pathname === '/api/accounts/password/verify'), false)
  assert.equal(mock.reads.length, 1)
})

test('email-code refusal stops before reading mail or submitting a password', async () => {
  for (const options of [{ sendRejected: true }, { codeUnavailable: true }]) {
    const mock = provider({ password: true, ...options })
    const result = await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)
    assert.equal(result.error.code, options.sendRejected ? 'CODE_REQUEST_FAILED' : 'EMAIL_CODE_UNAVAILABLE')
    if (options.sendRejected) assert.equal(result.error.httpStatus, 403)
    assert.equal(mock.reads.length, 0)
    assert.equal(mock.requests.some(r => r.url.pathname === '/api/accounts/password/verify'), false)
  }
})

for (const options of [{ signup: true }, { signupAfterCode: true }, { pageType: 'create_account' }]) {
  test(`never registers accounts: ${JSON.stringify(options)}`, async () => {
    const mock = provider(options)
    const result = await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)
    assert.equal(result.error.code, 'ACCOUNT_NOT_REGISTERED')
    assert.equal(mock.requests.some(r => /register|create_account|about-you/.test(r.url.pathname)), false)
    assert.equal(mock.requests.some(r => r.url.pathname === '/oauth/token'), false)
  })
}

for (const options of [{ challenge: true }, { sentinel: true }, { pageType: 'phone_otp_verification' }]) {
  test(`manual verification stops without reading codes: ${JSON.stringify(options)}`, async () => {
    const mock = provider(options)
    const result = await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)
    assert.equal(result.error.code, options.pageType ? 'MANUAL_REQUIRED' : 'PROVIDER_SECURITY_CHALLENGE')
    if (options.challenge) assert.equal(result.error.httpStatus, 403)
    assert.equal(mock.reads.length, 0)
  })
}

test('bad callback state is rejected before token exchange', async () => {
  const mock = provider({ badState: true })
  const result = await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.error.code, 'OAUTH_CALLBACK_INVALID')
  assert.equal(mock.requests.some(r => r.url.pathname === '/oauth/token'), false)
})

test('rejects external redirects without sending provider cookies there', async () => {
  const mock = provider({ external: true })
  assert.equal((await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)).error.code, 'OAUTH_REDIRECT_INVALID')
})

test('invalid code fails once, never resends or leaks upstream body', async () => {
  const mock = provider({ codeRejected: true })
  const result = await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.error.code, 'CODE_SUBMIT_FAILED')
  assert.equal(result.error.httpStatus, 400)
  assert.equal(mock.reads.length, 1)
  assert.equal(mock.requests.filter(r => r.url.pathname === '/api/accounts/email-otp/validate').length, 1)
  assert.doesNotMatch(result.error.message, /private|token and email/)
})

test('mailbox failure is preserved without submitting a code', async () => {
  const error = { type: 'error', error: { code: 'MAILBOX_TIMEOUT', message: 'No new code', retryable: true } }
  const mock = provider({ readerError: error })
  assert.deepEqual(await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch), error)
  assert.equal(mock.requests.some(r => r.url.pathname === '/api/accounts/email-otp/validate'), false)
})

test('selects the existing account workspace rather than another workspace', async () => {
  const mock = provider({ workspaces: [{ id: 'other' }, { id: 'account-1' }], expectedWorkspace: 'account-1' })
  assert.equal((await authorizeWithProtocol(makeTask({ expectedAccountID: 'account-1' }), mock.reader, undefined, mock.report, mock.fetch)).type, 'auth_file')
})

test('new accounts use the first offered workspace when none is marked personal', async () => {
  const mock = provider({ workspaces: [{ id: 'account-1' }, { id: 'other' }], expectedWorkspace: 'account-1' })
  assert.equal((await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)).type, 'auth_file')
})

for (const personal of [{ is_personal: true }, { title: 'Personal' }, { name: '个人' }, { type: 'personal' }]) test(`skips the personal workspace: ${JSON.stringify(personal)}`, async () => {
  const mock = provider({ workspaces: [{ id: 'personal', ...personal }, { id: 'account-1' }], expectedWorkspace: 'account-1' })
  assert.equal((await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)).type, 'auth_file')
})

for (const cookieOptions of [{ cookiePath: '/sign-in-with-chatgpt' }, { firstSegmentCookie: true }, { encodedCookie: true }]) test(`reads consent-session cookie variants: ${JSON.stringify(cookieOptions)}`, async () => {
  const mock = provider({ workspaces: [{ id: 'account-1' }], expectedWorkspace: 'account-1', ...cookieOptions })
  assert.equal((await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)).type, 'auth_file')
})

for (const options of [{ workspaces: [] }, { workspaces: [null, {}, { id: '' }] }, { workspaces: [{ id: 'other' }], missingExpected: true }]) test(`unavailable workspace gives a precise error without selecting another account: ${JSON.stringify(options)}`, async () => {
  const mock = provider(options)
  const result = await authorizeWithProtocol(makeTask(options.missingExpected ? { expectedAccountID: 'account-1' } : {}), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.error.code, options.missingExpected ? 'WORKSPACE_ID_MISMATCH' : 'WORKSPACE_LIST_UNAVAILABLE')
  assert.equal(mock.requests.some(r => r.url.pathname === '/api/accounts/workspace/select'), false)
})

for (const options of [{ wrongEmail: true }, { accountID: 'wrong-account' }]) {
  test(`rejects identity mismatch: ${JSON.stringify(options)}`, async () => {
    const mock = provider(options)
    assert.equal((await authorizeWithProtocol(makeTask({ expectedAccountID: 'account-1' }), mock.reader, undefined, mock.report, mock.fetch)).error.code, 'IDENTITY_MISMATCH')
  })
}

test('incomplete token response does not return an auth file', async () => {
  const mock = provider({ tokenOverrides: { refresh_token: null } })
  assert.equal((await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)).error.code, 'TOKEN_EXCHANGE_FAILED')
})

test('cancellation during code reading prevents any code submission', async () => {
  const mock = provider(), controller = new AbortController()
  const reader = async () => { controller.abort(); return { type: 'code', code: '123456' } }
  assert.equal((await authorizeWithProtocol(makeTask(), reader, controller.signal, mock.report, mock.fetch)).error.code, 'TASK_CANCELLED')
  assert.equal(mock.requests.some(r => r.url.pathname === '/api/accounts/email-otp/validate'), false)
})

test('parallel logins have different state/verifier and isolated cookies', async () => {
  const mocks = [provider(), provider()]
  const results = await Promise.all(mocks.map(mock => authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)))
  assert.ok(results.every(result => result.type === 'auth_file'))
  assert.notEqual(mocks[0].requests[0].url.searchParams.get('state'), mocks[1].requests[0].url.searchParams.get('state'))
  assert.notEqual(mocks[0].requests[0].url.searchParams.get('code_challenge'), mocks[1].requests[0].url.searchParams.get('code_challenge'))
  assert.ok(mocks.every(mock => !mock.requests[0].init.headers.Cookie))
})


test('shared mailbox matches recipient and delivery time without accepting another account code', () => {
  const task = { ...makeTask(), mailbox: { codePattern: '\\b(\\d{6})\\b' } }
  const parsed = { to: { value: [{ address: 'owner@example.com' }] }, headers: new Map(), subject: 'OpenAI code 123456' }
  assert.equal(matchMailboxMessage(parsed, new Date(), task), '123456')
  assert.equal(matchMailboxMessage({ ...parsed, to: { value: [{ address: 'other@example.com' }] } }, new Date(), task), null)
  assert.equal(matchMailboxMessage(parsed, new Date(Date.parse(task.context.since) - 1000), task), null)
})

test('cancelling a mailbox script terminates its child process promptly', async () => {
  const controller = new AbortController()
  const result = executeScript({ ...makeTask(), script: 'await new Promise(() => {});' }, { signal: controller.signal })
  controller.abort()
  assert.equal((await result).error.code, 'TASK_CANCELLED')
})

for (const ending of ['success', 'failure', 'cancel', 'deadline']) test(`${ending} clears the pending email resend and aborts the reader`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const mock = provider(), controller = new AbortController()
  let readerSignal
  const reader = async (_task, options) => {
    readerSignal = options.signal
    if (ending === 'cancel') controller.abort()
    if (ending === 'deadline') controller.abort(new DOMException('deadline', 'TimeoutError'))
    return ending === 'failure' ? { type: 'error', error: { code: 'MAILBOX_UNAVAILABLE', message: 'unavailable' } } : { type: 'code', code: '123456' }
  }
  const result = await authorizeWithProtocol(makeTask(), reader, controller.signal, mock.report, mock.fetch)
  if (ending === 'success') assert.equal(result.type, 'auth_file')
  else assert.equal(result.error.code, { failure: 'MAILBOX_UNAVAILABLE', cancel: 'TASK_CANCELLED', deadline: 'AUTH_TIMEOUT' }[ending])
  assert.ok(readerSignal.aborted)
  t.mock.timers.tick(600000)
  await Promise.resolve()
  assert.equal(mock.requests.some(r => r.url.pathname.endsWith('/resend')), false)
})

for (const known of [false, true]) test(`personal-only sessions can authorize (known ID: ${known})`, async () => {
  const mock = provider({ workspaces: [{ id: 'account-1', is_personal: true }], expectedWorkspace: 'account-1' })
  const result = await authorizeWithProtocol(makeTask(known ? { expectedAccountID: 'account-1' } : {}), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.type, 'auth_file')
})

for (const workspaces of [
  [{ id: 'personal', is_personal: true }, { id: 'team-a' }, { id: 'account-1' }],
  [{ id: 'personal-a', is_personal: true }, { id: 'account-1', is_personal: true }]
]) test(`account index selects the second eligible workspace: ${JSON.stringify(workspaces)}`, async () => {
  const mock = provider({ workspaces, expectedWorkspace: 'account-1' })
  assert.equal((await authorizeWithProtocol(makeTask({ workspaceIndex: 2 }), mock.reader, undefined, mock.report, mock.fetch)).type, 'auth_file')
})

test('an out-of-range index never falls back to personal or the first workspace', async () => {
  const mock = provider({ workspaces: [{ id: 'personal', is_personal: true }, { id: 'account-1' }] })
  const result = await authorizeWithProtocol(makeTask({ workspaceIndex: 2 }), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.error.code, 'WORKSPACE_INDEX_OUT_OF_RANGE')
  assert.equal(mock.requests.some(r => r.url.pathname === '/api/accounts/workspace/select'), false)
})

for (const workspaceIndex of [-1, 1.5, '2']) test(`invalid workspace index stops before login: ${workspaceIndex}`, async () => {
  const mock = provider()
  assert.equal((await authorizeWithProtocol(makeTask({ workspaceIndex }), mock.reader, undefined, mock.report, mock.fetch)).error.code, 'INVALID_WORKSPACE_INDEX')
  assert.equal(mock.requests.length, 0)
})

test('reauthorization keeps the existing workspace ID when list order changes', async () => {
  const mock = provider({ workspaces: [{ id: 'team-other' }, { id: 'account-1' }], expectedWorkspace: 'account-1' })
  assert.equal((await authorizeWithProtocol(makeTask({ workspaceIndex: 1, expectedAccountID: 'account-1' }), mock.reader, undefined, mock.report, mock.fetch)).type, 'auth_file')
})

test('a token for a different workspace cannot replace the selected team identity', async () => {
  const mock = provider({ workspaces: [{ id: 'account-1' }], expectedWorkspace: 'account-1', accountID: 'personal-id' })
  assert.equal((await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)).error.code, 'IDENTITY_MISMATCH')
})

const modernConsent = `<form action="/sign-in-with-chatgpt/codex/consent" method="post">
<input type="hidden" name="csrf" value="test-csrf">
<input type="radio" name="workspace_id" value="personal" id="personal"><label for="personal">Personal</label>
<label>Team A<input type="radio" name="workspace_id" value="team-a"></label>
<input type="radio" name="workspace_id" value="account-1" id="team-b"><label for="team-b">Team B</label>
<button type="submit">Continue</button></form>`

test('modern consent HTML without a legacy cookie supplies the configured team to workspace selection', async () => {
  const mock = provider({ consentHTML: modernConsent, expectedWorkspace: 'account-1' })
  assert.equal((await authorizeWithProtocol(makeTask({ workspaceIndex: 2 }), mock.reader, undefined, mock.report, mock.fetch)).type, 'auth_file')
  assert.equal(mock.requests.filter(r => r.url.pathname === '/api/accounts/workspace/select').length, 1)
})

test('an external consent form cannot receive the workspace or session credentials', async () => {
  const mock = provider({ consentHTML: modernConsent.replace('action="/sign-in-with-chatgpt/codex/consent"', 'action="https://other.example/consent"') })
  assert.equal((await authorizeWithProtocol(makeTask(), mock.reader, undefined, mock.report, mock.fetch)).error.code, 'WORKSPACE_LIST_UNAVAILABLE')
  assert.equal(mock.requests.some(r => r.url.pathname === '/sign-in-with-chatgpt/codex/consent' && r.init.method === 'POST'), false)
})

for (const workspaceIndex of [0, 1, 4]) test(`personal-only sessions fall back to personal with index ${workspaceIndex}`, async () => {
  const mock = provider({ workspaces: [{ id: 'account-1', is_personal: true }], expectedWorkspace: 'account-1' })
  const result = await authorizeWithProtocol(makeTask({ workspaceIndex }), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.type, 'auth_file')
})
test('zero explicitly selects personal even with teams available', async () => {
  const mock = provider({ workspaces: [{ id: 'team-a' }, { id: 'account-1', is_personal: true }], expectedWorkspace: 'account-1' })
  const result = await authorizeWithProtocol(makeTask({ workspaceIndex: 0 }), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.type, 'auth_file')
})

for (const workspaceIndex of [0, 1]) test(`personal consent without a workspace picker completes with index ${workspaceIndex}`, async () => {
  const mock = provider({ workspaces: [], personalConsent: true, consentHTML: '<form method="post"><input type="hidden" name="csrf" value="test-csrf"><button type="submit" name="intent" value="allow">Continue</button></form>' })
  const result = await authorizeWithProtocol(makeTask({ workspaceIndex }), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.type, 'auth_file', JSON.stringify(result))
  assert.equal(mock.requests.some(r => r.url.pathname === '/api/accounts/workspace/select'), false)
})

for (const marker of [{ structure: 'personal' }, { workspace_type: 'personal' }, { type: 'PERSONAL' }]) test(`personal-only fallback recognizes provider metadata ${JSON.stringify(marker)}`, async () => {
  const mock = provider({ workspaces: [{ id: 'account-1', ...marker }], expectedWorkspace: 'account-1' })
  const result = await authorizeWithProtocol(makeTask({ workspaceIndex: 0 }), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.type, 'auth_file', JSON.stringify(result))
})
test('a missing legacy team falls back to the only personal workspace and validates the selected ID', async () => {
  const mock = provider({ workspaces: [{ id: 'account-1', structure: 'personal' }], expectedWorkspace: 'account-1' })
  const result = await authorizeWithProtocol(makeTask({ expectedAccountID: 'old-team' }), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.type, 'auth_file', JSON.stringify(result))
})
test('disabled teams do not block fallback to personal', async () => {
  const mock = provider({ workspaces: [{ id: 'unavailable-team', disabled: true }, { id: 'account-1', structure: 'personal' }], expectedWorkspace: 'account-1' })
  const result = await authorizeWithProtocol(makeTask({ workspaceIndex: 1 }), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.type, 'auth_file', JSON.stringify(result))
})

test('personal consent without a picker replaces an unavailable legacy team without requesting workspace selection', async () => {
  const mock = provider({ personalConsent: true, consentHTML: '<form method="post"><input type="hidden" name="csrf" value="test-csrf"><button type="submit" name="intent" value="allow">Continue</button></form>' })
  const result = await authorizeWithProtocol(makeTask({ workspaceIndex: 4, expectedAccountID: 'old-team' }), mock.reader, undefined, mock.report, mock.fetch)
  assert.equal(result.type, 'auth_file', JSON.stringify(result))
  assert.equal(mock.requests.some(r => r.url.pathname === '/api/accounts/workspace/select'), false)
})
