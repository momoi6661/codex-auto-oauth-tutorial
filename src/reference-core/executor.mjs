import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const failure = (code, message, retryable = false) => ({ type: 'error', error: { code, message, retryable } })

const interrupted = signal => signal?.reason?.name === 'TimeoutError'
  ? failure('AUTH_TIMEOUT', 'Authorization did not complete within its deadline', true)
  : failure('TASK_CANCELLED', 'Task cancelled')

export function executeScript(task, { timeout = 30_000, signal } = {}) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(interrupted(signal))
    const child = spawn(process.execPath, ['--max-old-space-size=128', fileURLToPath(new URL('./script-process.mjs', import.meta.url))], {
      stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH || '', SYSTEMROOT: process.env.SYSTEMROOT || '' }
    })
    let output = '', settled = false
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      child.kill(); resolve(result)
    }
    const abort = () => finish(interrupted(signal))
    const timer = setTimeout(() => finish(failure('SCRIPT_TIMEOUT', `Script exceeded ${timeout / 1000} seconds`, true)), timeout)
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', () => finish(failure('EXECUTOR_UNAVAILABLE', 'Code executor unavailable')))
    child.stdin.on('error', () => finish(failure('EXECUTOR_UNAVAILABLE', 'Code executor unavailable')))
    child.stdout.on('data', data => {
      output += data.toString()
      if (output.length > 131072) finish(failure('RESULT_TOO_LARGE', 'Script result exceeds size limit'))
    })
    child.on('close', () => {
      if (settled) return
      try { finish(JSON.parse(output)) } catch { finish(failure('INVALID_SCRIPT_RESULT', 'Code executor returned invalid output')) }
    })
    child.stdin.end(JSON.stringify(task))
  })
}
