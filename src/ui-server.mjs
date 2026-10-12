import 'dotenv/config'
import { createServer } from 'node:http'
import { randomUUID, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'
import { buildTask } from './task.mjs'
import { normalizeProxyURL } from './reference-core/proxy-url.mjs'
import { authorizeWithProtocol, executeScript } from './reference-core/index.mjs'

const fields = ['IMAP_HOST', 'IMAP_PORT', 'IMAP_USER', 'IMAP_PASSWORD', 'IMAP_FOLDER',
  'MAILBOX_ADDRESS', 'OTP_PATTERN', 'OTP_SENDER', 'MAILBOX_WAIT_SECONDS',
  'EMAIL_RESEND_SECONDS', 'AUTH_PROXY_URL']
const defaults = { IMAP_PORT: '993', IMAP_FOLDER: 'INBOX', OTP_PATTERN: '\\b(\\d{6})\\b',
  MAILBOX_WAIT_SECONDS: '90', EMAIL_RESEND_SECONDS: '30', AUTH_PROXY_URL: '' }
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const publicProfile = ({ id, name, settings }) => {
  const { IMAP_PASSWORD, ...visible } = settings
  return { id, name, settings: visible, hasPassword: Boolean(IMAP_PASSWORD) }
}

export async function createUIServer({ dataDirectory = resolve('.local'), authorize = authorizeWithProtocol } = {}) {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  const profileFile = join(dataDirectory, 'profiles.json')
  let profiles = []
  try { profiles = JSON.parse(await readFile(profileFile, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read local profiles.json; check or restore the file') }
  if (!Array.isArray(profiles)) throw new Error('Invalid local profiles.json')
  const sessionToken = randomBytes(32).toString('hex')
  const html = (await readFile(new URL('../ui/index.html', import.meta.url), 'utf8')).replace('__SESSION_TOKEN__', sessionToken)
  let job = null, activeController = null
  const snapshot = () => job && ({ id: job.id, status: job.status, stages: [...job.stages],
    error: job.error, email: job.email, accountId: job.accountId, downloadReady: job.status === 'succeeded' })
  const persist = async list => {
    const temporary = profileFile + '.tmp'
    await writeFile(temporary, JSON.stringify(list, null, 2), { mode: 0o600 })
    await rename(temporary, profileFile)
    profiles = list
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(value))
    }
    try {
      if (!/^127\.0\.0\.1:\d+$/.test(request.headers.host || '')) fail(403, 'Use the printed 127.0.0.1 URL')
      const path = new URL(request.url, 'http://127.0.0.1').pathname
      if (request.method === 'GET' && path === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(html)
        return
      }
      if (!path.startsWith('/api/')) fail(404, 'Not found')
      if (request.headers['x-session-token'] !== sessionToken) fail(403, 'Reload the local UI to refresh its session')
      let body = {}
      if (request.method === 'POST') {
        if (!/^application\/json\b/i.test(request.headers['content-type'] || '')) fail(415, 'JSON required')
        let input = ''
        for await (const chunk of request) {
          input += chunk
          if (input.length > 32768) fail(413, 'Request is too large')
        }
        try { body = JSON.parse(input) } catch { fail(400, 'Invalid JSON') }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid request')
      }
      if (path === '/api/profiles' && request.method === 'GET') return send(200, profiles.map(publicProfile))
      if (path === '/api/profiles' && request.method === 'POST') {
        if (activeController) fail(409, 'Wait for authorization to finish before editing profiles')
        const previous = profiles.find(profile => profile.id === body.id)
        if (body.id && !previous) fail(404, 'Profile not found')
        const name = String(body.name || '').trim().slice(0, 120)
        if (!name) fail(400, '请填写配置名称')
        const settings = { ...defaults, ...previous?.settings }
        for (const key of fields) {
          if (body.settings?.[key] != null && !(key === 'IMAP_PASSWORD' && body.settings[key] === '')) {
            settings[key] = String(body.settings[key])
          }
        }
        settings.MAILBOX_ADDRESS ||= settings.IMAP_USER
        try {
          loadConfig({ ...settings, LOGIN_EMAIL: 'validation@example.com' })
          normalizeProxyURL(settings.AUTH_PROXY_URL)
        } catch { fail(400, '请检查 IMAP、密码、验证码规则、等待时间和代理配置') }
        const profile = { id: previous?.id || randomUUID(), name, settings }
        await persist(previous ? profiles.map(item => item.id === profile.id ? profile : item) : [...profiles, profile])
        return send(200, publicProfile(profile))
      }
      if (path === '/api/profiles/delete' && request.method === 'POST') {
        if (activeController) fail(409, 'Wait for authorization to finish before deleting profiles')
        if (!profiles.some(profile => profile.id === body.id)) fail(404, 'Profile not found')
        await persist(profiles.filter(profile => profile.id !== body.id))
        return send(200, { ok: true })
      }
      if (path === '/api/job' && request.method === 'GET') return send(200, snapshot())
      if (path === '/api/job' && request.method === 'POST') {
        if (activeController) fail(409, '已有授权正在运行，请等待或取消')
        const profile = profiles.find(item => item.id === body.profileId)
        if (!profile) fail(400, '请先选择授权配置')
        const email = String(body.email || '').trim()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(400, '请填写有效的登录邮箱')
        let config
        try {
          config = loadConfig({ ...profile.settings, LOGIN_EMAIL: email,
            WORKSPACE_INDEX: String(body.workspaceIndex ?? 1), EXPECTED_ACCOUNT_ID: String(body.expectedAccountId || '') })
        } catch { fail(400, '请检查邮箱配置和工作区序号') }
        const id = randomUUID()
        const file = join(dataDirectory, 'auth-' + id + '.json')
        const controller = new AbortController()
        activeController = controller
        job = { id, status: 'running', stages: ['preparing'] }
        // Only this promise calls the protocol; polling and downloading never rerun it.
        void (async () => {
          try {
            const result = await authorize(buildTask(config), executeScript,
              AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]), stage => job.stages.push(stage))
            if (result.type !== 'auth_file') { job.status = 'failed'; job.error = result.error; return }
            const auth = JSON.parse(result.auth)
            await writeFile(file, JSON.stringify(auth, null, 2), { mode: 0o600 })
            job.email = auth.email; job.accountId = auth.account_id; job.file = file
            job.status = 'succeeded'; job.stages.push('saved')
          } catch {
            job.status = 'failed'; job.error = { code: 'UI_AUTH_FAILED', message: '授权执行或本地文件保存失败，请检查配置和目录', retryable: true }
          } finally { activeController = null }
        })()
        return send(202, snapshot())
      }
      if (path === '/api/job/cancel' && request.method === 'POST') {
        activeController?.abort()
        return send(200, snapshot())
      }
      if (path === '/api/job/auth' && request.method === 'GET') {
        if (job?.status !== 'succeeded') fail(409, 'No successful authorization is available')
        response.setHeader('Content-Disposition', 'attachment; filename="codex-auth.json"')
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(await readFile(job.file))
        return
      }
      fail(404, 'Not found')
    } catch (error) {
      if (!response.headersSent) send(error.status || 500, { error: error.status ? error.message : 'Local UI request failed; check local configuration and file permissions' })
      else response.end()
    }
  })
  server.on('close', () => activeController?.abort())
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.UI_PORT || 17855)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid UI_PORT')
  const server = await createUIServer()
  server.on('error', error => { console.error(`UI stopped (${error.code || error.name}); check UI_PORT and local files`); process.exitCode = 1 })
  server.listen(port, '127.0.0.1', () => console.log(`打开 http://127.0.0.1:${port} → 新建授权配置 → 填写邮箱 → 选择工作区 → 一键授权`))
  process.once('SIGINT', () => { server.close(); server.closeAllConnections() })
}
