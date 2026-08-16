'use strict'

const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')

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

class WireClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/u, '')
  }

  async respond(message, signal) {
    let response
    try {
      response = await fetch(`${this.baseUrl}/api/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
        signal,
      })
    } catch (error) {
      throw new Error(`dsh web respond 传输失败: ${error instanceof Error ? error.message : String(error)}`)
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

  async call(method, payload, signal) {
    const rpcId = randomUUID()
    const body = { type: 'client-request', rpcId, method, payload }
    let response
    try {
      response = await fetch(`${this.baseUrl}/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      throw new Error(`dsh web RPC ${method} 传输失败: ${error instanceof Error ? error.message : String(error)}`)
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
}

class EventStream extends EventEmitter {
  constructor(options) {
    super()
    this.url = options.url
    this.reconnectMs = options.reconnectMs ?? 1000
    this.wsImpl = options.wsImpl ?? loadWebSocketImpl()
    this.socket = null
    this.closed = false
    this.reconnectTimer = null
    this.stopping = false
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

  connect() {
    let socket
    try {
      socket = new this.wsImpl(this.url)
    } catch (error) {
      this.emit('error', new Error(`创建 WebSocket 失败: ${error.message}`))
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.emit('open')
    }
    socket.onmessage = (event) => {
      let parsed
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        this.emit('error', new Error('事件帧不是 JSON'))
        return
      }
      if (parsed.type !== 'server-request') {
        this.emit('error', new Error(`事件帧 type 异常: ${String(parsed.type)}`))
        return
      }
      this.emit('frame', parsed)
    }
    socket.onclose = () => {
      this.socket = null
      const deliberate = this.closed || this.stopping
      if (!deliberate) this.emit('close')
      this.scheduleReconnect()
    }
    socket.onerror = () => {
      if (!this.stopping) this.emit('error', new Error(`事件流连接错误: ${this.url}`))
    }
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
  timer.unref?.()
  return { signal: controller.signal, cancel: () => clearTimeout(timer) }
}

module.exports = { WireClient, EventStream, DshRpcError, withTimeout, loadWebSocketImpl }
