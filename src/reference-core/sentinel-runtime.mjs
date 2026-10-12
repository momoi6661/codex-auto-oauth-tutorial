import { parentPort, workerData } from 'node:worker_threads'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const storage = () => {
  const values = new Map()
  return { getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)), clear: () => values.clear(),
    get length() { return values.size } }
}
const noop = () => {}
const element = tag => ({ tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), nodeType: 1,
  style: {}, children: [], appendChild(child) { this.children.push(child); return child },
  removeChild(child) { this.children = this.children.filter(value => value !== child); return child },
  setAttribute: noop, getAttribute: () => null, addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }) })

// SDK code runs without Node's process, require, filesystem or network globals.
// All provider HTTP requests remain in the task's curl_cffi session.
const documentElement = element('html')
documentElement.clientWidth = 1366
documentElement.clientHeight = 768
const document = {
  readyState: 'complete', hidden: false, visibilityState: 'visible',
  referrer: 'https://auth.openai.com/', URL: 'https://auth.openai.com/',
  cookie: `oai-did=${encodeURIComponent(workerData.deviceID)}`, scripts: [],
  currentScript: { src: workerData.sdkURL, getAttribute: () => null },
  documentElement, body: element('body'), head: element('head'),
  createElement: element, createElementNS: (_, tag) => element(tag),
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  getElementsByTagName: () => [], addEventListener: noop, removeEventListener: noop,
  dispatchEvent: () => true
}
const context = vm.createContext({
  document,
  navigator: { userAgent: workerData.userAgent, language: 'en-US', languages: ['en-US', 'en'],
    hardwareConcurrency: 8, platform: 'Win32', vendor: 'Google Inc.', webdriver: false },
  location: new URL('https://auth.openai.com/'),
  screen: { width: 1366, height: 768, availWidth: 1366, availHeight: 768, colorDepth: 24, pixelDepth: 24 },
  performance: { now: () => performance.now(), timeOrigin: performance.timeOrigin,
    memory: { jsHeapSizeLimit: 4294967296 } },
  localStorage: storage(), sessionStorage: storage(), crypto: webcrypto,
  URL, URLSearchParams, TextEncoder, TextDecoder,
  atob: value => Buffer.from(value, 'base64').toString('latin1'),
  btoa: value => Buffer.from(value, 'latin1').toString('base64'),
  setTimeout, clearTimeout, setInterval: () => 1, clearInterval: noop,
  requestIdleCallback: callback => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0),
  cancelIdleCallback: clearTimeout, addEventListener: noop, removeEventListener: noop,
  dispatchEvent: () => true, postMessage: noop,
  Event: class { constructor(type) { this.type = type } },
  MessageChannel: class { constructor() {
    this.port1 = { postMessage: noop, addEventListener: noop, removeEventListener: noop, start: noop, close: noop }
    this.port2 = { ...this.port1 }
  } },
  matchMedia: query => ({ media: query, matches: false, addListener: noop, removeListener: noop,
    addEventListener: noop, removeEventListener: noop }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  history: { length: 1, state: null, back: noop, forward: noop, go: noop, pushState: noop, replaceState: noop },
  chrome: { runtime: {}, app: {} }, CSS: { supports: () => true },
  indexedDB: { open: () => ({}), deleteDatabase: () => ({}) },
  fetch: async () => { throw new Error('SDK network access is unavailable') },
  __sentinel_init_pending: [], __sentinel_token_pending: []
})
context.window = context.self = context.top = context.parent = context

// These names belong to the pinned official SDK version. Fail on a changed SDK
// instead of emitting a fabricated token or guessing its private entry points.
const marker = 't.token=ye,t}({});'
try {
  if (!workerData.source.includes(marker)) throw new Error('Unsupported SDK')
  const source = workerData.source.replace(marker,
    't.token=ye,t.__proof=P,t.__bind=D,t.__challenge=_n,t.__observe=se,t}({});')
  vm.runInContext(source, context, { timeout: 5000 })
  const sdk = context.SentinelSDK
  if (!sdk?.__proof?.getRequirementsToken) throw new Error('Missing SDK API')
  parentPort.on('message', async ({ id, operation, challenge, requestP, flow }) => {
    try {
      if (operation === 'requirements') {
        parentPort.postMessage({ id, result: { requestP: await sdk.__proof.getRequirementsToken() } })
      } else if (operation === 'solve') {
        sdk.__bind(challenge, requestP)
        const proof = await sdk.__proof.getEnforcementToken(challenge)
        const turnstile = challenge.turnstile?.dx ? await sdk.__challenge(challenge, challenge.turnstile.dx) : null
        sdk.__observe(flow, challenge)
        const observer = await sdk.sessionObserverToken(flow)
        parentPort.postMessage({ id, result: { proof, turnstile, observer } })
      } else throw new Error('Unsupported operation')
    } catch { parentPort.postMessage({ id, error: 'SENTINEL_GENERATION_FAILED' }) }
  })
  parentPort.postMessage({ ready: true })
} catch { parentPort.postMessage({ error: 'SENTINEL_SDK_UNSUPPORTED' }) }
