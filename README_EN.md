# One-click OAuth Authorization for Codex

[中文](README.md) | **English**

Save a mailbox configuration, select it, enter the existing account's login email and choose a workspace. Click Authorize to perform login, read the email OTP, confirm consent and exchange tokens. The example UI and CLI use the same complete protocol core.

## The implementation in one flow

```text
Mailbox profile + login email + workspace strategy
  → snapshot IMAP UIDNEXT / UIDVALIDITY before requesting mail
  → create OAuth state / PKCE, device ID and a cookie session
  → submit email with fresh Sentinel evidence on protected requests
  → read new OTP mail; resend at most once when necessary
  → validate OTP and confirm team or personal consent
  → validate callback code / state and exchange with the PKCE verifier
  → check email / selected account identity and save credential JSON
```

This implementation sends real requests. Ten protocol, mailbox, transport, Sentinel and consent files are unchanged from the existing application's corresponding core files. The standalone adaptation removes the panel, database, queue, batch management and custom scripts, and adds configuration, CLI and local UI adapters. The default command runs the complete core, not the smaller teaching examples.

**The authorization protocol follows the same existing implementation, with a complete call chain.** The project maintainer has confirmed successful authorization with a real account. The screenshot below shows the completed flow as a usage reference. Automated tests separately cover mocked authorization and the local Python transport. Configure your own existing account, receiving mailbox and proxy to use it.

## 1. Use the example UI

![Successful one-click authorization example](ui/authorization-success.jpg)

This image shows a completed real-account authorization: select a profile, enter the login email and choose a workspace on the left; watch progress and download credential JSON on the right. The image contributor obscured account details. Use the image as an operating reference.

Requires Node.js 22+ and Python 3.10+. Run from the repository directory:

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:CURL_CFFI_PYTHON = ".venv/Scripts/python.exe"
npm run ui
```

Open **http://127.0.0.1:17855**, as printed in the terminal:

1. Click 新建 (New). Save a profile name, IMAP host, username and mailbox app password.
2. Select that profile and enter the existing OpenAI/Codex account's login email.
3. Choose the first team with personal fallback, personal explicitly, or another team by index.
4. Click 一键授权 (Authorize). Watch progress and download the credential JSON on success.

Configure the mailbox and proxy once; reuse the profile for later runs. When editing, a blank password preserves the saved password. Advanced fields cover folder, sender filter, OTP regex, mailbox wait and the single resend delay.

The UI is a local demonstration, without the application panel, database, Vue, Playwright or browser automation. The browser displays forms; the local protocol service makes login requests.

- Profiles are stored in `.local/profiles.json`, including mailbox passwords. Credentials are stored in `.local/auth-<jobID>.json`. This directory is Git-ignored, but files have no additional encryption; keep them on your own device.
- Saved passwords are not echoed to the browser. Progress contains no tokens; the successful download returns credentials.
- Only one authorization runs at a time. Cancel and Ctrl+C are supported. Refresh recovers current progress; polling/download never rerun login. Restarting preserves profiles and generated files.
- The UI listens only on `127.0.0.1`. Set `$env:UI_PORT = "17856"` before starting to use another port.

On Linux/macOS:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
CURL_CFFI_PYTHON=.venv/bin/python npm run ui
```

## 2. CLI and configuration

```powershell
Copy-Item .env.example .env
# Edit .env, then:
npm run authorize
```

Set `CURL_CFFI_PYTHON=.venv/Scripts/python.exe` in `.env` on Windows, or `.venv/bin/python` on Linux/macOS. The default CLI output is `codex-auth.json`. **Neither the UI nor CLI overwrites the Codex application's own login file.** Output is a flat credential JSON for consumers to import; do not assume it matches every Codex client's internal file format.

| Field | Purpose |
| --- | --- |
| `LOGIN_EMAIL` | Existing account to authorize; no registration |
| `IMAP_HOST` / `IMAP_PORT` | TLS IMAP host; default port 993 |
| `IMAP_USER` / `IMAP_PASSWORD` | Receiving mailbox username/app password, not an OpenAI password |
| `MAILBOX_ADDRESS` | Actual receiving address; defaults to IMAP username; may differ from the login alias |
| `IMAP_FOLDER` | Default `INBOX`; change if mailbox rules move OTP mail |
| `OTP_PATTERN` | Default `\b(\d{6})\b`; capture group 1 must contain the code |
| `OTP_SENDER` | Optional exact sender-email filter |
| `MAILBOX_WAIT_SECONDS` | Wait 30–180 seconds; default 90 |
| `EMAIL_RESEND_SECONDS` | Resend once after 10–90 seconds; default 30 |
| `WORKSPACE_INDEX` | `0` personal; `1+` selects enabled teams in provider order; default `1` |
| `EXPECTED_ACCOUNT_ID` | Optional previous workspace ID, preferred when supplied |
| `AUTH_PROXY_URL` | HTTP, HTTPS or SOCKS proxy for OAuth/Sentinel; empty means direct |
| `CURL_CFFI_PYTHON` | Interpreter with `curl_cffi` installed |
| `OUTPUT_FILE` | CLI output path; default `codex-auth.json` |

For a local proxy use `http://127.0.0.1:7890`. OAuth and Sentinel share a transport instance and explicit proxy; cookies remain domain-scoped. IMAP connects directly. Python uses `trust_env=False`, so setting only a system `HTTPS_PROXY` is insufficient.

## 3. How requests are sent

### OAuth session and transport

`protocol-auth.mjs` creates a random `state` and PKCE `verifier` for each task and sends its SHA-256 challenge to `/oauth/authorize`. The code uses client ID `app_EMoamEEZ73f0CkXaXp7hrann`, redirect URI `http://localhost:1455/auth/callback`, and scope `openid profile email offline_access`.

```text
UI / CLI
  → buildTask(config)
  → authorizeWithProtocol(task, executeScript, signal, report)
  → Node wrapper: cookies, device ID, headers, redirects, response checks
  → curl-cffi-fetch.mjs: stdin/stdout JSON Lines
  → curl-transport.py: one curl_cffi Session + Chrome 142 TLS profile
  → auth.openai.com / sentinel.openai.com
```

Node's `tough-cookie` jar stores and attaches cookies by URL. `browser-profile.mjs` keeps HTTP browser headers consistent with the Sentinel runtime. Python keeps one session, verifies TLS, uses the explicit proxy and disables automatic redirects, returning status, headers, Set-Cookie and response body to Node.

Authorization requests are restricted to `auth.openai.com`, with at most 12 manually followed redirects. On reaching the configured localhost callback URL, the code extracts `code` and validates `state`; **no actual callback listener on port 1455 is required**.

### Request order and payloads

| Step | Request | Data and behavior |
| --- | --- | --- |
| Initialize | `GET /oauth/authorize` | client_id, redirect_uri, scope, state, code_challenge; establish session |
| Submit email | `POST /api/accounts/authorize/continue` | JSON username; follow continue_url / page.type |
| Switch password page to email OTP | `POST /api/accounts/passwordless/send-otp` | JSON `{}`; only when login lands on a password page |
| Resend once | `POST /api/accounts/email-otp/resend` | JSON `{}`; preserve original UID snapshot and active mailbox reader |
| Validate OTP | `POST /api/accounts/email-otp/validate` | JSON `{ "code": "received code" }` |
| Select workspace | `POST /api/accounts/workspace/select` | JSON `{ "workspace_id": "ID offered in this session" }` |
| Personal consent | `POST` to the form action | Submit provider-offered fields as form-urlencoded when no picker exists |
| Token exchange | `POST /oauth/token` | form-urlencoded: grant_type, client_id, code, redirect_uri, code_verifier |

Email submission body:

```json
{ "username": { "value": "owner@example.com", "kind": "email" } }
```

JSON POSTs include the corresponding Content-Type, Origin, Referer, Cookie and `oai-device-id`. Email submission, passwordless/send-otp, email-otp/resend and email-otp/validate receive fresh Sentinel evidence for **each request**. Workspace selection and token exchange are outside that Sentinel path matcher.

### Sentinel and missing OTP delivery

`openai-sentinel-token` is an essential **request header**, not an email-body field or static configuration:

```text
oai-device-id: task device ID
openai-sentinel-token: fresh request evidence JSON
openai-sentinel-so-token: included when the SDK provides observer evidence
```

`sentinel.mjs` downloads the pinned SDK version `20260219f9f6` and runs its adapter in a Worker. Each protected request generates a requirements token, submits `{ p, id, flow }` to `/backend-api/sentinel/req`, and uses the SDK to process the challenge into proof and conditional observer/challenge results. The current core uses flow `authorize_continue` for those four paths. SDK HTTP requests use the same curl transport; Node does not directly forward authorization-domain cookies to the Sentinel domain.

The integration gap to fill was dynamic `openai-sentinel-token` and conditional `openai-sentinel-so-token`. The complete core now carries them, but no independent live A/B acceptance establishes that every missing email was caused solely by one header. `screen_hint: "login"` is not the confirmed missing item here and is absent from the current email body.

| Symptom | Inspect |
| --- | --- |
| Stops at mailbox connection | IMAP host, app password, TLS and folder; login has not begun |
| SDK/challenge failure | Pinned SDK compatibility, proxy and returned challenge; do not fabricate evidence |
| Remains on password page | Whether passwordless/send-otp was called and reached email verification |
| HTTP 200 with HTML | An API error page is not delivery confirmation; core rejects unexpected HTML |
| OTP page reached, mailbox timed out | Delivery address, mail rules, sender filter, regex and new-message UID |
| Proxy 407 / connection failure | Proxy URL, credentials and connectivity |

An HTTP response does not prove email delivery. Resend happens at most once.

## 4. Mailbox integration

The receiving mailbox may be the login mailbox or receive forwarded mail. `LOGIN_EMAIL` identifies the account; `IMAP_USER` signs into the receiving inbox; `MAILBOX_ADDRESS` is its delivery address.

The core opens IMAP read-only, snapshots `UIDNEXT` / `UIDVALIDITY` before sending login requests, searches new UIDs and checks server `INTERNALDATE`. UIDVALIDITY changes stop the task to prevent old-code reuse.

`mailparser` decodes the message. To/Cc, X-Original-To, Envelope-To and Delivered-To are checked, including rewritten forwarding addresses. A shared inbox address cannot override another explicit login recipient. The optional exact sender filter and regex capture group 1 select the code. Mail is not deleted, moved or marked.

Snapshot subprocess timeout is 10 seconds; the OTP reader limit is 190 seconds. Resend preserves both reader and original snapshot, so an already-arriving code is not excluded by a later snapshot.

## 5. Workspace selection and personal fallback

- `0`: explicitly choose personal.
- `1`: prefer the first enabled team; use provider-offered personal if no enabled team exists.
- `2+`: choose a team in provider order; out-of-range indices fail when teams exist.
- Personal Continue form without a picker: submit actual provider fields; never invent a workspace ID.
- Previous account ID supplied: prefer it; if the old team disappears and only personal remains, allow personal fallback.

The UI chooses a strategy, not a pre-fetched team-name list. Actual workspace data is available after login/OTP and comes from session cookies, form controls or React Router loader data.

After exchange, the code decodes ID Token identity fields and checks email and the selected account_id. Valid personal fallback uses the identity selected in this session, rather than rejecting it with the old team ID. This checks field consistency; it is not an independent JWT signature verifier.

## 6. Modules and dependencies

### Default call chain

| File | Responsibility |
| --- | --- |
| `src/ui-server.mjs` | Local UI API, profile persistence, one authorization, cancel, progress and download |
| `ui/index.html` | Profile editor, email, workspace strategy and progress |
| `src/cli.mjs` | CLI, ten-minute deadline, Ctrl+C and successful file output |
| `src/config.mjs` | Validate config, ports, wait times, regex and workspace index |
| `src/task.mjs` | Separate login email, receiving address and mailbox password in the task interface |
| `src/reference-core/index.mjs` | Core exports |
| `protocol-auth.mjs` | OAuth/PKCE, cookies, OTP, consent, redirects, exchange and identity checks |
| `imap-code.mjs` | Read-only IMAP, UID snapshot, new-mail/forwarding filters and code extraction |
| `curl-cffi-fetch.mjs` / `curl-transport.py` | JSON-lines bridge, persistent session, Chrome TLS and explicit proxy |
| `sentinel.mjs` / `sentinel-runtime.mjs` | Pinned SDK adapter, fresh evidence, Worker deadlines and shutdown |
| `consent-form.mjs` | Read HTML and React Router data without executing consent-page scripts |
| `browser-profile.mjs` / `proxy-url.mjs` | Chrome 142 identity and normalized proxy URLs, proxy-side SOCKS5 DNS |
| `executor.mjs` / `script-process.mjs` | Bounded, cancellable mailbox subprocess; IMAP only |

Core files are under `src/reference-core/`. The internal `executeScript` name is retained for interface compatibility, but **custom user scripts are not executed**.

### Dependencies

| Dependency | Purpose |
| --- | --- |
| `dotenv` | CLI/UI .env loading; UI mailbox profiles are stored separately |
| `tough-cookie` | Domain/path-aware cookie jar |
| `imapflow` | TLS IMAP and read-only mailbox access |
| `mailparser` | Mail headers, subject and body parsing |
| `htmlparser2` | Consent form DOM parsing |
| Python `curl_cffi==0.14.0` | Real HTTP/TLS transport and Chrome profile |
| `node-fetch` | Mock Response objects in tests; not default authorization HTTP transport |
| Node crypto | State, device ID and PKCE SHA-256 |
| Node child_process | Python transport and mailbox process |
| Node worker_threads / vm | SDK adapter isolation; not a complete browser environment |
| Node http / fs | Example UI and local persistence without another web framework |

The smaller `src/pkce.mjs`, `src/mailbox.mjs`, `src/protocol.mjs` and `src/workspace.mjs` are introductory examples, **outside the UI/CLI call chain**. The simplified protocol stops at consent and does not complete token exchange. Integrate the full core.

## 7. Integrate it or hand it to an AI

```js
import { loadConfig } from './src/config.mjs'
import { buildTask } from './src/task.mjs'
import { authorizeWithProtocol, executeScript } from './src/reference-core/index.mjs'

const result = await authorizeWithProtocol(
  buildTask(loadConfig()),
  executeScript,
  AbortSignal.timeout(600_000),
  step => console.log(`[${step}]`)
)
// type is auth_file or error. Save result.auth only on success; never log it.
```

`buildTask()` puts mailbox settings in task.mailbox, login email/receiving address/password/start time/workspace selection in task.context, and proxy in task.proxyURL. The core returns auth_file or an error with code/message/retryable. Only save/import auth_file results.

Output includes type `codex`, client_id, access_token, refresh_token, id_token, email, account_id, last_refresh, expires_at and expired. Keep credentials in the consuming application's secure storage, not logs or issues.

AI handoff instruction:

> Use the full authorizeWithProtocol in src/reference-core; UI/CLI share that core. Separate mailbox profile and login identity. Select a workspace strategy, and only use workspace data actually offered in the current session. Keep state, verifier, cookies, device ID and UID snapshot task-local; generate fresh Sentinel evidence for protected requests without hard-coded tokens. Preserve read-only mail, one resend, timeout/cancellation and identity checks. Do not add a panel, database, custom scripts or batch queue. Stop and return an error for registration, MFA, phone, passkey or unsatisfied security challenges. Never print mailbox passwords, OTPs, cookies or tokens. Report mock tests, local UI acceptance and live authorization separately.

## 8. Validation and licensing

```powershell
npm test
npm run test:transport
node --check src/ui-server.mjs
node --check src/cli.mjs
```

The test suite uses mock provider/SDK fixtures for protocol, Sentinel, consent/personal fallback, IMAP, cancellation, task config and UI API coverage. The transport test sends requests to a local server through the actual Python bridge, checking cookies, manual redirects and browser profile. These tests do not send account emails.

Real-account authorization was completed and confirmed by the project maintainer; the example image above shows the successful result.

Unknown pages, registration, MFA, phone, passkey or unsatisfied challenges stop the protocol. Provider or pinned SDK changes may require adapter updates; mock evidence never substitutes for live evidence.

Standalone UI/CLI and teaching files use the root MIT license. The protocol core and corresponding tests use LGPL v3. See [module and licensing notes](src/reference-core/NOTICE_EN.md); full license texts are retained in LICENSE and COPYING.
