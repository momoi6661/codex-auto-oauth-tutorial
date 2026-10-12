import { writeFile } from 'node:fs/promises'
import { loadConfig } from './config.mjs'
import { oneClickAuthorize } from './protocol.mjs'
import { readOtp } from './mailbox.mjs'

const config = loadConfig()
console.log('Starting Codex OAuth teaching flow for', config.email)
await oneClickAuthorize({
  email: config.email,
  readCode: ({ since, email }) => readOtp(config.mailbox, { since, loginEmail: email }),
  report: (step, details = {}) => console.log(`[${step}]`, details.authorizationUrl || '')
}).then(async result => {
  await writeFile(config.output, JSON.stringify(result, null, 2), { mode: 0o600 })
  console.log(`Saved ${config.output}`)
}).catch(error => {
  console.error(`Authorization stopped: ${error.message}`)
  process.exitCode = 1
})
