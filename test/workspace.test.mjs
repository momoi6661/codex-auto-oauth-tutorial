import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseWorkspace } from '../src/workspace.mjs'

const personal = { id: 'personal-1', title: 'Personal', is_personal: true }
const team = { id: 'team-1', title: 'Example Team' }

test('index 0 selects personal space', () => {
  assert.equal(chooseWorkspace([team, personal], { index: 0 }).id, 'personal-1')
})

test('automatically falls back to personal when there are no teams', () => {
  assert.equal(chooseWorkspace([personal], { index: 1 }).id, 'personal-1')
})

test('team index has priority when a team exists', () => {
  assert.equal(chooseWorkspace([personal, team], { index: 1 }).id, 'team-1')
})
