import test from 'node:test'
import assert from 'node:assert/strict'
import { executeScript } from '../../src/reference-core/executor.mjs'

test('the mailbox child rejects custom scripts instead of executing them', async () => {
  const result = await executeScript({ script: 'throw new Error("should not run")' })
  assert.equal(result.error.code, 'MAILBOX_REQUIRED')
})
