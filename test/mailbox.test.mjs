import test from 'node:test'
import assert from 'node:assert/strict'
import { extractOtp, messageOtp } from '../src/mailbox.mjs'

test('extracts a six digit code', () => assert.equal(extractOtp('Your code is 123456'), '123456'))

test('matches the login recipient and ignores older mail', () => {
  const parsed = {
    to: { value: [{ address: 'owner@example.com' }] },
    cc: { value: [] },
    from: { value: [{ address: 'noreply@openai.com' }] },
    headers: new Map(),
    date: new Date('2026-10-12T10:00:00Z'),
    subject: 'Code',
    text: '123456'
  }
  assert.equal(messageOtp(parsed, { loginEmail: 'owner@example.com', since: '2026-10-12T09:00:00Z' }), '123456')
  assert.equal(messageOtp(parsed, { loginEmail: 'owner@example.com', since: '2026-10-12T11:00:00Z' }), null)
})
