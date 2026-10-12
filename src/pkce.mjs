import { createHash, randomBytes } from 'node:crypto'

export function createPkce() {
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { state, verifier, challenge }
}

export function buildAuthorizeUrl({
  clientId = 'app_EMoamEEZ73f0CkXaXp7hrann',
  redirectUri = 'http://localhost:1455/auth/callback',
  state,
  challenge
}) {
  const url = new URL('https://auth.openai.com/oauth/authorize')
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true'
  })
  return url
}
