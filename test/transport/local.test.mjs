import 'dotenv/config'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createCurlCffiFetch } from '../../src/reference-core/curl-cffi-fetch.mjs'

test('Python curl bridge keeps one session and returns JSON, cookies and manual redirects', async t => {
  const server = createServer((request, response) => {
    if (request.url === '/start') {
      response.writeHead(302, { 'Set-Cookie': 'local-session=present; Path=/', Location: '/done' })
      response.end()
    } else {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ cookie: request.headers.cookie || '', agent: request.headers['user-agent'] }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const transport = createCurlCffiFetch()
  t.after(() => transport.close())
  const base = `http://127.0.0.1:${server.address().port}`
  const options = { signal: AbortSignal.timeout(15_000) }
  const start = await transport.fetch(base + '/start', options)
  assert.equal(start.status, 302)
  assert.equal(start.headers.get('location'), '/done')
  assert.ok(start.headers.raw()['set-cookie'].some(value => value.includes('local-session=present')))
  const done = await transport.fetch(base + '/done', options)
  assert.equal(done.status, 200)
  const data = JSON.parse(await done.text())
  assert.match(data.cookie, /local-session=present/)
  assert.match(data.agent, /Chrome\/142/)
})
