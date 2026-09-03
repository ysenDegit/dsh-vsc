'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { WireClient } = require('../src/wire.js')

test('WireClient.call aborts a hung RPC with a clear timeout error', async () => {
  const wire = new WireClient('http://127.0.0.1:9')
  const originalFetch = global.fetch
  global.fetch = (url, options) => new Promise((resolve, reject) => {
    const signal = options && options.signal
    if (signal) {
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    }
    // 故意不 resolve：模拟 dsh 服务挂起。
  })
  try {
    await assert.rejects(
      wire.call('workspace.list', {}, undefined, 20),
      /超时/u,
    )
  } finally {
    global.fetch = originalFetch
  }
})
