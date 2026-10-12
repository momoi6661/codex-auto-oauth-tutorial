import { Worker } from 'node:worker_threads'
import { browserHeaders } from './browser-profile.mjs'

export const sentinelOrigin = 'https://sentinel.openai.com'
export const sentinelVersion = '20260219f9f6'
const sdkURL = `${sentinelOrigin}/sentinel/${sentinelVersion}/sdk.js`
const fail = (code, message, httpStatus) => {
  const error = { code, message, retryable: httpStatus === 429 || httpStatus >= 500 }
  if (httpStatus) error.httpStatus = httpStatus
  return Object.assign(new Error(message), { result: { type: 'error', error } })
}

export async function createSentinel(fetch, { deviceID, signal }) {
  signal?.throwIfAborted()
  const request = async (url, options = {}) => {
    const response = await fetch(url, { ...options, redirect: 'manual', size: 1024 * 1024,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      headers: { ...browserHeaders, 'Accept-Language': 'en-US,en;q=0.9', ...options.headers } })
    const text = await response.text()
    if (response.headers.get('cf-mitigated') === 'challenge' || /just a moment|challenges\.cloudflare\.com/i.test(text)) {
      throw fail('PROVIDER_SECURITY_CHALLENGE', 'Sentinel returned a provider security challenge', response.status)
    }
    if (!response.ok || response.status !== 200) {
      throw fail('SENTINEL_REQUEST_FAILED', `Sentinel request failed (HTTP ${response.status})`, response.status)
    }
    return { response, text }
  }
  const { response, text: source } = await request(sdkURL, { headers: {
    Accept: '*/*', Referer: 'https://auth.openai.com/',
    'Sec-Fetch-Dest': 'script', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Site': 'same-site'
  } })
  if (!/javascript/i.test(response.headers.get('content-type') || '') || !source.trim()) {
    throw fail('SENTINEL_SDK_UNSUPPORTED', 'Sentinel did not return a supported SDK', response.status)
  }

  const worker = new Worker(new URL('./sentinel-runtime.mjs', import.meta.url), {
    execArgv: [],
    workerData: { source, sdkURL, deviceID, userAgent: browserHeaders['User-Agent'] },
    resourceLimits: { maxOldGenerationSizeMb: 64 }, stdout: true, stderr: true
  })
  // SDK output must never reach logs: it may contain device or challenge data.
  worker.stdout.resume()
  worker.stderr.resume()
  let closed = false, sequence = 0
  const pending = new Map()
  const close = (reason = fail('SENTINEL_GENERATION_FAILED', 'Sentinel generation did not complete')) => {
    if (closed) return
    closed = true
    for (const value of pending.values()) value.reject(reason)
    pending.clear()
    signal?.removeEventListener('abort', aborted)
    void worker.terminate()
  }
  const aborted = () => close(signal.reason)
  signal?.addEventListener('abort', aborted, { once: true })
  const ready = new Promise((resolve, reject) => pending.set(0, { resolve, reject }))
  worker.on('message', message => {
    const waiter = pending.get(message.ready ? 0 : message.id ?? 0)
    if (!waiter) return
    pending.delete(message.ready ? 0 : message.id ?? 0)
    if (message.error) waiter.reject(fail(message.error, 'Sentinel SDK could not generate authorization evidence'))
    else waiter.resolve(message.result)
  })
  worker.on('error', () => close())
  worker.on('exit', () => close())
  const bounded = async promise => {
    const timer = setTimeout(() => close(fail('SENTINEL_TIMEOUT', 'Sentinel generation exceeded its deadline')), 10000)
    try { return await promise } finally { clearTimeout(timer) }
  }
  const run = operation => bounded(new Promise((resolve, reject) => {
    if (closed) { reject(fail('SENTINEL_GENERATION_FAILED', 'Sentinel runtime is unavailable')); return }
    const id = ++sequence
    pending.set(id, { resolve, reject })
    worker.postMessage({ id, ...operation })
  }))
  try { await bounded(ready) } catch (error) { close(); throw error }
  if (signal?.aborted) { close(signal.reason); throw signal.reason }

  return {
    close,
    async headers(flow = 'authorize_continue') {
      signal?.throwIfAborted()
      const { requestP } = await run({ operation: 'requirements' })
      if (typeof requestP !== 'string' || !requestP.startsWith('gAAAAA')) {
        throw fail('SENTINEL_GENERATION_FAILED', 'Sentinel SDK did not return a requirements token')
      }
      const { text, response } = await request(`${sentinelOrigin}/backend-api/sentinel/req`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', Accept: '*/*',
          Origin: sentinelOrigin, Referer: `${sentinelOrigin}/backend-api/sentinel/frame.html?sv=${sentinelVersion}`,
          'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({ p: requestP, id: deviceID, flow })
      })
      let challenge
      try { challenge = JSON.parse(text) } catch {
        throw fail('SENTINEL_INVALID_RESPONSE', 'Sentinel returned a non-JSON response', response.status)
      }
      if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge) || typeof challenge.token !== 'string' || !challenge.token.trim()) {
        throw fail('SENTINEL_INVALID_RESPONSE', 'Sentinel response is missing its challenge token', response.status)
      }
      const { proof, turnstile, observer } = await run({ operation: 'solve', challenge, requestP, flow })
      if (typeof proof !== 'string' || !proof.startsWith('gAAAAA') ||
          (challenge.turnstile?.required && (typeof turnstile !== 'string' || !turnstile)) ||
          (challenge.so?.required && (typeof observer !== 'string' || !observer))) {
        throw fail('PROVIDER_SECURITY_CHALLENGE', 'Sentinel SDK could not complete the required provider challenge', response.status)
      }
      return {
        'openai-sentinel-token': JSON.stringify({ p: proof, t: turnstile || '', c: challenge.token, id: deviceID, flow }),
        ...(observer ? { 'openai-sentinel-so-token': observer } : {})
      }
    }
  }
}
