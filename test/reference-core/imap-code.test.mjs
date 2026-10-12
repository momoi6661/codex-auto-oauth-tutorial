import test from 'node:test'
import assert from 'node:assert/strict'
import { simpleParser } from 'mailparser'
import { matchMailboxMessage } from '../../src/reference-core/imap-code.mjs'

const task = {
  context: { loginEmail: 'owner@example.com', since: '2026-10-10T12:00:00.650Z' },
  mailbox: { codePattern: '\\b(\\d{6})\\b', senderFilter: 'login@example.com' }
}
const email = ({ to = 'owner@example.com', from = 'login@example.com', delivered = '' } = {}) =>
  `From: Login <${from}>\r\nTo: <${to}>\r\n${delivered ? `Delivered-To: ${delivered}\r\n` : ''}Subject: Login verification\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Your code is <b>123456</b></p>`

test('ordinary HTML email yields a code when delivered in the task start second', async () => {
  const parsed = await simpleParser(email(), { skipHtmlToText: false, skipTextToHtml: true })
  assert.equal(matchMailboxMessage(parsed, new Date('2026-10-10T12:00:00Z'), task), '123456')
  assert.equal(matchMailboxMessage(parsed, new Date('2026-10-10T11:59:59Z'), task), null)
})

test('parsed delivery headers support forwarded login addresses', async () => {
  const parsed = await simpleParser(email({ to: 'shared@example.com', delivered: 'owner@example.com' }))
  assert.equal(matchMailboxMessage(parsed, new Date('2026-10-10T12:00:01Z'), task), '123456')
})

test('iCloud forwarding may expose the receiving Gmail address', async () => {
  const parsed = await simpleParser(email({ to: 'gmail-inbox@example.com' }))
  const forwardedTask = { ...task, context: { ...task.context, mailboxAddress: 'gmail-inbox@example.com' } }
  assert.equal(matchMailboxMessage(parsed, new Date('2026-10-10T12:00:01Z'), forwardedTask), '123456')
})

test('another recipient or sender never yields a code', async () => {
  for (const options of [{ to: 'other@example.com' }, { from: 'other@example.com' }]) {
    assert.equal(matchMailboxMessage(await simpleParser(email(options)), new Date('2026-10-10T12:00:01Z'), task), null)
  }
})

test('invalid delivery or task timestamps never yield a code', async () => {
  const parsed = await simpleParser(email())
  assert.equal(matchMailboxMessage(parsed, new Date('invalid'), task), null)
  assert.equal(matchMailboxMessage(parsed, new Date(), { ...task, context: { ...task.context, since: 'invalid' } }), null)
})


test('iCloud Hide My Email forwarding with rewritten sender and HTML body matches the login alias', async () => {
  const raw = email({ to: 'login-alias@icloud.com', from: 'noreply_at_tm1_openai_com_forwarding_id@icloud.com', delivered: 'shared@gmail.com' })
    .replace('Subject: Login verification', 'Subject: Your temporary ChatGPT login code')
  const forwardedTask = { context: { ...task.context, loginEmail: 'login-alias@icloud.com', mailboxAddress: 'shared@gmail.com' }, mailbox: { ...task.mailbox, senderFilter: '' } }
  assert.equal(matchMailboxMessage(await simpleParser(raw), new Date('2026-10-10T12:00:01Z'), forwardedTask), '123456')
})

test('shared Gmail delivery never accepts a different explicit hidden-email recipient', async () => {
  const forwardedTask = { context: { ...task.context, loginEmail: 'login-alias@icloud.com', mailboxAddress: 'shared@gmail.com' }, mailbox: { ...task.mailbox, senderFilter: '' } }
  const parsed = await simpleParser(email({ to: 'different-alias@icloud.com', delivered: 'shared@gmail.com' }))
  assert.equal(matchMailboxMessage(parsed, new Date('2026-10-10T12:00:01Z'), forwardedTask), null)
  const rewritten = await simpleParser(email({ to: 'shared@gmail.com', delivered: 'shared@gmail.com' }))
  rewritten.headers.set('x-original-to', 'different-alias@icloud.com')
  assert.equal(matchMailboxMessage(rewritten, new Date('2026-10-10T12:00:01Z'), forwardedTask), null)
})

test('repeated delivery headers still match the requested login recipient', async () => {
  const parsed = await simpleParser(email({ to: 'shared@example.com' }))
  parsed.headers.set('delivered-to', ['relay@example.com', 'owner@example.com'])
  assert.equal(matchMailboxMessage(parsed, new Date('2026-10-10T12:00:01Z'), task), '123456')
})
