'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { SessionService } = require('../src/session-service.js')

test('forkSession calls session.fork with the source session id', async () => {
  const calls = []
  const fakeClient = {
    call: async (method, payload) => {
      calls.push({ method, payload })
      return { sessionId: 'session-child' }
    },
  }
  const service = new SessionService(() => fakeClient)

  const result = await service.forkSession('session-source')

  assert.equal(result.sessionId, 'session-child')
  assert.deepEqual(calls, [{ method: 'session.fork', payload: { sessionId: 'session-source' } }])
})

test('forkSession forwards atSeq when provided', async () => {
  const calls = []
  const fakeClient = {
    call: async (method, payload) => {
      calls.push({ method, payload })
      return { sessionId: 'session-child' }
    },
  }
  const service = new SessionService(() => fakeClient)

  const result = await service.forkSession('session-source', 12)

  assert.equal(result.sessionId, 'session-child')
  assert.deepEqual(calls, [{ method: 'session.fork', payload: { sessionId: 'session-source', atSeq: 12 } }])
})

test('listUngroupedSessions keeps only unaccounted, non-archived, cwd-matched sessions', async () => {
  const fakeClient = {
    call: async (method) => {
      if (method === 'workspace.list') {
        return {
          items: [
            { workspaceId: 'ws-1', path: '/ws1', sessionIds: ['s1', 's2'] },
            { workspaceId: 'ws-2', path: '/ws2', sessionIds: ['s3'] },
          ],
          archivedSessionIds: ['s4'],
        }
      }
      if (method === 'session.list') {
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
      }
      throw new Error('unexpected method ' + method)
    },
  }
  const service = new SessionService(() => fakeClient)

  const result = await service.listUngroupedSessions('ws-1')

  assert.equal(result.workspaceId, 'ws-1')
  assert.deepEqual(result.items.map((item) => item.sessionId), ['s6', 's8'])
})

test('listUngroupedSessions returns empty for an unknown workspace', async () => {
  const fakeClient = {
    call: async (method) => {
      if (method === 'workspace.list') {
        return { items: [{ workspaceId: 'ws-1', path: '/ws1', sessionIds: [] }], archivedSessionIds: [] }
      }
      return { items: [{ sessionId: 's9', cwd: '/ws1', updatedAt: 1 }] }
    },
  }
  const service = new SessionService(() => fakeClient)

  const result = await service.listUngroupedSessions('ws-missing')

  assert.deepEqual(result, { workspaceId: 'ws-missing', items: [] })
})

test('attachUngroupedSession calls session.create with the existing session id and target workspace', async () => {
  const calls = []
  const fakeClient = {
    call: async (method, payload) => {
      calls.push({ method, payload })
      return { sessionId: 's6' }
    },
  }
  const service = new SessionService(() => fakeClient)

  const result = await service.attachUngroupedSession('s6', 'ws-1')

  assert.equal(result.sessionId, 's6')
  assert.deepEqual(calls, [{ method: 'session.create', payload: { sessionId: 's6', workspaceId: 'ws-1' } }])
})
