import test from 'node:test'
import assert from 'node:assert/strict'
import { Response } from 'node-fetch'
import { createSentinel } from '../../src/reference-core/sentinel.mjs'
import { browserHeaders } from '../../src/reference-core/browser-profile.mjs'
import { sentinelSDK } from './sentinel-fixture.mjs'

function provider(options = {}) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    assert.equal(new URL(url).origin, 'https://sentinel.openai.com')
    assert.equal(init.redirect, 'manual')
    assert.equal(init.headers['User-Agent'], browserHeaders['User-Agent'])
    assert.equal(init.headers.Cookie, undefined)
    if (url.endsWith('/sdk.js')) return new Response(options.sdk ?? sentinelSDK,
      { headers: { 'content-type': options.sdkContentType ?? 'application/javascript' } })
    if (options.requestStatus) return new Response('<html>private provider details</html>', { status: options.requestStatus })
    if (options.htmlResponse) return new Response('<html>private provider details</html>')
    options.beforeResponse?.()
    const body = JSON.parse(init.body)
    assert.equal(body.id, 'test-device')
    assert.equal(body.p, 'gAAAAACrequirements')
    return new Response(JSON.stringify(options.challenge ?? {
      token: `challenge-${calls.length}`, proofofwork: { required: true },
      turnstile: { required: true, dx: 'provider-bytecode' }, so: { required: true }
    }), { headers: { 'content-type': 'application/json' } })
  }
  return { fetch, calls }
}

test('fresh challenge, proof and observer evidence remain bound to the device and flow', async () => {
  const mock = provider()
  const sentinel = await createSentinel(mock.fetch, { deviceID: 'test-device' })
  try {
    const first = await sentinel.headers()
    const second = await sentinel.headers()
    const a = JSON.parse(first['openai-sentinel-token']), b = JSON.parse(second['openai-sentinel-token'])
    assert.notEqual(a.c, b.c)
    assert.equal(a.p, `gAAAAABproof-${a.c}`)
    assert.equal(a.id, 'test-device')
    assert.equal(a.flow, 'authorize_continue')
    assert.equal(a.t, 'turnstile-evidence')
    assert.equal(JSON.parse(first['openai-sentinel-so-token']).c, a.c)
    assert.equal(mock.calls.filter(call => call.url.endsWith('/sdk.js')).length, 1)
  } finally { sentinel.close() }
})

for (const status of [403, 429, 503]) {
  test(`preserves Sentinel HTTP ${status} without fabricating a token`, async () => {
    const mock = provider({ requestStatus: status })
    const sentinel = await createSentinel(mock.fetch, { deviceID: 'test-device' })
    try {
      await assert.rejects(sentinel.headers(), error => {
        assert.equal(error.result.error.code, 'SENTINEL_REQUEST_FAILED')
        assert.equal(error.result.error.httpStatus, status)
        assert.equal(error.result.error.retryable, status !== 403)
        assert.doesNotMatch(error.message, /private provider/)
        return true
      })
    } finally { sentinel.close() }
  })
}

for (const options of [{ htmlResponse: true }, { challenge: {} }, { challenge: [] }]) {
  test(`rejects malformed Sentinel challenge: ${JSON.stringify(options)}`, async () => {
    const sentinel = await createSentinel(provider(options).fetch, { deviceID: 'test-device' })
    try { await assert.rejects(sentinel.headers(), error => error.result.error.code === 'SENTINEL_INVALID_RESPONSE') }
    finally { sentinel.close() }
  })
}

test('an unsatisfied required challenge stops without emitting partial headers', async () => {
  const sentinel = await createSentinel(provider({ challenge: { token: 'challenge',
    turnstile: { required: true, dx: 'provider-bytecode', reject: true } } }).fetch, { deviceID: 'test-device' })
  try { await assert.rejects(sentinel.headers(), error => error.result.error.code === 'PROVIDER_SECURITY_CHALLENGE') }
  finally { sentinel.close() }
})

test('SDK HTML and unsupported versions fail before the Sentinel request', async () => {
  for (const options of [{ sdkContentType: 'text/html' }, { sdk: 'var SentinelSDK={};' }]) {
    const mock = provider(options)
    await assert.rejects(createSentinel(mock.fetch, { deviceID: 'test-device' }),
      error => error.result.error.code === 'SENTINEL_SDK_UNSUPPORTED')
    assert.equal(mock.calls.length, 1)
  }
})

test('cancellation terminates the SDK runtime and prevents headers from being returned', async () => {
  const controller = new AbortController()
  const sentinel = await createSentinel(provider({ beforeResponse: () => controller.abort() }).fetch,
    { deviceID: 'test-device', signal: controller.signal })
  try { await assert.rejects(sentinel.headers()) } finally { sentinel.close() }
})
