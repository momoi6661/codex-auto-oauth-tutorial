# How to OAuth in Codex Automatically

中文说明见 [README_CN.md](README_CN.md)。

This is a small, readable teaching project for the core idea behind one-click
Codex authorization:

```text
configuration -> OAuth/PKCE session -> submit email -> read OTP from IMAP
-> validate OTP -> choose the provider workspace -> exchange code for tokens
-> write a Codex authorization file
```

It is intentionally separate from a panel or account manager. The repository
shows how to configure an existing account and mailbox, and where an AI agent
must stop when the provider asks for a security challenge or a workspace that
was not returned by the consent page.

## Quick start

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and fill in an existing Codex login email and
   an IMAP app password. Never commit `.env` or an auth file.
3. Run `npm install` and then `npm test`.
4. Run `npm run authorize` to inspect the flow. The example stops at the
   provider-owned consent page until you add a current workspace-selection and
   token-exchange adapter for the provider response you receive.

The example is deliberately conservative around the final consent step: the
provider owns the workspace list. A production adapter should parse the actual
consent form, submit the returned `workspace_id`, verify the returned account ID,
then perform the OAuth token exchange. It must never guess a workspace ID.

## What the configuration means

`LOGIN_EMAIL` is the existing provider account to authorize. `IMAP_HOST`,
`IMAP_USER`, and `IMAP_PASSWORD` describe the mailbox that receives its OTP;
these values do not create an OpenAI account. Use a mailbox app password where
the provider supports one. `OTP_PATTERN` controls how the code is extracted.
The reader records a fresh UID boundary, reads the mailbox read-only, checks the
delivery time, and matches the login recipient before accepting a code.

## The email-submit failure that is easy to misdiagnose

The initial email request is not just an arbitrary JSON post. The current body
contains only the username:

```json
{
  "username": { "value": "owner@example.com", "kind": "email" }
}
```

`screen_hint: "login"` is not a confirmed fix. In the reference project's
history it was explicitly removed. The strongest evidence points to the missing
item being **`openai-sentinel-token`**. This is a request header, not a JSON body
field. The protected POST must preserve the same session cookie and device ID
and include the provider's current security evidence headers. The flow uses
`oai-device-id`, `openai-sentinel-token`, and, when required by the challenge,
`openai-sentinel-so-token`.
Those values are generated per request; they are not static configuration.

The same session must then call `passwordless/send-otp` when the returned page is
the password page. A 200 response only means that the request was accepted; it
does not prove mail delivery. Check the response page and the full request
headers before diagnosing IMAP or mailbox delivery.

## Giving this to an AI agent

Give the agent the repository path and ask it to:

1. Read `.env.example`, `src/protocol.mjs`, and `src/mailbox.mjs` first.
2. Keep OAuth state, PKCE verifier, cookies, device ID, and mailbox UID
   snapshot inside one task; never reuse them across accounts.
3. Use the exact configured mailbox and recipient, and never print passwords,
   cookies, authorization codes, access tokens, or refresh tokens.
4. Treat registration, CAPTCHA, MFA, phone verification, and unknown consent
   pages as manual steps. Do not bypass them or invent a successful result.
5. Verify the returned email and account ID before writing `codex-auth.json`.
6. Run `npm test` and report local tests, real provider authorization, and any
   deployment or GitHub push as separate facts.

Useful prompt:

> Explain the existing Codex OAuth flow in this repository. Make only the
> requested change. Preserve the email-submit payload, session cookies, device
> header, PKCE state, and read-only mailbox behavior. Show the test result and
> clearly distinguish a local mock test from a real provider authorization.

## Safety and troubleshooting

- **No email:** compare the full request with a known working flow: device ID,
  session cookie, current security evidence headers, and the
  `passwordless/send-otp` step. HTTP 200 alone is insufficient. Do not add
  `screen_hint` unless the provider's current request proves it is required.
- **No matching message:** check IMAP folder, server time, recipient aliases,
  forwarding headers, spam rules, and the UID snapshot. Do not read old codes.
- **Workspace error:** use only IDs returned by the current consent page. Personal
  space is a provider result, not a hard-coded ID.
- **403 or challenge:** stop and ask for manual authorization. This project does
  not bypass provider security controls.
- **Wrong account:** discard the result if the verified email or account ID does
  not match the requested account.

## Scope

This repository contains the educational core only. It does not include a web
panel, automatic retry queue, account database, registration flow, or provider
security-challenge bypass. Adapt the final consent and token-exchange adapter to
the current provider response, then review it before publishing a contribution.
