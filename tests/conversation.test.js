'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { foldEvents, extractImages } = require('../src/conversation.js')

function ev(seq, type, data) { return { seq, time: seq, type, data } }

test('extracts durable image attachment refs from content', () => {
  const ref = { attachmentId: 'att-1', mediaType: 'image/png', bytes: 12, width: 4, height: 4 }
  const images = extractImages([
    { type: 'text', text: 'hello' },
    { type: 'image', attachment: ref },
    { type: 'tool-call', id: 'x', name: 'n', arguments: '{}' },
  ])
  assert.deepEqual(images, [{ attachment: ref }])
  assert.equal(extractImages([]).length, 0)
  assert.equal(extractImages([{ type: 'image' }]).length, 0)
})

test('user message carries image attachments', () => {
  const ref = { attachmentId: 'att-2', mediaType: 'image/jpeg', bytes: 3, width: 1, height: 1 }
  const { items } = foldEvents([
    ev(1, 'user/message', {
      content: [{ type: 'text', text: '看看这个' }, { type: 'image', attachment: ref }],
      source: { kind: 'user' },
    }),
  ])
  assert.equal(items[0].type, 'user')
  assert.equal(items[0].text, '看看这个')
  assert.deepEqual(items[0].images, [{ attachment: ref }])
})

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

test('detailed mode shows every distinct context injection in event order', () => {
  const events = [
    ev(1, 'user/message', { content: [{ type: 'text', text: 'context-1' }], source: { kind: 'plugin', form: 'snapshot' } }),
    ev(2, 'user/message', { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }),
    ev(3, 'user/message', { content: [{ type: 'text', text: 'context-2' }], source: { kind: 'plugin', form: 'snapshot' } }),
  ]
  const { items } = foldEvents(events)
  const contextItems = items.filter((i) => i.type === 'context')
  assert.deepEqual(contextItems.map((i) => i.text), ['context-1', 'context-2'])
  assert.deepEqual(items.map((i) => i.type), ['context', 'user', 'context'])
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

test('tool result matches message.callId (real dsh shape)', () => {
  const events = [
    ev(1, 'tool/call', { turn: 1, step: 1, callId: 'c2', name: 'bash', arguments: '{"cmd":"ls"}' }),
    ev(2, 'tool/result', { turn: 1, step: 1, message: { callId: 'c2', content: [{ type: 'text', text: 'out' }], isError: false } }),
  ]
  const { items } = foldEvents(events)
  assert.equal(items.length, 1)
  assert.equal(items[0].name, 'bash')
  assert.equal(items[0].status, 'result')
  assert.equal(items[0].resultText, 'out')
})

test('command run and done pair by commandId', () => {
  const events = [
    ev(1, 'command/run', { commandId: 'cmd-1', name: 'compact', args: '', source: { kind: 'user' } }),
    ev(2, 'command/done', { commandId: 'cmd-1', kind: 'success', text: '已压缩' }),
  ]
  const { items } = foldEvents(events)
  assert.equal(items.length, 1)
  assert.equal(items[0].type, 'command')
  assert.equal(items[0].name, 'compact')
  assert.equal(items[0].status, 'done')
  assert.deepEqual(items[0].outcome, { kind: 'success', text: '已压缩' })
})

test('command done without run falls back to a done node', () => {
  const { items } = foldEvents([
    ev(1, 'command/done', { commandId: 'cmd-x', kind: 'error', text: 'boom' }),
  ])
  assert.equal(items.length, 1)
  assert.equal(items[0].type, 'command')
  assert.equal(items[0].status, 'done')
  assert.deepEqual(items[0].outcome, { kind: 'error', text: 'boom' })
})

test('running command stays visible until done', () => {
  const { items } = foldEvents([
    ev(1, 'command/run', { commandId: 'cmd-2', name: 'goal', args: ' ship', source: { kind: 'user' } }),
  ])
  assert.equal(items.length, 1)
  assert.equal(items[0].status, 'run')
  assert.equal(items[0].outcome, null)
})

test('turn emits a produced row from diff call views, deduped by path', () => {
  const events = [
    ev(1, 'turn/start', { turn: 1 }),
    { seq: 2, time: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'edit', arguments: '{}' }, view: { for: 'call', view: { card: 'diff', locations: [{ path: '/a/b.txt' }, { path: '/c.txt' }] } } },
    { seq: 3, time: 3, type: 'tool/result', data: { turn: 1, step: 1, message: { callId: 'c1', content: [{ type: 'text', text: 'ok' }], isError: false } } },
    { seq: 4, time: 4, type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'write', arguments: '{}' }, view: { for: 'call', view: { card: 'generic', kind: 'edit', locations: [{ path: '/a/b.txt' }] } } },
    { seq: 5, time: 5, type: 'tool/result', data: { turn: 1, step: 2, message: { callId: 'c2', content: [{ type: 'text', text: 'ok' }], isError: false } } },
    ev(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const { items } = foldEvents(events)
  const produced = items.filter((i) => i.type === 'produced')
  assert.equal(produced.length, 1)
  assert.deepEqual(produced[0].paths, ['/a/b.txt', '/c.txt'])
})

test('produced row skips failed calls and non-mutation views', () => {
  const events = [
    ev(1, 'turn/start', { turn: 1 }),
    { seq: 2, time: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' }, view: { for: 'call', view: { card: 'generic', kind: 'read', locations: [{ path: '/a.txt' }] } } },
    { seq: 3, time: 3, type: 'tool/result', data: { turn: 1, step: 1, message: { callId: 'c1', content: [{ type: 'text', text: 'ok' }], isError: false } } },
    { seq: 4, time: 4, type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'edit', arguments: '{}' }, view: { for: 'call', view: { card: 'diff', locations: [{ path: '/x.txt' }] } } },
    { seq: 5, time: 5, type: 'tool/result', data: { turn: 1, step: 2, message: { callId: 'c2', content: [{ type: 'text', text: 'boom' }], isError: true } } },
    ev(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const { items } = foldEvents(events)
  assert.equal(items.filter((i) => i.type === 'produced').length, 0)
})

test('concise fold keeps only user/assistant-text/command output', () => {
  const events = [
    ev(1, 'turn/start', { turn: 1 }),
    ev(2, 'user/message', { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }),
    ev(3, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'think...' } }),
    ev(4, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'hi' } }),
    ev(5, 'tool/call', { turn: 1, step: 2, callId: 'c1', name: 'read', arguments: '{}' }),
    ev(6, 'tool/result', { turn: 1, step: 2, message: { callId: 'c1', content: [{ type: 'text', text: 'out' }] } }),
    ev(7, 'user/message', { content: [{ type: 'text', text: 'ctx' }], source: { kind: 'plugin' } }),
    ev(8, 'command/run', { commandId: 'cmd-1', name: 'compact', args: '', source: { kind: 'user' } }),
    ev(9, 'command/done', { commandId: 'cmd-1', kind: 'success', text: 'ok' }),
    ev(10, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const { items, running } = foldEvents(events, { mode: 'concise' })
  assert.equal(running, false)
  assert.deepEqual(items.map((i) => i.type), ['user', 'assistant', 'command'])
  const assistant = items.find((i) => i.type === 'assistant')
  assert.equal(assistant.text, 'hi')
  assert.equal(assistant.reasoning, undefined)
  assert.equal(items.some((i) => i.type === 'tool'), false)
  assert.equal(items.some((i) => i.type === 'context'), false)
  assert.equal(items.some((i) => i.type === 'produced'), false)
  assert.equal(items.some((i) => i.type === 'note'), false)
})

test('concise fold omits blank user messages and empty assistant messages', () => {
  const events = [
    ev(1, 'user/message', { content: [{ type: 'text', text: '   ' }], source: { kind: 'user' } }),
    ev(2, 'user/message', { content: [{ type: 'text', text: 'real' }], source: { kind: 'user' } }),
    ev(3, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'tool-call' }] } }),
  ]
  const { items } = foldEvents(events, { mode: 'concise' })
  assert.deepEqual(items.map((i) => i.type), ['user'])
  assert.equal(items[0].text, 'real')
})

test('concise fold reports running state', () => {
  const { running } = foldEvents([ev(1, 'turn/start', { turn: 1 })], { mode: 'concise' })
  assert.equal(running, true)
})

test('concise fold marks hidden-only content so UI can show its hint', () => {
  const { items } = foldEvents([
    ev(1, 'turn/start', { turn: 1 }),
    ev(2, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' }),
    ev(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ], { mode: 'concise' })
  assert.deepEqual(items.map((i) => i.type), ['hidden-hint'])
})

test('live assistant partial is appended while the step is unsettled', () => {
  const events = [
    ev(1, 'turn/start', { turn: 1 }),
    ev(2, 'user/message', { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }),
  ]
  const live = { turn: 1, step: 1, text: 'streaming…', reasoning: 'think', id: 'assistant-live-a1' }
  const detailed = foldEvents(events, { live })
  const last = detailed.items[detailed.items.length - 1]
  assert.equal(last.type, 'assistant')
  assert.equal(last.text, 'streaming…')
  assert.equal(last.reasoning, 'think')
  assert.equal(last.partial, true)
  assert.equal(detailed.running, true)

  // 简洁模式：只显示文本增量，思考增量只置"有隐藏详情"标记。
  const concise = foldEvents(events, { mode: 'concise', live })
  const conciseLast = concise.items[concise.items.length - 1]
  assert.equal(conciseLast.type, 'assistant')
  assert.equal(conciseLast.text, 'streaming…')
  assert.equal(conciseLast.reasoning, undefined)
})

test('durable assistant/message supersedes the live partial for the same step', () => {
  const events = [
    ev(1, 'turn/start', { turn: 1 }),
    ev(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'final' }] }, stream: [] }),
  ]
  const { items } = foldEvents(events, { live: { turn: 1, step: 1, text: 'streaming…', id: 'assistant-live-a1' } })
  const assistants = items.filter((item) => item.type === 'assistant')
  assert.equal(assistants.length, 1)
  assert.equal(assistants[0].text, 'final')
  assert.equal(assistants[0].partial, false)
})

test('detailed mode keeps one entry per context injection and skips wrapper-only lines', () => {
  const injectA = {
    content: [{ type: 'text', text: '<system-reminder>\nAdditional instructions from: sub/AGENTS.md\n\nbody A' }],
    source: { kind: 'agent-instructions' },
  }
  const injectB = {
    content: [{ type: 'text', text: 'This is an automatically generated checkpoint summary.' }],
    source: { kind: 'plugin' },
  }
  const { items } = foldEvents([
    ev(1, 'user/message', { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }),
    ev(2, 'user/message', injectA),
    ev(3, 'user/message', injectB),
    ev(4, 'user/message', injectA),
  ])

  const contexts = items.filter((item) => item.type === 'context')
  assert.equal(contexts.length, 2)
  assert.equal(contexts[0].summary, 'Additional instructions from: sub/AGENTS.md')
  assert.equal(contexts[0].source, 'agent-instructions')
  assert.equal(contexts[1].summary, 'This is an automatically generated checkpoint summary.')
  assert.equal(contexts[1].text, injectB.content[0].text)
})

test('context injections fall back to a source label and stay hidden in concise mode', () => {
  const injection = { content: [], source: { kind: 'session-reference' } }
  const detailed = foldEvents([ev(1, 'user/message', injection)])
  const context = detailed.items.find((item) => item.type === 'context')
  assert.equal(context.summary, '上下文注入：会话引用')
  assert.equal(context.text, '')

  const concise = foldEvents([ev(1, 'user/message', injection)], { mode: 'concise' })
  assert.equal(concise.items.filter((item) => item.type === 'context').length, 0)
  assert.equal(concise.items.length, 1)
  assert.equal(concise.items[0].type, 'hidden-hint')
})

test('folded items carry sourceSeq so the host can trim the loaded window', () => {
  const events = []
  for (let seq = 1; seq <= 20; seq += 1) {
    events.push(ev(seq, 'user/message', { content: [{ type: 'text', text: 'm' + String(seq) }], source: { kind: 'user' } }))
  }
  const { items } = foldEvents(events)
  assert.equal(items.length, 20)
  assert.deepEqual(items.map((item) => item.sourceSeq), events.map((event) => event.seq))

  // 宿主裁剪：保留最近 5 条时，cutSeq 之后的事件足以重建这 5 条。
  const cutSeq = items[items.length - 5].sourceSeq
  const trimmed = foldEvents(events.filter((event) => event.seq >= cutSeq))
  assert.equal(trimmed.items.length, 5)
  assert.deepEqual(trimmed.items.map((item) => item.text), ['m16', 'm17', 'm18', 'm19', 'm20'])
})
