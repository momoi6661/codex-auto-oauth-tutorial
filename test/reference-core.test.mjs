import test from 'node:test'
import assert from 'node:assert/strict'
import * as core from '../src/reference-core/index.mjs'

test('reference core exports the transplanted call-chain modules', () => {
  for (const name of ['authorizeWithProtocol', 'executeScript', 'executeMailbox', 'matchMailboxMessage', 'readConsentForm', 'createCurlCffiFetch']) {
    assert.equal(typeof core[name], 'function', name)
  }
})
