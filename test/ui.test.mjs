import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUIServer } from '../src/ui-server.mjs'

const settings = { IMAP_HOST:'imap.example.com', IMAP_USER:'inbox@example.com',
  IMAP_PASSWORD:'test-app-password', AUTH_PROXY_URL:'http://127.0.0.1:7890' }
async function start(t, authorize, directory) {
  const dataDirectory = directory || await mkdtemp(join(tmpdir(),'codex-oauth-ui-'))
  if (!directory) t.after(() => rm(dataDirectory,{recursive:true,force:true}))
  const server = await createUIServer({ dataDirectory, authorize })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const base = `http://127.0.0.1:${server.address().port}`
  const html = await (await fetch(base)).text()
  const token = /name="session-token" content="([a-f0-9]+)"/.exec(html)[1]
  const api = async (path, body) => {
    const response = await fetch(base + path, { method:body === undefined ? 'GET':'POST',
      headers:{'x-session-token':token, ...(body === undefined ? {} : {'Content-Type':'application/json'})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}) })
    return { status:response.status, data:await response.json() }
  }
  return { base, api, dataDirectory }
}
async function finished(api) {
  for (let i=0;i<100;i++) {
    const { data } = await api('/api/job')
    if (data.status !== 'running') return data
    await new Promise(resolve => setTimeout(resolve,10))
  }
  assert.fail('UI job did not finish')
}

test('UI persists reusable profiles but never returns mailbox passwords', async t => {
  const app = await start(t)
  const saved = await app.api('/api/profiles',{name:'收信配置',settings})
  assert.equal(saved.status,200)
  assert.equal(saved.data.hasPassword,true)
  assert.equal(saved.data.settings.IMAP_PASSWORD,undefined)
  const edit = await app.api('/api/profiles',{id:saved.data.id,name:'改名',settings:{IMAP_PASSWORD:''}})
  assert.equal(edit.status,200)
  const stored = JSON.parse(await readFile(join(app.dataDirectory,'profiles.json'),'utf8'))
  assert.equal(stored[0].settings.IMAP_PASSWORD,settings.IMAP_PASSWORD)
  const restarted = await start(t,undefined,app.dataDirectory)
  const list = await restarted.api('/api/profiles')
  assert.equal(list.data[0].name,'改名')
  assert.ok(!JSON.stringify(list.data).includes(settings.IMAP_PASSWORD))
})

test('UI routes profile, login email, workspace and proxy to the full core and saves a downloadable result', async t => {
  let calls=0
  const app = await start(t,async (task,execute,signal,report) => {
    calls++
    assert.equal(task.context.loginEmail,'owner@example.com')
    assert.equal(task.context.workspaceIndex,0)
    assert.equal(task.context.secret,settings.IMAP_PASSWORD)
    assert.equal(task.mailbox.username,'inbox@example.com')
    assert.equal(task.proxyURL,settings.AUTH_PROXY_URL)
    assert.equal(typeof execute,'function')
    assert.equal(signal.aborted,false)
    report('consent')
    return {type:'auth_file',auth:JSON.stringify({email:'owner@example.com',account_id:'personal',access_token:'test-token'})}
  })
  const profile = (await app.api('/api/profiles',{name:'配置',settings})).data
  assert.equal((await app.api('/api/job',{profileId:profile.id,email:'owner@example.com',workspaceIndex:0})).status,202)
  const job = await finished(app.api)
  assert.equal(job.status,'succeeded')
  assert.deepEqual(job.stages,['preparing','consent','saved'])
  assert.ok(!JSON.stringify(job).includes('test-token'))
  const download = await app.api('/api/job/auth')
  assert.equal(download.data.access_token,'test-token')
  await app.api('/api/job')
  await app.api('/api/job/auth')
  assert.equal(calls,1,'polling/download must not resubmit OAuth')
})

test('UI rejects duplicate running jobs and cancel reaches the protocol signal', async t => {
  const app = await start(t,async (_task,_execute,signal) => {
    await new Promise(resolve => signal.addEventListener('abort',resolve,{once:true}))
    return {type:'error',error:{code:'TASK_CANCELLED',message:'cancelled'}}
  })
  const profile = (await app.api('/api/profiles',{name:'配置',settings})).data
  const body={profileId:profile.id,email:'owner@example.com',workspaceIndex:1}
  await app.api('/api/job',body)
  assert.equal((await app.api('/api/job',body)).status,409)
  await app.api('/api/job/cancel',{})
  assert.equal((await finished(app.api)).error.code,'TASK_CANCELLED')
  assert.equal((await app.api('/api/job/auth')).status,409)
})

test('local UI API requires its session and rejects invalid workspace input before OAuth', async t => {
  let calls=0
  const app=await start(t,async () => {calls++;throw new Error('must not run')})
  assert.equal((await fetch(app.base+'/api/profiles')).status,403)
  assert.equal((await fetch(app.base+'/api/profiles',{headers:{host:'other.invalid','x-session-token':'bad'}})).status,403)
  const profile=(await app.api('/api/profiles',{name:'配置',settings})).data
  assert.equal((await app.api('/api/job',{profileId:profile.id,email:'owner@example.com',workspaceIndex:-1})).status,400)
  assert.equal(calls,0)
})
