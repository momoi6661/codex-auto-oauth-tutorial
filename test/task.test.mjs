import test from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'dotenv'
import { readFileSync } from 'node:fs'
import { loadConfig } from '../src/config.mjs'
import { buildTask } from '../src/task.mjs'

const example = parse(readFileSync(new URL('../.env.example', import.meta.url)))

test('example config reaches the real protocol with workspace, mailbox and proxy settings', () => {
  const config = loadConfig({ ...example, WORKSPACE_INDEX: '0', AUTH_PROXY_URL: 'http://127.0.0.1:7890' })
  const task = buildTask(config)
  assert.equal(task.context.workspaceIndex, 0)
  assert.equal(task.proxyURL, 'http://127.0.0.1:7890')
  assert.equal(task.mailbox.username, config.mailbox.user)
  assert.equal(task.context.secret, config.mailbox.password)
  assert.equal(task.resendAfterSeconds, 30)
  assert.equal(new RegExp(task.mailbox.codePattern).exec('code: 123456')[1], '123456')
  assert.equal(task.mailbox.minUID, undefined, 'the protocol must snapshot the mailbox before sending')
  assert.equal(Object.hasOwn(task, 'script'), false)
})

test('invalid workspace index fails at configuration instead of silently selecting a team', () => {
  for (const index of ['-1', '1.5', 'wrong']) {
    assert.throws(() => loadConfig({ ...example, WORKSPACE_INDEX: index }), /WORKSPACE_INDEX/)
  }
})
