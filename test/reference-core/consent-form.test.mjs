import test from 'node:test'
import assert from 'node:assert/strict'
import { readConsentForm } from '../../src/reference-core/consent-form.mjs'
const url = 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent'

test('consent options preserve order and decode HTML entities without executing scripts', () => {
 const form=readConsentForm(`<form method="post"><input name="csrf" type="hidden" value="secret&amp;value"><select name="workspace_id"><option value="personal">Personal</option><option value="team">A &amp; B</option><option disabled value="disabled">Disabled</option></select><button type="submit" name="intent" value="allow">Continue</button></form><script>throw Error('must not run')</script>`,url)
 assert.deepEqual(form.workspaces,[{id:'personal',title:'Personal'},{id:'team',title:'A & B'}])
 assert.equal(form.action,url)
})

test('unrelated or external forms cannot become consent actions',()=>{
 for(const action of ['https://evil.example/consent','/api/accounts/delete','https://user:password@auth.openai.com/workspace']){
  assert.equal(readConsentForm(`<form action="${action}" method="post"><input name="workspace_id" value="team"></form>`,url),null)
 }
})


test('streamed loader data supplies all choices even when the form only exposes a default hidden ID',()=>{
 const flat=[{"_1":2},"workspaces",[3,8],{"_4":5,"_6":7},"id","personal","name","Personal",{"_4":9,"_6":10},"team","Business"]
 const literal=JSON.stringify(JSON.stringify(flat))
 const html=`<form method="post"><input type="hidden" name="workspace_id" value="personal"></form><script>window.__reactRouterContext.streamController.enqueue(${literal});</script>`
 const form=readConsentForm(html,url)
 assert.deepEqual(form.workspaces,[{id:'personal',title:'Personal',type:'',is_personal:false},{id:'team',title:'Business',type:'',is_personal:false}])
})

test('malformed stream data never executes code and falls back to the rendered form',()=>{
 const html='<form method="post"><input name="workspace_id" value="team"></form><script>streamController.enqueue("not JSON");globalThis.executed=true</script>'
 assert.deepEqual(readConsentForm(html,url).workspaces,[{id:'team',title:''}])
 assert.equal(globalThis.executed,undefined)
})

test('personal consent form preserves hidden fields without inventing a workspace', () => {
 const form=readConsentForm('<form method="post"><input type="hidden" name="csrf" value="secret&amp;value"><button type="submit" name="intent" value="allow">Continue</button></form>',url)
 assert.deepEqual(form.workspaces,[])
 assert.deepEqual(form.fields,[['csrf','secret&value'],['intent','allow']])
})

test('streamed personal structure is preserved for workspace classification', () => {
 const flat=[{"_1":2},"workspaces",[3],{"_4":5,"_6":7},"id","personal-id","structure","personal"]
 const literal=JSON.stringify(JSON.stringify(flat))
 const form=readConsentForm(`<form method="post"></form><script>streamController.enqueue(${literal});</script>`,url)
 assert.equal(form.workspaces[0].type,'personal')
})
