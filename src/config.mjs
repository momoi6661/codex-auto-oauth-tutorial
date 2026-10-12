import 'dotenv/config'

const required = name => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}; copy .env.example to .env and fill it in`)
  return value
}

export function loadConfig() {
  return {
    email: required('LOGIN_EMAIL'),
    mailbox: {
      host: required('IMAP_HOST'),
      port: Number(process.env.IMAP_PORT || 993),
      user: required('IMAP_USER'),
      password: required('IMAP_PASSWORD'),
      folder: process.env.IMAP_FOLDER || 'INBOX',
      waitSeconds: Math.min(180, Math.max(30, Number(process.env.MAILBOX_WAIT_SECONDS || 90))),
      pattern: new RegExp(process.env.OTP_PATTERN || '\\b(\\d{6})\\b')
    },
    output: process.env.OUTPUT_FILE || 'codex-auth.json'
  }
}
