import 'dotenv/config'

export function loadConfig(env = process.env) {
  const required = name => {
    const value = env[name]
    if (!value?.trim()) throw new Error(`Missing ${name}; copy .env.example to .env and fill it in`)
    return name === 'IMAP_PASSWORD' ? value : value.trim()
  }
  const integer = (name, fallback, min, max) => {
    const value = Number(env[name] || fallback)
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be an integer from ${min} to ${max}`)
    }
    return value
  }
  const codePattern = env.OTP_PATTERN || '\\b(\\d{6})\\b'
  new RegExp(codePattern)
  return {
    email: required('LOGIN_EMAIL'),
    mailbox: {
      host: required('IMAP_HOST'),
      port: integer('IMAP_PORT', 993, 1, 65535),
      user: required('IMAP_USER'),
      password: required('IMAP_PASSWORD'),
      folder: env.IMAP_FOLDER || 'INBOX',
      waitSeconds: integer('MAILBOX_WAIT_SECONDS', 90, 30, 180),
      codePattern,
      pattern: new RegExp(codePattern),
      senderFilter: env.OTP_SENDER?.trim() || ''
    },
    mailboxAddress: env.MAILBOX_ADDRESS?.trim() || required('IMAP_USER'),
    workspaceIndex: integer('WORKSPACE_INDEX', 1, 0, Number.MAX_SAFE_INTEGER),
    expectedAccountId: env.EXPECTED_ACCOUNT_ID?.trim() || '',
    resendAfterSeconds: integer('EMAIL_RESEND_SECONDS', 30, 10, 90),
    proxyURL: env.AUTH_PROXY_URL?.trim() || '',
    output: env.OUTPUT_FILE || 'codex-auth.json'
  }
}
