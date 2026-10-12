import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAuthorizeUrl, createPkce } from '../src/pkce.mjs'

test('PKCE URL contains the parameters Codex expects', () => {
  const pkce = createPkce()
  const url = buildAuthorizeUrl(pkce)
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('codex_cli_simplified_flow'), 'true')
  assert.equal(url.searchParams.get('state'), pkce.state)
})
