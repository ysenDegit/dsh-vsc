'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { SessionService, sessionPresetOf, historyRecordEvent } = require('../src/session-service.js')

function fakeClient(handler) {
  return {
    call: handler,
    callArgs: async (endpoint, args) => handler(endpoint, args || {}),
  }
}

test('forkSession calls session/fork with the source session id', async () => {
  const calls = []
  const client = fakeClient(async (endpoint, args) => {
    calls.push({ endpoint, args })
    return { sessionId: 'session-child' }
  })
  const service = new SessionService(() => client)

  const result = await service.forkSession('session-source')

  assert.equal(result.sessionId, 'session-child')
  assert.deepEqual(calls, [{ endpoint: 'session/fork', args: { request: { sessionId: 'session-source' } } }])
})

test('forkSession forwards atSeq when provided', async () => {
  const calls = []
  const client = fakeClient(async (endpoint, args) => {
    calls.push({ endpoint, args })
    return { sessionId: 'session-child' }
  })
  const service = new SessionService(() => client)

  const result = await service.forkSession('session-source', 12)

  assert.equal(result.sessionId, 'session-child')
  assert.deepEqual(calls, [{ endpoint: 'session/fork', args: { request: { sessionId: 'session-source', atSeq: 12 } } }])
})

test('listUngroupedSessions keeps only unaccounted, non-archived, cwd-matched sessions', async () => {
  const client = fakeClient(async (endpoint) => {
    if (endpoint !== 'session/list') throw new Error('unexpected endpoint ' + endpoint)
    return {
      items: [
        { sessionId: 's1', cwd: '/ws1', updatedAt: 100 },
        { sessionId: 's2', cwd: '/ws1', updatedAt: 200 },
        { sessionId: 's4', cwd: '/ws1', updatedAt: 300 },
        { sessionId: 's5', cwd: '/ws1', origin: 'subagent', updatedAt: 400 },
        { sessionId: 's6', cwd: '/ws1', updatedAt: 500 },
        { sessionId: 's7', cwd: '/other', updatedAt: 600 },
        { sessionId: 's8', cwd: '/ws1', updatedAt: 50 },
      ],
    }
  })
  const service = new SessionService(() => client)
  service.applyWorkspaceFrame({
    type: 'baseline',
    value: {
      items: [
        { workspaceId: 'ws-1', path: '/ws1', sessionIds: ['s1', 's2'] },
        { workspaceId: 'ws-2', path: '/ws2', sessionIds: ['s3'] },
      ],
      archivedSessionIds: ['s4'],
    },
  })

  const result = await service.listUngroupedSessions('ws-1')

  assert.equal(result.workspaceId, 'ws-1')
  assert.deepEqual(result.items.map((item) => item.sessionId), ['s6', 's8'])
})

test('listUngroupedSessions returns empty for an unknown workspace', async () => {
  const client = fakeClient(async () => ({ items: [{ sessionId: 's9', cwd: '/ws1', updatedAt: 1 }] }))
  const service = new SessionService(() => client)
  service.applyWorkspaceFrame({
    type: 'baseline',
    value: { items: [{ workspaceId: 'ws-1', path: '/ws1', sessionIds: [] }], archivedSessionIds: [] },
  })

  const result = await service.listUngroupedSessions('ws-missing')

  assert.deepEqual(result, { workspaceId: 'ws-missing', items: [] })
})

test('attachUngroupedSession calls session/create with the existing session id and target workspace', async () => {
  const calls = []
  const client = fakeClient(async (endpoint, args) => {
    calls.push({ endpoint, args })
    return { sessionId: 's6' }
  })
  const service = new SessionService(() => client)

  const result = await service.attachUngroupedSession('s6', 'ws-1')

  assert.equal(result.sessionId, 's6')
  assert.deepEqual(calls, [{ endpoint: 'session/create', args: { request: { sessionId: 's6', workspaceId: 'ws-1' } } }])
})

test('reset re-arms the workspace baseline wait after clearing the cache', async () => {
  const service = new SessionService(() => null)
  const baseline = {
    type: 'baseline',
    value: { items: [{ workspaceId: 'ws-1', path: '/ws1', sessionIds: [] }], archivedSessionIds: [] },
  }
  service.applyWorkspaceFrame(baseline)
  assert.equal((await service.findWorkspace('/ws1'))?.workspaceId, 'ws-1')

  service.reset()
  // 缓存已清空（调用方须重开 workspace/follow 让服务器重发 baseline）。
  assert.equal(await service.findWorkspace('/ws1'), null)

  // reset 后 whenWorkspaceReady 必须重新等待下一条 baseline，而不是瞬间返回。
  let resolved = false
  const waiting = service.whenWorkspaceReady().then(() => { resolved = true })
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(resolved, false)

  service.applyWorkspaceFrame(baseline)
  await waiting
  assert.equal(resolved, true)
  assert.equal((await service.findWorkspace('/ws1'))?.workspaceId, 'ws-1')
})

test('executeCommand sends dsh 0.1.5 submittedAttachments and normalizes legacy image objects', async () => {
  const calls = []
  const client = fakeClient(async (endpoint, args) => {
    calls.push({ endpoint, args })
    return { commandId: 'cmd-1', result: { kind: 'success' } }
  })
  const service = new SessionService(() => client)

  await service.executeCommand('session-1', '/permission read-only')
  assert.deepEqual(calls[0], {
    endpoint: 'commands/execute',
    args: { agentId: 'session-1', line: '/permission read-only', submittedAttachments: [] },
  })

  await service.executeCommand('session-1', '/cmd', [
    { mediaType: 'image/png', data: 'aGk=', name: 'a.png' },
    { type: 'image', mediaType: 'image/jpeg', data: 'aGk=' },
    { type: 'file', receiptId: 'r-1' },
    { mediaType: 'image/png' },
  ])
  assert.deepEqual(calls[1].args.submittedAttachments, [
    { type: 'image', mediaType: 'image/png', data: 'aGk=', name: 'a.png' },
    { type: 'image', mediaType: 'image/jpeg', data: 'aGk=' },
    { type: 'file', receiptId: 'r-1' },
  ])
})

test('sessionPresetOf reads the agentPreset projection before the legacy top-level field', () => {
  assert.equal(sessionPresetOf({ projections: { values: { agentPreset: 'minimal' } } }), 'minimal')
  assert.equal(sessionPresetOf({ agentPreset: 'standard' }), 'standard')
  assert.equal(sessionPresetOf({ projections: { values: {} }, agentPreset: 'ptc' }), 'ptc')
  assert.equal(sessionPresetOf({}), null)
  assert.equal(sessionPresetOf(null), null)
})

test('workspace order frames reorder the cached workspace list', () => {
  const service = new SessionService(() => null)
  service.applyWorkspaceFrame({
    type: 'baseline',
    value: {
      items: [
        { workspaceId: 'ws-1', path: '/a', sessionIds: [] },
        { workspaceId: 'ws-2', path: '/b', sessionIds: [] },
        { workspaceId: 'ws-3', path: '/c', sessionIds: [] },
      ],
      archivedSessionIds: [],
    },
  })

  service.applyWorkspaceFrame({ type: 'order', workspaceIds: ['ws-3', 'ws-1'] })

  assert.deepEqual(service.workspaces.map((w) => w.workspaceId), ['ws-3', 'ws-1', 'ws-2'])
})

test('historyRecordEvent passes through 0.1.5 event records and ignores legacy packed rows', () => {
  const event = { type: 'user/message', seq: 3, time: 30, data: {} }
  assert.deepEqual(historyRecordEvent({ type: 'event', event }), [{ event, time: 30 }])
  assert.deepEqual(historyRecordEvent({ type: 'chunks', event: { seq: 1, data: {} } }), [])
  assert.deepEqual(historyRecordEvent(null), [])
})

test('locals unarchive set subtracts from the host archive set', async () => {
  const service = new SessionService(() => null)
  service.applyWorkspaceFrame({
    type: 'baseline',
    value: {
      items: [{ workspaceId: 'ws-1', path: '/ws1', sessionIds: ['s1', 's2'] }],
      archivedSessionIds: ['s1', 's2'],
    },
  })
  assert.equal(service.isArchived('s1'), true)

  service.setArchivedIgnored(['s1'])

  assert.equal(service.isArchived('s1'), false)
  assert.equal(service.isArchived('s2'), true)
  assert.deepEqual(service.effectiveArchivedSet().size, 1)
})

test('uploadFile and openWorkspacePath use the 0.1.5 payloads', async () => {
  const calls = []
  const client = fakeClient(async (endpoint, args) => {
    calls.push({ endpoint, args })
    if (endpoint === 'fileUploads/upload') return { receiptId: 'r-1', file: {} }
    return { items: [] }
  })
  const service = new SessionService(() => client)

  const uploaded = await service.uploadFile('session-1', 'aGk=', 'a.txt')
  assert.equal(uploaded.receiptId, 'r-1')
  await service.openWorkspacePath('/tmp/x', 'reveal')

  assert.deepEqual(calls[0], { endpoint: 'fileUploads/upload', args: { agentId: 'session-1', request: { data: 'aGk=', name: 'a.txt' } } })
  assert.deepEqual(calls[1], { endpoint: 'session/openWorkspacePath', args: { request: { path: '/tmp/x', action: 'reveal' } } })
})
