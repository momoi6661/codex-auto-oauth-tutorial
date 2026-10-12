import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

const addresses = value => (value?.value || [])
  .flatMap(item => item.group || [item])
  .map(item => String(item.address || '').toLowerCase())

export function extractOtp(text, pattern = /\b(\d{6})\b/) {
  const match = pattern.exec(text)
  return match?.[1] || null
}

export function messageOtp(parsed, { loginEmail, mailboxAddress, pattern, since, sender }) {
  const login = loginEmail.trim().toLowerCase()
  const mailbox = (mailboxAddress || login).trim().toLowerCase()
  const recipients = [...addresses(parsed.to), ...addresses(parsed.cc)]
  const delivered = String(parsed.headers.get('delivered-to') || '').toLowerCase()
  if (!recipients.includes(login) && !recipients.includes(mailbox) && !delivered.includes(login) && !delivered.includes(mailbox)) return null
  if (sender && !addresses(parsed.from).includes(sender.toLowerCase())) return null
  if (parsed.date && parsed.date.getTime() < new Date(since).getTime()) return null
  return extractOtp(`${parsed.subject || ''}\n${parsed.text || ''}`, pattern)
}

export async function readOtp(config, { loginEmail, mailboxAddress = loginEmail, since }) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false
  })
  await client.connect()
  try {
    await client.mailboxOpen(config.folder || 'INBOX', { readOnly: true })
    const deadline = Date.now() + config.waitSeconds * 1000
    const startUid = client.mailbox.uidNext
    while (Date.now() < deadline) {
      const uids = await client.search({ uid: `${startUid}:*` }, { uid: true })
      for (const uid of (uids || []).slice(-50).reverse()) {
        const item = await client.fetchOne(uid, { source: true, internalDate: true }, { uid: true })
        if (!item?.source || item.internalDate < new Date(since)) continue
        const parsed = await simpleParser(item.source)
        const code = messageOtp(parsed, { ...config, loginEmail, mailboxAddress, since })
        if (code) return code
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
      await client.noop()
    }
    throw new Error('No matching OTP email arrived before the mailbox timeout')
  } finally {
    await client.logout().catch(() => client.close())
  }
}
