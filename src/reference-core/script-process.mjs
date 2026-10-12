// Adapted from the Sub2API runner (see NOTICE.md and LICENSE).
// The standalone project accepts IMAP tasks only; no custom scripts are run.
let input = ''
for await (const chunk of process.stdin) input += chunk
const failure = (code, message, retryable = false) => ({ type: 'error', error: { code: String(code).slice(0, 80), message: String(message).slice(0, 1000), retryable: retryable === true } })
let result
try {
  const task = JSON.parse(input)
  if (task.mailbox) {
    const { executeMailbox } = await import('./imap-code.mjs')
    result = await executeMailbox(task)
  } else {
    result = failure('MAILBOX_REQUIRED', 'Configure an IMAP mailbox; custom scripts are not supported')
  }
} catch (error) {
  result = failure('MAILBOX_CONNECTION_FAILED', 'The mailbox worker could not complete its task')
}
process.stdout.write(JSON.stringify(result))
