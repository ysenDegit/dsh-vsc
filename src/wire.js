'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')

// 普通 RPC 的默认超时：dsh 服务卡住时不无限挂起界面。
const DEFAULT_RPC_TIMEOUT_MS = 60_000
// 浏览器 launch-token 换 cookie 的默认超时。
const DEFAULT_AUTH_TIMEOUT_MS = 10_000

class DshRpcError extends Error {
  constructor(error) {
    super(error.message)
    this.name = 'DshRpcError'
    this.code = error.code
    this.details = error.details
  }
}

function loadWebSocketImpl() {
  if (typeof WebSocket === 'function') return WebSocket
  try {
    // Some VS Code extension hosts run on Node versions without a global
    // WebSocket. In that case the `ws` package must be available.
    return require('ws')
  } catch {
    throw new Error('当前 Node 运行时没有全局 WebSocket，且未安装 `ws` 依赖，无法连接 dsh 事件流。')
  }
}

/**
 * 从 dsh 打印的带 token 的 URL 中提取干净 baseUrl 与 launch token。
 */
function extractTokenFromUrl(input) {
  const url = new URL(input)
  const token = url.searchParams.get('token') || null
  return { baseUrl: url.origin, token }
}

/**
 * 用 dsh web 打印的 launch token 换取浏览器认证 cookie。
 * dsh 0.1.2-rc.1 起每个进程都生成新的 token；`GET /?token=...` 返回 303 +
 * `set-cookie: dsh-auth-<hash>=v1...`，之后所有 `/api` 请求和 WS upgrade 都必须带该 cookie。
 */
async function exchangeLaunchToken(baseUrl, token, timeoutMs = DEFAULT_AUTH_TIMEOUT_MS) {
  const url = new URL(baseUrl)
  url.pathname = '/'
  url.search = ''
  url.searchParams.set('token', token)
  const { signal, cancel } = withTimeout(timeoutMs)
  try {
    const response = await fetch(url.href, { redirect: 'manual', signal })
    const setCookie = response.headers.get('set-cookie')
    if (!setCookie) {
      throw new Error('dsh web 未返回认证 cookie（token 可能已过期）')
    }
    return setCookie.split(';')[0].trim()
  } finally {
    cancel()
  }
}

class WireClient {
  constructor(baseUrl, cookie) {
    this.baseUrl = baseUrl.replace(/\/+$/u, '')
    this.cookie = cookie || ''
  }

  headers() {
    return {
      'content-type': 'application/json',
      ...(this.cookie ? { cookie: this.cookie } : {}),
    }
  }

  async respond(message, signal, timeoutMs = DEFAULT_RPC_TIMEOUT_MS) {
    let timeout = null
    if (!signal) {
      timeout = withTimeout(timeoutMs)
      signal = timeout.signal
    }
    let response
    try {
      response = await fetch(`${this.baseUrl}/api/respond`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(message),
        signal,
      })
    } catch (error) {
      if (timeout && timeout.signal.aborted) {
        throw new Error(`dsh web respond 超时（${timeoutMs}ms）`)
      }
      throw new Error(`dsh web respond 传输失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      timeout?.cancel()
    }
    if (!response.ok) {
      throw new Error(`dsh web respond 载体错误: HTTP ${response.status}`)
    }
    try {
      return await response.json()
    } catch {
      throw new Error('dsh web respond 响应不是 JSON')
    }
  }

  async call(method, payload, signal, timeoutMs = DEFAULT_RPC_TIMEOUT_MS) {
    const rpcId = randomUUID()
    const body = { type: 'client-request', rpcId, method, payload }
    let timeout = null
    if (!signal) {
      timeout = withTimeout(timeoutMs)
      signal = timeout.signal
    }
    let response
    try {
      response = await fetch(`${this.baseUrl}/api/${method}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (timeout && timeout.signal.aborted) {
        throw new Error(`dsh web RPC ${method} 超时（${timeoutMs}ms）`)
      }
      throw new Error(`dsh web RPC ${method} 传输失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      timeout?.cancel()
    }
    if (!response.ok) {
      throw new Error(`dsh web RPC ${method} 载体错误: HTTP ${response.status}`)
    }
    let parsed
    try {
      parsed = await response.json()
    } catch {
      throw new Error(`dsh web RPC ${method} 响应不是 JSON`)
    }
    const message = parsed
    if (message.type !== 'server-response' || message.rpcId !== rpcId) {
      throw new Error(`dsh web RPC ${method} 响应信封不匹配`)
    }
    if (message.result.ok) return message.result.value
    throw new DshRpcError(message.result.error)
  }

  /**
   * Typert Remote 一元调用：payload 统一为 `{ args: {...} }`。
   */
  callArgs(endpoint, args, signal, timeoutMs = DEFAULT_RPC_TIMEOUT_MS) {
    return this.call(endpoint, { args: args || {} }, signal, timeoutMs)
  }
}

/**
 * Gateway 单 WebSocket mux：`/api/remote.mux` 上多路复用逻辑流。
 * 客户端发 `{type:'open', streamId, endpoint, payload}`，
 * 服务端回 `{type:'item'|'end'|'error', streamId, ...}`。
 */
class RemoteMuxClient extends EventEmitter {
  constructor(options) {
    super()
    this.url = options.url
    this.cookie = options.cookie || ''
    this.reconnectMs = options.reconnectMs ?? 1000
    this.wsImpl = options.wsImpl ?? loadWebSocketImpl()
    this.socket = null
    this.closed = false
    this.stopping = false
    this.reconnectTimer = null
    // streamId -> { endpoint, payload, handlers }
    this.streams = new Map()
    this.writes = Promise.resolve()
  }

  start() {
    if (this.closed || this.socket) return
    this.connect()
  }

  stop() {
    this.closed = true
    this.stopping = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    try { this.socket?.close() } catch { /* ignore */ }
    this.socket = null
  }

  open(endpoint, payload, handlers = {}) {
    const streamId = randomUUID()
    this.streams.set(streamId, { endpoint, payload, handlers })
    if (this.socket && this.socket.readyState === 1) {
      this.sendFrame({ type: 'open', streamId, endpoint, payload })
    }
    return {
      streamId,
      close: () => this.closeStream(streamId),
    }
  }

  closeStream(streamId) {
    this.streams.delete(streamId)
    if (this.socket && this.socket.readyState === 1) {
      this.sendFrame({ type: 'cancel', streamId })
    }
  }

  connect() {
    let socket
    try {
      socket = new this.wsImpl(this.url, {
        headers: this.cookie ? { cookie: this.cookie } : undefined,
      })
    } catch (error) {
      this.emit('error', new Error(`创建 WebSocket 失败: ${error.message}`))
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      for (const [streamId, stream] of this.streams) {
        this.sendFrame({ type: 'open', streamId, endpoint: stream.endpoint, payload: stream.payload })
      }
      this.emit('open')
    }
    socket.onmessage = (event) => {
      let parsed
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        this.emit('error', new Error('Remote mux 帧不是 JSON'))
        return
      }
      this.handleFrame(parsed)
    }
    socket.onclose = () => {
      this.socket = null
      const deliberate = this.closed || this.stopping
      if (!deliberate) this.emit('close')
      this.scheduleReconnect()
    }
    socket.onerror = () => {
      if (!this.stopping) this.emit('error', new Error(`Remote mux 连接错误: ${this.url}`))
    }
  }

  handleFrame(frame) {
    if (!frame || typeof frame !== 'object') return
    const streamId = frame.streamId
    const stream = this.streams.get(streamId)
    if (!stream) return
    if (frame.type === 'item') {
      stream.handlers.onItem?.(frame.value)
    } else if (frame.type === 'end') {
      this.streams.delete(streamId)
      stream.handlers.onEnd?.()
    } else if (frame.type === 'error') {
      this.streams.delete(streamId)
      stream.handlers.onError?.(frame.error)
    }
  }

  sendFrame(frame) {
    const text = JSON.stringify(frame)
    this.writes = this.writes.then(() => {
      if (!this.socket || this.socket.readyState !== 1) {
        throw new Error('Remote mux socket is not open')
      }
      // Node 全局 WebSocket(undici) 的 send 不接受回调；ws 包的回调方式也兼容：
      // 这里只保证顺序，不等待底层完成回调。
      this.socket.send(text)
    }).catch(() => undefined)
    return this.writes
  }

  scheduleReconnect() {
    if (this.closed || this.stopping) return
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectMs)
    this.reconnectTimer.unref?.()
  }
}

function withTimeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, cancel: () => clearTimeout(timer) }
}

module.exports = {
  WireClient,
  RemoteMuxClient,
  DshRpcError,
  withTimeout,
  loadWebSocketImpl,
  exchangeLaunchToken,
  extractTokenFromUrl,
  DEFAULT_RPC_TIMEOUT_MS,
  DEFAULT_AUTH_TIMEOUT_MS,
}
