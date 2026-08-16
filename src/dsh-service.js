'use strict'

const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const { homedir } = require('node:os')
const { join, dirname } = require('node:path')
const { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } = require('node:fs')
const { discoverDsh } = require('./discovery.js')
const { startDshWeb } = require('./server.js')
const { WireClient, EventStream, withTimeout } = require('./wire.js')

const STATE_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'vscode-extension.json')
const DEFAULT_DSH_URL = 'http://127.0.0.1:3080'

class DshService extends EventEmitter {
  constructor(options) {
    super()
    this.options = options
    this.launcher = null
    this.server = null
    this.wire = null
    this.mux = null
    this.host = null
    this.status = 'stopped'
    this.started = false
    this.stopping = false
    this.ownsInstance = false
    this.baseUrlValue = null
  }

  get statusValue() { return this.status }
  get client() { return this.wire }
  get baseUrl() { return this.baseUrlValue }
  get launcherValue() { return this.launcher }

  setStatus(status, detail) {
    this.status = status
    this.options.onStatus?.(status, detail)
    this.emit('status', status, detail)
  }

  async start() {
    if (this.started) return
    this.started = true
    this.stopping = false
    try {
      this.setStatus('discovering')

      // 要求 2：优先复用已在后台运行的 dsh web 实例（显式 URL → 状态文件 → dsh 默认端口）。
      const existing = await this.findExistingInstance()
      if (existing) {
        this.baseUrlValue = existing
        this.launcher = { command: existing, args: [], source: 'existing', version: null }
        this.ownsInstance = false
        this.options.onLog?.(`复用已运行的 dsh web: ${existing}`)
        this.connect()
        this.setStatus('ready')
        return
      }

      // 未运行：生成一个新的 dsh 实例（dsh web --port 0，随机 loopback 端口）。
      this.launcher = await discoverDsh({
        minimumVersion: this.options.minimumVersion,
        explicitPath: this.options.explicitPath,
      })
      this.options.onLog?.(`dsh package: ${this.launcher.version} @ ${this.launcher.command} (${this.launcher.source})`)

      this.setStatus('starting')
      this.server = await startDshWeb({
        launcher: this.launcher,
        onStderr: (line) => this.options.onLog?.(`[dsh] ${line}`),
      })
      this.baseUrlValue = this.server.baseUrl
      this.ownsInstance = true
      this.options.onLog?.(`dsh web service ready: ${this.server.baseUrl}`)
      this.writeStateFile(this.server.baseUrl)

      const server = this.server
      server.exited.then((code) => {
        if (this.stopping || this.server !== server) return
        this.options.onLog?.(`dsh web 意外退出 (code=${String(code)})`)
        this.mux?.stop()
        this.host?.stop()
        this.mux = null
        this.host = null
        this.wire = null
        this.server = null
        this.baseUrlValue = null
        this.started = false
        this.setStatus('error', `dsh web 已退出 (code=${String(code)})`)
      })

      this.connect()
      this.setStatus('ready')
    } catch (error) {
      this.started = false
      this.setStatus('error', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  connect() {
    const base = this.baseUrlValue
    if (!base) throw new Error('dsh base URL 为空')
    this.wire = new WireClient(base)

    const wsBase = base.replace(/^http:/u, 'ws:')
    this.mux = new EventStream({ url: `${wsBase}/api/events.mux` })
    this.host = new EventStream({ url: `${wsBase}/api/events.host` })

    this.mux.on('frame', (frame) => this.emit('mux', frame))
    this.host.on('frame', (frame) => this.emit('host', frame))
    this.mux.on('error', (error) => this.options.onLog?.(`[events.mux] ${error.message}`))
    this.host.on('error', (error) => this.options.onLog?.(`[events.host] ${error.message}`))

    // 事件流断开（非主动 stop）：通知上层重同步历史；状态短暂置为 reconnecting。
    this.mux.on('close', () => {
      if (!this.stopping) this.emit('muxClose')
    })
    this.mux.on('close', () => {
      if (!this.stopping && this.status === 'ready') this.setStatus('reconnecting')
    })
    this.mux.on('open', () => {
      if (this.status === 'reconnecting') this.setStatus('ready')
    })

    this.mux.start()
    this.host.start()
  }

  async findExistingInstance() {
    const explicitUrl = this.options.explicitUrl?.trim()
    if (explicitUrl) {
      const ok = await this.probeDsh(explicitUrl)
      if (!ok) throw new Error(`配置的 dsh web 地址不可用: ${explicitUrl}`)
      return explicitUrl.replace(/\/+$/u, '')
    }

    const candidates = []
    try {
      if (existsSync(STATE_FILE)) {
        const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
        if (state && typeof state.baseUrl === 'string') candidates.push(state.baseUrl)
      }
    } catch {
      // 状态文件损坏/不可读：忽略，继续探测默认端口。
    }
    candidates.push(DEFAULT_DSH_URL)

    for (const url of candidates) {
      if (await this.probeDsh(url)) {
        return url.replace(/\/+$/u, '')
      }
    }
    return null
  }

  async probeDsh(baseUrl) {
    const rpcId = randomUUID()
    const { signal, cancel } = withTimeout(1800)
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/u, '')}/api/workspace.list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: 'workspace.list', payload: {} }),
        signal,
      })
      if (!response.ok) return false
      const message = await response.json()
      return message
        && message.type === 'server-response'
        && message.rpcId === rpcId
        && message.result
        && message.result.ok === true
    } catch {
      return false
    } finally {
      cancel()
    }
  }

  writeStateFile(baseUrl) {
    try {
      mkdirSync(dirname(STATE_FILE), { recursive: true })
      writeFileSync(STATE_FILE, JSON.stringify({ baseUrl, pid: process.pid, at: new Date().toISOString() }, null, 2))
    } catch {
      // 状态文件仅是复用提示；写失败不影响主流程。
    }
  }

  clearStateFile(baseUrl) {
    try {
      if (!existsSync(STATE_FILE)) return
      const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
      if (state && state.baseUrl === baseUrl) unlinkSync(STATE_FILE)
    } catch {
      // ignore
    }
  }

  async stop() {
    if (this.stopping && this.status === 'stopped') return
    this.stopping = true
    this.mux?.stop()
    this.host?.stop()
    this.mux = null
    this.host = null
    this.wire = null

    const server = this.server
    const baseUrl = this.baseUrlValue
    this.server = null
    this.baseUrlValue = null
    this.started = false

    if (this.ownsInstance && server) {
      const code = await server.stop()
      this.options.onLog?.(`dsh web 已退出 (code=${String(code)})`)
      this.clearStateFile(baseUrl)
    } else if (this.ownsInstance) {
      this.clearStateFile(baseUrl)
    } else {
      this.options.onLog?.('已断开与既有 dsh web 的连接（实例保持运行）')
    }
    this.ownsInstance = false
    this.setStatus('stopped')
  }
}

module.exports = { DshService, STATE_FILE, DEFAULT_DSH_URL }
