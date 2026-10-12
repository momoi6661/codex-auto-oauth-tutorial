import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProxyURL } from '../../src/reference-core/proxy-url.mjs'

test('SOCKS5 proxy resolves provider and mailbox API hosts remotely without losing credentials', () => {
  const value = normalizeProxyURL('socks5://user:p%40ss@127.0.0.1:7890')
  assert.equal(value, 'socks5h://user:p%40ss@127.0.0.1:7890')
  assert.equal(normalizeProxyURL('socks5h://[::1]:1080'), 'socks5h://[::1]:1080')
  assert.equal(normalizeProxyURL('http://127.0.0.1:7890'), 'http://127.0.0.1:7890/')
  assert.equal(normalizeProxyURL(''), '')
  assert.throws(() => normalizeProxyURL('ftp://127.0.0.1:7890'), /Unsupported/)
})
