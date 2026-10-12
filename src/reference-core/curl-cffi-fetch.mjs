import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { normalizeProxyURL } from './proxy-url.mjs'
import { browserHeaders, browserProfile } from './browser-profile.mjs'

function responseFrom(payload) {
  const headers = new Map(Object.entries(payload.headers || {}))
  const cookies = payload.setCookie || []
  return {
    status: Number(payload.status),
    ok: Number(payload.status) >= 200 && Number(payload.status) < 300,
    headers: {
      get: name => headers.get(String(name).toLowerCase()) || null,
      raw: () => ({ 'set-cookie': cookies })
    },
    text: async () => Buffer.from(payload.body || '', 'base64').toString('utf8')
  }
}

export function createCurlCffiFetch(proxyURL = '') {
  proxyURL = normalizeProxyURL(proxyURL)
  const python = process.env.CURL_CFFI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  const child = spawn(python, [fileURLToPath(new URL('./curl-transport.py', import.meta.url))], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  })
  const pending = new Map()
  let output = ''
  let closed = false
  const failAll = error => {
    for (const { reject } of pending.values()) reject(error)
    pending.clear()
  }
  child.stdout.on('data', chunk => {
    output += chunk.toString()
    let newline
    while ((newline = output.indexOf('\n')) >= 0) {
      const line = output.slice(0, newline)
      output = output.slice(newline + 1)
      if (!line.trim()) continue
      try {
        const payload = JSON.parse(line)
        const waiter = pending.get(payload.id)
        if (!waiter) continue
        pending.delete(payload.id)
        if (payload.error) waiter.reject(Object.assign(new Error('Authorization transport connection failed'), { code: payload.errorCode }))
        else waiter.resolve(responseFrom(payload))
      } catch (error) {
        failAll(error)
      }
    }
  })
  child.on('error', error => { closed = true; failAll(error) })
  child.on('close', code => {
    closed = true
    if (pending.size) failAll(new Error(`curl_cffi transport exited (${code ?? 'unknown'})`))
  })

  const fetch = async (url, options = {}) => {
    if (closed) throw new Error('curl_cffi transport is closed')
    const id = randomUUID()
    const headers = { ...browserHeaders, ...(options.headers || {}) }
    const body = options.body == null ? null : String(options.body)
    const timeout = options.signal ? undefined : 30
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    child.stdin.write(JSON.stringify({ id, url, method: options.method || 'GET', headers, body, proxy: proxyURL, timeout, impersonate: browserProfile }) + '\n')
    if (options.signal) {
      const abort = () => {
        const waiter = pending.get(id)
        if (!waiter) return
        pending.delete(id)
        waiter.reject(options.signal.reason || new DOMException('Aborted', 'AbortError'))
      }
      if (options.signal.aborted) abort()
      else options.signal.addEventListener('abort', abort, { once: true })
    }
    return result
  }

  return {
    fetch,
    close: () => {
      if (closed) return
      closed = true
      failAll(new Error('curl_cffi transport closed'))
      child.kill()
    }
  }
}
