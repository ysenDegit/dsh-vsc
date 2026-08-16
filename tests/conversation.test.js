'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { foldEvents } = require('../src/conversation.js')

function ev(seq, type, data) { return { seq, time: seq, type, data } }

test('folds user message and assistant chunks into items', () => {
  const events = [
    ev(1, 'turn/start', { turn: 1 }),
    ev(2, 'user/message', { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }),
    ev(3, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hi' } }),
    ev(4, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'hi' }] } }),
    ev(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const { items, running } = foldEvents(events)
  assert.equal(running, false)
  assert.deepEqual(items.map((i) => i.type), ['user', 'assistant'])
  assert.equal(items[1].text, 'hi')
})

test('empty partial is removed on turn end', () => {
  const events = [
    ev(1, 'turn/start', { turn: 1 }),
    ev(2, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'error', failure: { message: 'x' } } } }),
    ev(3, 'turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'x' } } }),
  ]
  const { items } = foldEvents(events)
  assert.equal(items.length, 1)
  assert.equal(items[0].type, 'note')
})

test('keeps only the latest context injection', () => {
  const events = [
    ev(1, 'user/message', { content: [{ type: 'text', text: 'context-1' }], source: { kind: 'plugin', form: 'snapshot' } }),
    ev(2, 'user/message', { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }),
    ev(3, 'user/message', { content: [{ type: 'text', text: 'context-2' }], source: { kind: 'plugin', form: 'snapshot' } }),
  ]
  const { items } = foldEvents(events)
  const contextItems = items.filter((i) => i.type === 'context')
  assert.equal(contextItems.length, 1)
  assert.equal(contextItems[0].text, 'context-2')
})

test('tool call and result pair by callId', () => {
  const events = [
    ev(1, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' }),
    ev(2, 'tool/result', { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } }),
  ]
  const { items } = foldEvents(events)
  assert.equal(items.length, 1)
  assert.equal(items[0].status, 'result')
  assert.equal(items[0].resultText, 'ok')
})
