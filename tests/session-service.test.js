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
