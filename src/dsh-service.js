'use strict'

const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const { homedir } = require('node:os')
const { join, dirname } = require('node:path')
const { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } = require('node:fs')
const { discoverDsh, probeVersion } = require('./discovery.js')
const { isAtLeast } = require('./version.js')
const { startDshWeb } = require('./server.js')
const {
  WireClient,
  RemoteMuxClient,
  exchangeLaunchToken,
  extractTokenFromUrl,
} = require('./wire.js')

const STATE_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'vscode-extension.json')
const DEFAULT_DSH_URL = 'http://127.0.0.1:3080'

class DshService extends EventEmitter {
  constructor(options) {
    super()
    this.options = options
    this.launcher = null
    // 探测到的 dsh CLI 版本（不再用于拦截启动，只用于"版本过低"提醒）。
    this.version = null
    this.versionWarned = false
    this.server = null
    this.wire = null
    this.mux = null
    this.cookie = ''
    this.status = 'stopped'
    this.started = false
    this.stopping = false
    this.ownsInstance = false
    this.baseUrlValue = null
    this.token = null
  }

  get statusValue() { return this.status }
  get client() { return this.wire }
  get baseUrl() { return this.baseUrlValue }
  get launcherValue() { return this.launcher }

  /**
   * 供浏览器直接打开的地址（含当前进程的 launch token，无 token 时退回纯 baseUrl）。
   * dsh rc.1 起裸 baseUrl 会返回 401；带 token 的 URL 一次 GET 即换 cookie 并进入 UI。
   */
  get webUrl() {
    if (!this.baseUrlValue) return null
    const url = new URL(this.baseUrlValue)
    if (this.token) url.searchParams.set('token', this.token)
    return url.href
  }

  /**
   * 打开 Web UI 前调用：确保当前 launch token 仍对该 dsh 进程有效。
   * launch token 每进程唯一——外部手动实例被重启后 token 会更换，而插件
   * 持有的 cookie 因签名密钥持久化仍可通信，此时点击打开前必须重新验证；
   * 失效则走 onAuthRequired 询问用户粘贴新 token URL，成功后刷新 token/cookie。
   * @returns 可以打开（或已刷新）时 true；无可用认证时 false。
   */
  async ensureAuthToken() {
    const base = this.baseUrlValue
    if (!base) return false
    if (!this.token) {
      // 无 token 的实例（老版本 dsh 无认证）：验证链接可用即可。
      return this.probeAuthed(base, this.cookie)
    }
    try {
      await exchangeLaunchToken(base, this.token)
      return true
    } catch {
      // 当前 token 已失效（dsh 进程被外部重启等）：走询问流程。
    }
    if (this.options.onAuthRequired) {
      const supplied = await this.options.onAuthRequired(base)
      if (supplied) {
        try {
          const { baseUrl, token } = extractTokenFromUrl(supplied)
          if (baseUrl !== this.baseUrlValue) {
            this.options.onLog?.(`忽略与当前实例不符的地址: ${baseUrl}`)
            return false
          }
          const cookie = await exchangeLaunchToken(baseUrl, token)
          if (await this.probeAuthed(baseUrl, cookie)) {
            this.token = token
            this.cookie = cookie
            this.writeStateFile(baseUrl, process.pid, token)
            return true
          }
        } catch {
          // 用户提供的 URL/token 无效：返回 false，由调用方提示。
        }
      }
    }
    return false
  }

  setStatus(status, detail) {
    this.status = status
    this.options.onStatus?.(status, detail)
    this.emit('status', status, detail)
  }

  async start({ allowSpawn = true } = {}) {
    if (this.started) return
    this.started = true
    this.stopping = false
    try {
      this.setStatus('discovering')

      // 要求 2：优先复用已在后台运行的 dsh web 实例（显式 URL(可选 token) → 默认端口 → 状态文件记录的插件实例）。
      const existing = await this.findExistingInstance()
      if (existing) {
        this.baseUrlValue = existing.baseUrl
        this.cookie = existing.cookie || ''
        this.token = existing.token || null
        this.launcher = { command: existing.baseUrl, args: [], source: 'existing', version: null }
        this.ownsInstance = false
        this.options.onLog?.(`复用已运行的 dsh web: ${existing.baseUrl}`)
        this.connect()
        this.setStatus('ready')
        return
      }

      // 自动启动被关闭（autoStart=false）：只复用不生成；未发现实例则保持 stopped。
      if (!allowSpawn) {
        this.started = false
        this.setStatus('stopped')
        return
      }

      // 未运行：生成一个新的 dsh 实例（dsh web --port 0 --no-open，随机 loopback 端口，不打开浏览器）。
      // 不再用版本探测拦截启动（用户要求）：定位到可执行文件就直接启动，
      // 版本核对改为启动后在后台进行（verifyVersion），不满足要求时只提醒不阻塞。
      this.launcher = await discoverDsh({ explicitPath: this.options.explicitPath })
      this.options.onLog?.(`dsh package: ${this.launcher.version} @ ${this.launcher.command} (${this.launcher.source})`)

      this.setStatus('starting')
      this.server = await startDshWeb({
        launcher: this.launcher,
        onStderr: (line) => this.options.onLog?.(`[dsh] ${line}`),
      })
      this.baseUrlValue = this.server.baseUrl
      this.token = this.server.token || null
      // rc.1 起每个 dsh 进程都有独立 launch token；插件用它在首次启动时换取认证 cookie。
      this.cookie = this.server.token
        ? await exchangeLaunchToken(this.server.baseUrl, this.server.token)
        : ''
      this.ownsInstance = true
      this.options.onLog?.(`dsh web service ready: ${this.server.baseUrl}`)
      this.writeStateFile(this.server.baseUrl, this.server.child?.pid, this.server.token)

      const server = this.server
      server.exited.then((code) => {
        if (this.stopping || this.server !== server) return
        this.options.onLog?.(`dsh web 意外退出 (code=${String(code)})`)
        this.mux?.stop()
        this.mux = null
        this.wire = null
        this.server = null
        this.baseUrlValue = null
        this.cookie = ''
        this.token = null
        this.started = false
        this.setStatus('error', `dsh web 已退出 (code=${String(code)})`)
      })

      this.connect()
      this.setStatus('ready')
      // 后台核对版本：不阻塞连接，也不阻止使用；低于要求时提醒升级。
      void this.verifyVersion()
    } catch (error) {
      this.started = false
      this.setStatus('error', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  /**
   * 核对 dsh 版本（启动后调用，可重复调用但只提醒一次）。
   *
   * 自动启动时不再做启动前的版本拦截；这里用 `dsh --version` 探测当前实例对应的 CLI 版本，
   * 低于 `minimumVersion` 时通过 `onVersionOutdated` 回调让上层弹提醒（要求升级 dsh）。
   * @returns 探到的版本；探测不到时返回 null（只记日志，不打扰用户）。
   */
  async verifyVersion() {
    const minimum = this.options.minimumVersion
    if (!minimum) return null
    let current = this.version
    if (!current) {
      const command = this.launcher?.command ?? 'dsh'
      const args = this.launcher?.args ?? []
      try {
        current = await probeVersion(command, args)
      } catch {
        current = null
      }
      this.version = current
    }
    if (!current) {
      this.options.onLog?.('无法探测 dsh 版本（跳过版本提醒）')
      return null
    }
    if (isAtLeast(current, minimum)) {
      this.options.onLog?.(`dsh 版本 ${current} 满足要求（>= ${minimum}）`)
      return current
    }
    this.options.onLog?.(`dsh 版本过低: ${current} < ${minimum}`)
    if (!this.versionWarned) {
      this.versionWarned = true
      this.options.onVersionOutdated?.({ current, minimum })
    }
    return current
  }

  connect() {
    const base = this.baseUrlValue
    if (!base) throw new Error('dsh base URL 为空')
    this.wire = new WireClient(base, this.cookie)

    const wsBase = base.replace(/^http:/u, 'ws:')
    this.mux = new RemoteMuxClient({ url: `${wsBase}/api/remote.mux`, cookie: this.cookie })

    this.mux.on('error', (error) => this.options.onLog?.(`[remote.mux] ${error.message}`))

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
  }

  /** 在 remote.mux 上打开一个逻辑流（$events / session.follow / session.control / workspace.follow）。 */
  openStream(endpoint, payload, handlers) {
    if (!this.mux) throw new Error('dsh web 尚未就绪')
    return this.mux.open(endpoint, payload, handlers)
  }

  async findExistingInstance() {
    const explicitUrl = this.options.explicitUrl?.trim()
    if (explicitUrl) {
      const { baseUrl, token } = extractTokenFromUrl(explicitUrl)
      if (token) {
        const cookie = await exchangeLaunchToken(baseUrl, token)
        if (await this.probeAuthed(baseUrl, cookie)) return { baseUrl, token, cookie }
        throw new Error(`配置的 dsh web 地址不可用: ${explicitUrl}`)
      }
      if (await this.probeAuthed(baseUrl, '')) return { baseUrl, token: null, cookie: '' }
      throw new Error(`配置的 dsh web 地址不可用: ${explicitUrl}`)
    }

    // 用户手动在默认端口启动的实例优先：rc.1 无 token 会返回 401，
    // 此时不直接另起新实例，而是先询问用户粘贴带 token 的完整启动 URL。
    const defaultStatus = await this.probeStatus(DEFAULT_DSH_URL, '')
    if (defaultStatus === 'ok') return { baseUrl: DEFAULT_DSH_URL, token: null, cookie: '' }
    if (defaultStatus === 'auth') {
      // 若之前用户粘贴过该端口的 token，先复用状态文件，避免每次启动都询问。
      const remembered = this.stateTokenFor(DEFAULT_DSH_URL)
      if (remembered) {
        try {
          const cookie = await exchangeLaunchToken(DEFAULT_DSH_URL, remembered)
          if (await this.probeAuthed(DEFAULT_DSH_URL, cookie)) {
            return { baseUrl: DEFAULT_DSH_URL, token: remembered, cookie }
          }
        } catch {
          // 记忆的 token 已失效：继续询问用户。
        }
      }
      const supplied = await this.promptForToken(DEFAULT_DSH_URL)
      if (supplied) return supplied
    }

    // 状态文件只在默认端口不可用时作为“上次插件实例仍存活”的兜底。
    try {
      if (existsSync(STATE_FILE)) {
        const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
        if (state && typeof state.baseUrl === 'string' && typeof state.token === 'string') {
          try {
            const cookie = await exchangeLaunchToken(state.baseUrl, state.token)
            if (await this.probeAuthed(state.baseUrl, cookie)) {
              return { baseUrl: state.baseUrl, token: state.token, cookie }
            }
          } catch {
            // 记忆的 token 已失效（用户手动重启过 dsh 等）：若该地址仍要求认证，询问新 token。
            if (await this.probeStatus(state.baseUrl, '') === 'auth') {
              const supplied = await this.promptForToken(state.baseUrl)
              if (supplied) return supplied
            }
          }
        }
      }
    } catch {
      // 状态文件损坏/不可读：忽略。
    }
    return null
  }

  /**
   * 询问用户粘贴 dsh 启动时输出的完整地址（含 `?token=...`）并验证。
   * dsh rc.1 起裸地址返回 401，没有 token 就进不了 UI/RPC。
   * @param baseUrl - 期望的实例地址；与用户粘贴的地址不一致时拒绝（避免接到别的实例）。
   * @returns `{baseUrl, token, cookie}`；用户取消或地址无效时返回 null。
   */
  async promptForToken(baseUrl) {
    if (!this.options.onAuthRequired) return null
    const supplied = await this.options.onAuthRequired(baseUrl)
    if (!supplied) return null
    try {
      const parsed = extractTokenFromUrl(supplied)
      if (parsed.baseUrl !== baseUrl) {
        this.options.onLog?.(`忽略与当前实例不符的地址: ${parsed.baseUrl}`)
        return null
      }
      const cookie = await exchangeLaunchToken(parsed.baseUrl, parsed.token)
      if (!await this.probeAuthed(parsed.baseUrl, cookie)) return null
      // 记住用户提供的外部实例 token：同进程存活期间不再重复询问。
      this.writeStateFile(parsed.baseUrl, process.pid, parsed.token)
      return { baseUrl: parsed.baseUrl, token: parsed.token, cookie }
    } catch (error) {
      this.options.onLog?.(`用户提供的 dsh 地址/Token 无效: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /**
   * 手动接入一个已在运行的 dsh 实例（用户在 `⋯` 菜单/设置离线横幅里粘贴带 token 的地址）。
   * 校验通过后记住 token、建立 mux 连接并把状态置为 ready。
   * @param suppliedUrl - 形如 `http://127.0.0.1:3080/?token=...` 的完整地址。
   * @returns 接入的 baseUrl。
   * @throws 地址缺 token / token 无效 / 该地址未在运行 dsh 时抛错。
   */
  async adoptAuthUrl(suppliedUrl) {
    const raw = String(suppliedUrl || '').trim()
    if (!raw) throw new Error('地址为空')
    const { baseUrl, token } = extractTokenFromUrl(raw)
    // 有 token：交换 cookie；没有 token（免认证/老版本 dsh）：直接用空 cookie 探测，
    // 但要求该实例确实在运行且能通过一次 RPC，否则视为"地址不可用"。
    const cookie = token ? await exchangeLaunchToken(baseUrl, token) : ''
    if (!await this.probeAuthed(baseUrl, cookie)) {
      throw new Error(token ? `该地址无法通过认证: ${baseUrl}` : `该地址没有运行可用的 dsh 服务: ${baseUrl}`)
    }
    this.baseUrlValue = baseUrl
    this.token = token
    this.cookie = cookie
    this.started = true
    this.stopping = false
    this.ownsInstance = false
    this.launcher = { command: baseUrl, args: [], source: 'existing', version: null }
    this.writeStateFile(baseUrl, process.pid, token)
    this.connect()
    this.setStatus('ready')
    this.options.onLog?.(`已手动接入 dsh web: ${baseUrl}`)
    return baseUrl
  }

  /** 读取状态文件里指定 URL 的 token（不存在返回 null）。 */
  stateTokenFor(baseUrl) {
    try {
      if (existsSync(STATE_FILE)) {
        const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
        if (state && state.baseUrl === baseUrl && typeof state.token === 'string') return state.token
      }
    } catch {
      // ignore
    }
    return null
  }

  /** 返回 'ok'（可认证通过）/ 'auth'（需要 token）/ 'down'（不可达）。 */
  async probeStatus(baseUrl, cookie) {
    const rpcId = randomUUID()
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/u, '')}/api/settings/describe`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({ type: 'client-request', rpcId, method: 'settings/describe', payload: { args: {} } }),
      })
      if (response.ok) return 'ok'
      if (response.status === 401 || response.status === 403) return 'auth'
      return 'down'
    } catch {
      return 'down'
    }
  }

  async probeAuthed(baseUrl, cookie) {
    try {
      const wire = new WireClient(baseUrl, cookie)
      await wire.callArgs('settings/describe', {})
      return true
    } catch {
      return false
    }
  }

  writeStateFile(baseUrl, childPid, token) {
    try {
      mkdirSync(dirname(STATE_FILE), { recursive: true })
      writeFileSync(STATE_FILE, JSON.stringify({
        baseUrl,
        ...(token ? { token } : {}),
        pid: childPid ?? process.pid,
        at: new Date().toISOString(),
      }, null, 2), { mode: 0o600 })
      // 文件里存着 launch token：确保已有文件也被收紧到仅属主可读写。
      chmodSync(STATE_FILE, 0o600)
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
    this.mux = null
    this.wire = null
    this.cookie = ''
    this.token = null

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
