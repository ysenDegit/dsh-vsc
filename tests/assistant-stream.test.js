'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { LiveAssistantStream, expandAssistantStreamRecords } = require('../src/assistant-stream.js')

test('expandAssistantStreamRecords reconstructs timed deltas from packed runs', () => {
  const chunks = expandAssistantStreamRecords([
    { type: 'text-chunks', time0: 10, index: 0, dt: [5, 5], texts: ['a', 'b', 'c'] },
    { type: 'chunk', time: 30, chunk: { type: 'usage', usage: {} } },
    { type: 'reasoning-chunks', time0: 40, index: 0, dt: [], texts: ['r'] },
    { type: 'tool-call-chunks', time0: 50, index: 1, dt: [1], id: 'c1', name: 'fs', args: ['{"pa', 'th":1}'] },
  ])
  assert.deepEqual(chunks.map((c) => [c.time, c.chunk.type]), [
    [10, 'text-delta'], [15, 'text-delta'], [20, 'text-delta'], [30, 'usage'],
    [40, 'reasoning-delta'], [50, 'tool-call-delta'], [51, 'tool-call-delta'],
  ])
  assert.equal(chunks[2].chunk.text, 'c')
  assert.equal(chunks[6].chunk.argumentsDelta, 'th":1}')
})

test('LiveAssistantStream accumulates ordered text and reasoning deltas', () => {
  const live = new LiveAssistantStream()
  assert.equal(live.accept({ type: 'start', attemptId: 'a1', turn: 1, step: 2 }), false)
  assert.equal(live.accept({ type: 'chunk', attemptId: 'a1', index: 0, chunk: { type: 'text-delta', text: 'he' } }), true)
  assert.equal(live.accept({ type: 'chunk', attemptId: 'a1', index: 1, chunk: { type: 'reasoning-delta', text: 'r' } }), true)
  // 序号缺口：忽略，等 durable 结算。
  assert.equal(live.accept({ type: 'chunk', attemptId: 'a1', index: 5, chunk: { type: 'text-delta', text: 'x' } }), false)
  assert.equal(live.accept({ type: 'chunk', attemptId: 'a1', index: 2, chunk: { type: 'text-delta', text: 'llo' } }), true)
  const snapshot = live.snapshot()
  assert.equal(snapshot.text, 'hello')
  assert.equal(snapshot.reasoning, 'r')
  assert.equal(snapshot.partial, true)
  // 结算帧不清内容；durable 事件到达时由调用方 clear()。
  assert.equal(live.accept({ type: 'end', attemptId: 'a1', index: 3, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 9 } }), false)
  assert.equal(live.snapshot().text, 'hello')
  assert.equal(live.clear(), true)
  assert.equal(live.snapshot(), null)
})

test('LiveAssistantStream drops content for abandoned attempts and mismatched attempts', () => {
  const live = new LiveAssistantStream()
  live.accept({ type: 'start', attemptId: 'a1', turn: 1, step: 1 })
  live.accept({ type: 'chunk', attemptId: 'a1', index: 0, chunk: { type: 'text-delta', text: 'partial' } })
  assert.equal(live.accept({ type: 'chunk', attemptId: 'other', index: 1, chunk: { type: 'text-delta', text: 'x' } }), false)
  assert.equal(live.accept({ type: 'end', attemptId: 'a1', index: 1, outcome: { kind: 'abandoned' } }), true)
  assert.equal(live.snapshot(), null)
})

test('LiveAssistantStream seeds from a reconnect baseline and reports settlements', () => {
  const live = new LiveAssistantStream()
  const seeded = live.seed({
    revision: 3,
    activeAttempt: {
      attemptId: 'a9', turn: 2, step: 1, nextIndex: 1,
      stream: [{ type: 'text-chunks', time0: 1, index: 0, dt: [1], texts: ['ab', 'cd'] }],
    },
  })
  assert.equal(seeded, true)
  // nextIndex 表示快照已交付的 chunk 数：1 只还原第一个 delta 成员。
  assert.equal(live.snapshot().text, 'ab')
  assert.equal(live.matchesSettlement('assistant/message', { turn: 2, step: 1 }), true)
  assert.equal(live.matchesSettlement('assistant/message', { turn: 3, step: 1 }), false)
  assert.equal(live.matchesSettlement('tool/call', { turn: 2, step: 1 }), false)
  assert.equal(live.seed(undefined), false)
})
