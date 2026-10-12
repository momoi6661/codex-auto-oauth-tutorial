import { writeFile } from 'node:fs/promises'
import { loadConfig } from './config.mjs'
import { buildTask } from './task.mjs'
import { authorizeWithProtocol, executeScript } from './reference-core/index.mjs'

const controller = new AbortController()
const cancel = () => controller.abort()
process.once('SIGINT', cancel)
try {
  const config = loadConfig()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)])
  const result = await authorizeWithProtocol(buildTask(config), executeScript, signal,
    step => console.log(`[${step}]`))
  if (result.type !== 'auth_file') {
    // Only normalized protocol errors are printed; no response bodies or tokens.
    console.error(`Authorization stopped: ${result.error.code}: ${result.error.message}`)
    process.exitCode = 1
  } else {
    await writeFile(config.output, JSON.stringify(JSON.parse(result.auth), null, 2), { mode: 0o600 })
    console.log(`Saved ${config.output}`)
  }
} catch (error) {
  console.error(`Authorization stopped (${error.code || error.name}); check the configuration and output path`)
  process.exitCode = 1
} finally {
  process.removeListener('SIGINT', cancel)
}
