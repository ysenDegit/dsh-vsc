'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { DshService } = require('../src/dsh-service.js')

function makeService() {
  return new DshService({})
}

test('webUrl is null before any instance is selected', () => {
  assert.equal(makeService().webUrl, null)
})

test('webUrl falls back to the plain baseUrl when no launch token is known', () => {
  const dsh = makeService()
  dsh.baseUrlValue = 'http://127.0.0.1:3080'
  dsh.token = null
  assert.equal(dsh.webUrl, 'http://127.0.0.1:3080/')
})

test('webUrl carries the launch token so the browser can exchange it for a cookie', () => {
  const dsh = makeService()
  dsh.baseUrlValue = 'http://127.0.0.1:3080'
  dsh.token = 'abc-123_XYZ'
  assert.equal(dsh.webUrl, 'http://127.0.0.1:3080/?token=abc-123_XYZ')
})

/**
 * 模拟 dsh web：`GET /?token=<已见过>` 返回 303 + set-cookie（换 cookie 成功），
 * 其它 token 返回无 set-cookie 的 401；`/api/*` 一元 RPC 一律返回 ok。
 */
function makeFetchStub(validTokens) {
  return (url, options = {}) => {
    const target = String(url)
    if (target.includes('/api/')) {
      const body = options.body ? JSON.parse(options.body) : {}
      const rpcId = body.rpcId || 'stub'
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ type: 'server-response', rpcId, result: { ok: true, value: {} } }),
      })
    }
    const token = new URL(target).searchParams.get('token')
    if (token && validTokens.includes(token)) {
      return Promise.resolve({
        ok: true,
        status: 303,
        headers: { get: (name) => (String(name).toLowerCase() === 'set-cookie'
          ? 'dsh-auth-x=v1.ab; Max-Age=1; Path=/; HttpOnly'
          : null) },
      })
    }
    return Promise.resolve({ ok: false, status: 401, headers: { get: () => null } })
  }
}

test('ensureAuthToken returns true while the remembered launch token still exchanges', async () => {
  const dsh = makeService()
  dsh.baseUrlValue = 'http://127.0.0.1:3080'
  dsh.token = 'valid-abc'
  const originalFetch = global.fetch
  global.fetch = makeFetchStub(['valid-abc'])
  try {
    assert.equal(await dsh.ensureAuthToken(), true)
  } finally {
    global.fetch = originalFetch
  }
})

test('ensureAuthToken re-prompts on a stale token and applies the supplied URL', async () => {
  const dsh = makeService()
  dsh.baseUrlValue = 'http://127.0.0.1:3080'
  dsh.token = 'stale-old'
  let prompted = false
  dsh.options.onAuthRequired = async () => {
    prompted = true
    return 'http://127.0.0.1:3080/?token=valid-new'
  }
  const originalFetch = global.fetch
  global.fetch = makeFetchStub(['valid-new'])
  try {
    assert.equal(await dsh.ensureAuthToken(), true)
    assert.equal(prompted, true)
    assert.equal(dsh.token, 'valid-new')
    assert.ok(dsh.cookie.startsWith('dsh-auth-x='))
  } finally {
    global.fetch = originalFetch
  }
})

test('ensureAuthToken returns false when the user cancels the token prompt', async () => {
  const dsh = makeService()
  dsh.baseUrlValue = 'http://127.0.0.1:3080'
  dsh.token = 'stale-old'
  dsh.options.onAuthRequired = async () => null
  const originalFetch = global.fetch
  global.fetch = makeFetchStub([])
  try {
    assert.equal(await dsh.ensureAuthToken(), false)
    assert.equal(dsh.token, 'stale-old')
  } finally {
    global.fetch = originalFetch
  }
})

test('ensureAuthToken rejects a supplied URL belonging to a different instance', async () => {
  const dsh = makeService()
  dsh.baseUrlValue = 'http://127.0.0.1:3080'
  dsh.token = 'stale-old'
  dsh.options.onAuthRequired = async () => 'http://127.0.0.1:3090/?token=valid-new'
  const originalFetch = global.fetch
  global.fetch = makeFetchStub(['valid-new'])
  try {
    assert.equal(await dsh.ensureAuthToken(), false)
    assert.equal(dsh.token, 'stale-old')
  } finally {
    global.fetch = originalFetch
  }
})

test('ensureAuthToken probes a tokenless instance before opening', async () => {
  const dsh = makeService()
  dsh.baseUrlValue = 'http://127.0.0.1:3080'
  dsh.token = null
  const originalFetch = global.fetch
  global.fetch = makeFetchStub([])
  try {
    assert.equal(await dsh.ensureAuthToken(), true)
  } finally {
    global.fetch = originalFetch
  }
})
