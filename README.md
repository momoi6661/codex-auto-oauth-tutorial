# How to OAuth in Codex Automatically

[中文文档](README_CN.md)

A standalone teaching project with the complete protocol implementation extracted
from the Sub2API runner. `npm run authorize` uses `src/reference-core/`:

```text
config -> IMAP UID snapshot -> OAuth/PKCE -> submit email -> request/read OTP
-> validate OTP -> team/personal consent -> verify callback state
-> token exchange -> check identity -> save auth JSON
```

The readable reference was `Wenfxl-Codex-Manager-v18.2.0` (OAuth-only and mailbox
flows). These are the independent modules developed in our runner, not a port
of its compiled `auth_core`. See [source and license details](src/reference-core/NOTICE.md).

## Setup

Use Node.js 22+ (24 recommended) and Python 3.10+. From this repository directory:

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env`: set the existing account's login email and the receiving mailbox's
IMAP host, username, app password and receiving address. On Windows set
`CURL_CFFI_PYTHON=.venv/Scripts/python.exe`. On Linux/macOS install with
`.venv/bin/python -m pip install -r requirements.txt` and set
`CURL_CFFI_PYTHON=.venv/bin/python`.

```powershell
npm test
npm run authorize
```

The authorize command makes a real provider login attempt and can request email.
On success it writes the runner's flat credential JSON to `codex-auth.json`.
It does not replace the Codex application's own auth file. Do not commit or post
`.env`, mailbox passwords, OTPs or token files.

## Configuration

| Setting | Meaning |
| --- | --- |
| LOGIN_EMAIL | Existing OpenAI/Codex login; no registration |
| IMAP_HOST / IMAP_PORT | TLS IMAP server; port defaults to 993 |
| IMAP_USER / IMAP_PASSWORD | Mailbox username and app password |
| IMAP_FOLDER | Folder containing delivered OTP mail; default INBOX |
| MAILBOX_ADDRESS | Actual receiving address, including forwarded mail |
| OTP_PATTERN | Regex with the code in capture group 1 |
| OTP_SENDER | Optional exact sender email filter |
| MAILBOX_WAIT_SECONDS | 30–180 seconds; default 90 |
| EMAIL_RESEND_SECONDS | Resend once after 10–90 seconds; default 30 |
| WORKSPACE_INDEX | 0 = personal; 1+ = position in offered team list |
| EXPECTED_ACCOUNT_ID | Optional previous workspace ID |
| AUTH_PROXY_URL | OAuth/Sentinel HTTP/HTTPS/SOCKS proxy; empty = direct |
| CURL_CFFI_PYTHON | Interpreter with curl_cffi installed |
| OUTPUT_FILE | Default codex-auth.json |

For a local proxy use `AUTH_PROXY_URL=http://127.0.0.1:7890`.
OAuth and Sentinel share one proxy/session; IMAP connects directly.
The curl transport disables inherited proxy settings: configure this explicitly.

## Extracted modules

| Module in src/reference-core | Responsibility |
| --- | --- |
| protocol-auth.mjs | PKCE, login, OTP/resend, workspace consent, callback, token exchange, identity checks |
| imap-code.mjs | Read-only IMAP, UIDNEXT/UIDVALIDITY, delivery-time and recipient/forwarding filters |
| curl-cffi-fetch.mjs / curl-transport.py | One Python curl session per task, Chrome 142 TLS profile |
| sentinel.mjs / sentinel-runtime.mjs | Pinned SDK adapter for fresh request evidence |
| consent-form.mjs | Forms and React Router workspace data without executing page scripts |
| executor.mjs / script-process.mjs | Bounded mailbox child process; custom scripts excluded |
| proxy-url.mjs / browser-profile.mjs | Proxy normalization and consistent browser identity |
| index.mjs | Module exports |

`src/task.mjs` maps configuration to the extracted task interface:

```js
import { loadConfig } from './src/config.mjs'
import { buildTask } from './src/task.mjs'
import { authorizeWithProtocol, executeScript } from './src/reference-core/index.mjs'

const result = await authorizeWithProtocol(
  buildTask(loadConfig()), executeScript, AbortSignal.timeout(600_000),
  step => console.log(step)
)
// result.type is auth_file or error. Never log result.auth.
```

The smaller pkce.mjs, mailbox.mjs, protocol.mjs and workspace.mjs are introductory
examples. The simplified protocol stops at consent; it is not the CLI's
implementation. Use reference-core for the complete flow and mailbox isolation.

## Personal fallback

Index 1 prefers the first enabled team; 0 explicitly selects personal even with
teams available. With no enabled teams, use the provider-offered personal space.
A personal-only Continue form without a picker is submitted directly; never
invent an ID or keep searching for a nonexistent workspace list.

Reauthorization preserves EXPECTED_ACCOUNT_ID when offered. If the old team
disappears and only personal remains, the core can fall back to that identity.
The returned email must still match the login; the token account ID must match
the selected workspace. Do not reject a legitimate fallback because its personal
ID differs from the old team ID. An out-of-range team index fails when teams
exist rather than silently selecting another team.

## Email submission and Sentinel

Email submission uses this body:

```json
{ "username": { "value": "owner@example.com", "kind": "email" } }
```

The key missing item added during integration was **openai-sentinel-token**,
a request header, not a JSON field. Email submission, OTP send, resend and
validation each get fresh evidence tied to the same device ID and cookies.
Observer evidence is also sent as openai-sentinel-so-token when supplied by the
SDK. screen_hint: login was removed upstream; its absence is not the established
explanation for missing mail.

Code changes and mock tests show the headers are carried; they do not alone
prove one header caused every past delivery failure. HTTP 200 is not delivery
confirmation. Password pages use /api/accounts/passwordless/send-otp; the OTP
page resends once via /api/accounts/email-otp/resend while preserving the reader
and original UID snapshot. HTML API error pages are rejected before waiting.

## Giving this to an AI

> Read this README, src/task.mjs and src/reference-core first. Use the full core,
> not the incomplete introductory protocol. Keep state, verifier, cookies,
> device ID and UID snapshot task-local. Generate evidence for each protected
> request; never hard-code tokens. Select only offered workspaces and follow
> personal fallback or the personal-only form. Check login email and selected
> account ID after exchange. Never print secrets or tokens. Preserve read-only
> mail, one resend and cancellation. Stop on registration, MFA, phone
> verification or an unsupported challenge. Report mock tests and live
> authorization separately.

## Validation and limits

npm test includes adapted upstream protocol, Sentinel, consent, mailbox and
proxy tests plus configuration tests. Provider/SDK responses are fixtures;
tests send no mail. Install Python requirements first, then run
`npm run test:transport` for a local Python bridge check.

The CLI has a ten-minute deadline and Ctrl+C cancellation. This standalone repo
has not undergone real-account acceptance. The SDK adapter pins version
20260219f9f6; SDK/API changes can require updates. Unsupported SDKs or unsatisfied
challenges stop without fabricating evidence. No panel, account database,
registration, custom scripts, task queue or automatic retry loop is included.

## License

Original teaching/CLI files: MIT. Extracted core and adapted upstream tests:
LGPL v3. Source attribution and license texts are in src/reference-core.
