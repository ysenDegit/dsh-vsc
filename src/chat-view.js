'use strict'

const vscode = require('vscode')
const { randomUUID } = require('node:crypto')
const { relative, join } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { getWebviewHtml } = require('./webview.js')
const { version: extensionVersion } = require('../package.json')
const { DshRpcError } = require('./wire.js')
const { isCommandLine } = require('./commands.js')

const viewType = 'dsh-vsc.chat'

function toPosix(p) { return p.split('\\').join('/') }

function sanitizeFileName(value) {
  return String(value || 'session')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'session'
}

class ChatViewProvider {
  constructor(dsh, sessions, options = {}) {
    this.dsh = dsh
    this.sessions = sessions
    this.onLog = options.onLog ?? (() => {})
    this.sessionDisplay = options.sessionDisplay ?? 'concise'
    this.fontSize = options.fontSize ?? 13
    this.maxWidth = options.maxWidth ?? 1000
    this.language = options.language ?? 'zh'
    this.enterToSend = options.enterToSend ?? false
    this.showContextUsage = options.showContextUsage ?? true
    this.contextBarColor = options.contextBarColor ?? 'var(--accent)'
    this.contextBarOpacity = options.contextBarOpacity ?? 30
    this.autoStart = options.autoStart ?? true
    this.autoOpenChat = options.autoOpenChat ?? true
    this.webviews = new Set()
    this.queue = []
    this.selectedSessionId = null
    this.sessionRunning = new Map()
    // sessionId -> queued inbox items (session/queue 权威快照，仅 placement==='queued')
    this.queuesBySession = new Map()
    // sessionId -> pending questions (question/requested 帧)
    this.pendingQuestionsBySession = new Map()
    // sessionId -> pending approvals (approval/requested 帧)
    this.pendingApprovalsBySession = new Map()
    // sessionId -> 是否还有更早历史可加载
    this.hasMoreBySession = new Map()
    // sessionId -> { seen:Set<number>, events:Array<{seq,time,type,data}> }
    this.eventsBySession = new Map()
    // sessionId -> Map<projectionKey, { seq:number, value:unknown }>
    this.projectionsBySession = new Map()
    // 会话流式渲染节流：合并短时间内的多个 chunk，避免每个 token 都全量折叠+推送。
    this.conversationFlushTimer = null
    this.workspaceView = null
    this.workspacePromptedPath = null
    this.workspacePromptAccepted = false
    this.showArchivedSessions = options.showArchivedSessions ?? false
  }

  static get viewType() { return viewType }

  post(message) {
    if (this.webviews.size === 0) {
      this.queue.push(message)
      return
    }
    for (const webviewHost of this.webviews) {
      void webviewHost.webview.postMessage(message)
    }
  }

  resolveWebviewView(webviewView) {
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = getWebviewHtml(randomUUID())
    this.webviews.add(webviewView)
    webviewView.onDidDispose(() => { this.webviews.delete(webviewView) })
    webviewView.webview.onDidReceiveMessage((msg) => { void this.handleMessage(msg) })
    this.flushQueue()
    this.onUiOpened()
  }

  attachPanel(panel) {
    panel.webview.options = { enableScripts: true }
    panel.webview.html = getWebviewHtml(randomUUID())
    this.webviews.add(panel)
    panel.onDidDispose(() => { this.webviews.delete(panel) })
    panel.webview.onDidReceiveMessage((msg) => { void this.handleMessage(msg) })
    this.flushQueue()
    this.onUiOpened()
  }

  refreshPanel(panel) {
    // 工作区面板可能是在旧版本代码下创建的；打开时强制刷成当前 HTML，
    // 避免“侧边栏是新界面、工作区面板仍是旧界面”的不一致。
    panel.webview.options = { enableScripts: true }
    panel.webview.html = getWebviewHtml(randomUUID())
    this.flushQueue()
  }

  flushQueue() {
    const queued = this.queue
    this.queue = []
    for (const message of queued) this.post(message)
  }

  async handleMessage(msg) {
    try {
      switch (msg.type) {
        case 'ready':
          await this.hydrate()
          if (this.dsh.statusValue === 'ready') {
            void this.refreshPresets()
            if (this.selectedSessionId) {
              void this.refreshModels(this.selectedSessionId)
              void this.refreshCommands(this.selectedSessionId)
            }
          }
          break
        case 'newSession':
          await this.newSession()
          break
        case 'addWorkspace':
          await this.addWorkspace()
          break
        case 'selectAgentPreset':
          await this.selectAgentPreset(msg.sessionId || this.selectedSessionId, msg.agentPreset)
          break
        case 'selectSession':
          await this.selectSession(msg.sessionId)
          break
        case 'loadEarlier':
          await this.loadEarlier(msg.sessionId || this.selectedSessionId)
          break
        case 'send':
          await this.send(msg.text)
          break
        case 'cancel':
          await this.cancel()
          break
        case 'refreshSessions':
          await this.refreshSessions()
          break
        case 'refreshPresets':
          await this.refreshPresets()
          break
        case 'modelsOpen':
          await this.refreshModels(msg.sessionId || this.selectedSessionId)
          break
        case 'commandsOpen':
          await this.refreshCommands(msg.sessionId || this.selectedSessionId)
          break
        case 'commandExecute':
          await this.executeCommand(msg.sessionId || this.selectedSessionId, msg.line)
          break
        case 'settingsOpen':
          await this.refreshSettings()
          break
        case 'settingsOpenDocument':
          await this.openSettingsDocument()
          break
        case 'openDshWeb':
          await this.openDshWeb()
          break
        case 'workspaceRename':
          await this.renameWorkspace(msg.workspaceId, msg.title)
          break
        case 'workspaceDelete':
          await this.deleteWorkspace(msg.workspaceId)
          break
        case 'workspaceRefresh':
          await this.refreshSettings()
          break
        case 'setShowArchivedSessions':
          await this.setShowArchivedSessions(msg.value)
          break
        case 'setSessionDisplay':
          await this.setSessionDisplay(msg.value)
          break
        case 'setFontSize':
          await this.setFontSize(msg.value)
          break
        case 'setLanguage':
          await this.setLanguage(msg.value)
          break
        case 'setEnterToSend':
          await this.setEnterToSend(msg.value)
          break
        case 'setMaxWidth':
          await this.setMaxWidth(msg.value)
          break
        case 'setShowContextUsage':
          await this.setShowContextUsage(msg.value)
          break
        case 'setContextBarColor':
          await this.setContextBarColor(msg.value)
          break
        case 'setContextBarOpacity':
          await this.setContextBarOpacity(msg.value)
          break
        case 'setAutoStart':
          await this.setAutoStart(msg.value)
          break
        case 'setAutoOpenChat':
          await this.setAutoOpenChat(msg.value)
          break
        case 'retryConnect':
          await this.retryConnect()
          break
        case 'modelSelect':
          await this.selectModel(msg.provider, msg.model, msg.effort)
          break
        case 'closeSession':
          await this.closeSession(msg.sessionId)
          break
        case 'renameSession':
          await this.renameSession(msg.sessionId)
          break
        case 'pickFiles':
          await this.pickFiles()
          break
        case 'queueRemove':
          await this.removeQueuedItem(msg.sessionId, msg.itemId)
          break
        case 'questionAnswer':
          await this.answerQuestion(msg.sessionId, msg.rpcId, msg.answers)
          break
        case 'questionCancel':
          await this.cancelQuestion(msg.sessionId, msg.rpcId)
          break
        case 'approvalAnswer':
          await this.answerApproval(msg.sessionId, msg.rpcId, msg.approvalId, msg.outcome)
          break
        case 'queueEdit':
          await this.editQueuedItem(msg.sessionId, msg.itemId)
          break
        case 'queueSteer':
          await this.steerQueuedItem(msg.sessionId, msg.itemId)
          break
        case 'downloadSession':
          await this.downloadSession(msg.sessionId || this.selectedSessionId)
          break
        case 'permissionSelect':
          await this.selectPermission(msg.sessionId || this.selectedSessionId, msg.preset)
          break
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.onLog(message)
      void vscode.window.showErrorMessage(message)
    }
  }

  async hydrate() {
    const list = this.dsh.statusValue === 'ready' ? await this.sessions.listSessions(this.selectedSessionId, this.showArchivedSessions) : []
    this.post({
      type: 'hydrate',
      status: this.dsh.statusValue,
      workspace: this.workspaceView,
      sessions: list,
      selectedSessionId: this.selectedSessionId,
      conversation: this.conversationSnapshot(),
      running: this.isSessionRunning(this.selectedSessionId),
      sessionDisplay: this.sessionDisplay,
      fontSize: this.fontSize,
      maxWidth: this.maxWidth,
      language: this.language,
      enterToSend: this.enterToSend,
      showContextUsage: this.showContextUsage,
      contextBarColor: this.contextBarColor,
      contextBarOpacity: this.contextBarOpacity,
      autoStart: this.autoStart,
      autoOpenChat: this.autoOpenChat,
      showArchivedSessions: this.showArchivedSessions,
      queue: this.queueSnapshot(this.selectedSessionId),
      hasMoreEarlier: this.hasMoreBySession.get(this.selectedSessionId) ?? false,
      question: this.questionSnapshot(this.selectedSessionId),
      approval: this.approvalSnapshot(this.selectedSessionId),
      todos: this.projectionValue(this.selectedSessionId, 'todos'),
      permissions: this.projectionValue(this.selectedSessionId, 'permissions'),
    })
  }

  async ensureWorkspace() {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) {
      this.workspaceView = null
      this.post({ type: 'workspace', workspace: null })
      return null
    }
    if (!this.dsh.client) return null

    const existing = await this.sessions.findWorkspace(folder.uri.fsPath)
    if (existing) {
      this.workspaceView = existing
      this.workspacePromptedPath = folder.uri.fsPath
      this.workspacePromptAccepted = true
      this.post({ type: 'workspace', workspace: this.workspaceView })
      return this.workspaceView
    }

    // 工作区尚不存在：仅当用户已经打开插件界面时才弹确认框；
    // 启动阶段（后台静默初始化，webview 未打开）不打扰用户，
    // 等用户打开侧边栏/面板后由 ensureWorkspaceAndSession() 再次触发询问。
    if (this.webviews.size === 0) {
      this.workspaceView = null
      this.post({ type: 'workspace', workspace: null })
      return null
    }

    // 工作区尚不存在：弹确认框，而不是完全自动添加。
    if (this.workspacePromptedPath !== folder.uri.fsPath) {
      const answer = await vscode.window.showWarningMessage(
        `是否将当前工作目录添加到 dsh 工作区？\n${folder.uri.fsPath}`,
        { modal: true },
        '添加',
        '取消',
      )
      this.workspacePromptedPath = folder.uri.fsPath
      this.workspacePromptAccepted = answer === '添加'
    }

    if (!this.workspacePromptAccepted) {
      this.workspaceView = null
      this.post({ type: 'workspace', workspace: null })
      this.post({ type: 'notice', text: '已取消添加工作区' })
      return null
    }

    this.workspaceView = await this.sessions.createWorkspace(folder.uri.fsPath)
    this.post({ type: 'workspace', workspace: this.workspaceView })
    return this.workspaceView
  }

  // 用户打开插件界面（侧边栏/工作区面板）时：若 dsh 已就绪但工作区尚未建立
  // （启动阶段被静默跳过确认框），在此补做初始化，确认框此时才会弹出。
  onUiOpened() {
    if (this.dsh.statusValue !== 'ready') return
    if (this.workspaceView || this.workspacePromptedPath) return
    void this.ensureWorkspaceAndSession()
  }

  async ensureWorkspaceAndSession() {
    try {
      this.sessions.reset()
      await this.ensureWorkspace()
      await this.refreshPresets()
      await this.refreshSessions()
      await this.autoAttachSession()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.onLog(message)
      this.post({ type: 'notice', text: message })
    }
  }

  // 空状态按钮"将当前文件夹添加到 dsh 工作区"：清除粘滞标记后重新询问并初始化。
  async addWorkspace() {
    this.workspacePromptedPath = null
    this.workspacePromptAccepted = false
    await this.ensureWorkspaceAndSession()
  }

  async autoAttachSession() {
    if (this.selectedSessionId) return
    const workspace = await this.ensureWorkspace()
    if (!workspace) return
    this.clearConversationPost()
    // 启动时优先打开最近的非空白会话；只有完全没有现存会话时才创建空白新会话。
    const existingSessions = await this.sessions.listSessions(null)
    const existing = existingSessions[0]
    if (existing) {
      this.selectedSessionId = existing.sessionId
      await this.refreshSessions()
      await this.loadHistory(existing.sessionId)
      await this.refreshModels(existing.sessionId)
      await this.refreshCommands(existing.sessionId)
      this.postQueue(existing.sessionId)
      this.postQuestion(existing.sessionId)
      this.postApproval(existing.sessionId)
      return
    }
    const { sessionId } = await this.sessions.resolveNewSession()
    this.selectedSessionId = sessionId
    await this.refreshSessions()
    await this.loadHistory(sessionId)
    await this.refreshModels(sessionId)
    await this.refreshCommands(sessionId)
    this.postQueue(sessionId)
    this.postQuestion(sessionId)
    this.postApproval(sessionId)
  }

  async newSession() {
    if (!this.dsh.client) throw new Error('dsh web 尚未就绪')
    const workspace = await this.ensureWorkspace()
    if (!workspace) throw new Error('没有打开的工作区，无法创建会话')
    const { sessionId } = await this.sessions.resolveNewSession()
    this.clearConversationPost()
    this.selectedSessionId = sessionId
    await this.refreshSessions()
    await this.loadHistory(sessionId)
    await this.refreshModels(sessionId)
    await this.refreshCommands(sessionId)
    this.postQueue(sessionId)
    this.postQuestion(sessionId)
    this.postApproval(sessionId)
  }

  async selectAgentPreset(sessionId, agentPreset) {
    if (!sessionId || !agentPreset) return
    await this.sessions.selectAgentPreset(sessionId, agentPreset)
    await this.refreshSessions()
  }

  async selectSession(sessionId) {
    if (!sessionId) return
    this.clearConversationPost()
    this.selectedSessionId = sessionId
    await this.refreshSessions()
    await this.loadHistory(sessionId)
    await this.refreshModels(sessionId)
    await this.refreshCommands(sessionId)
    this.postQueue(sessionId)
    this.postQuestion(sessionId)
    this.postApproval(sessionId)
  }

  async send(text) {
    if (!this.dsh.client) throw new Error('dsh web 尚未就绪')
    let sessionId = this.selectedSessionId
    if (!sessionId) {
      const workspace = await this.ensureWorkspace()
      if (!workspace) throw new Error('没有打开的工作区，无法发送消息')
      const created = await this.sessions.resolveNewSession()
      sessionId = created.sessionId
      this.selectedSessionId = sessionId
      await this.refreshSessions()
      await this.loadHistory(sessionId)
      await this.refreshModels(sessionId)
    }
    const line = String(text ?? '')
    // 与 web 端一致：完整斜杠命令行优先走命令执行，绝不发给模型；
    // 未注册命令才按普通消息发送。
    if (isCommandLine(line) && await this.tryDispatchCommand(sessionId, line)) return
    await this.sessions.prompt(sessionId, line, 'queue')
    // 不乐观回显：用户消息通过 session/event(user/message) 下发。
  }

  /**
   * 尝试把一条斜杠命令行交给 dsh 命令注册表执行。
   * @returns true 表示命令已被 host 接收执行（不要再按普通消息发送）；
   *   false 表示这不是已注册命令（调用方按普通消息发送）。
   *   已注册命令执行失败时抛错（调用方提示用户，不发送给模型）。
   */
  async tryDispatchCommand(sessionId, line) {
    try {
      // commands/execute 的语义：已注册命令返回 {commandId, result}；
      // 未注册命令/非命令行返回 undefined；host 不支持该 RPC 时抛错。
      const result = await this.sessions.executeCommand(sessionId, line)
      return Boolean(result && result.commandId)
    } catch (error) {
      if (this.isUnsupportedCommandRpc(error)) {
        this.onLog(`dsh 未提供命令 RPC，按普通消息发送: ${String(error.message)}`)
        return false
      }
      throw error
    }
  }

  isUnsupportedCommandRpc(error) {
    const message = String(error && error.message || '')
    if (error instanceof DshRpcError) {
      // Typert gateway 对未注册端点返回 internal + invocation-unavailable。
      return error.code === 'internal' && /invocation-unavailable|no active Remote method/u.test(message)
    }
    // 旧版 host 的 HTTP /api 路由对未注册方法返回 404（载体错误）。
    return /HTTP 404|not found|载体错误/u.test(message)
  }

  async refreshPresets() {
    if (!this.dsh.client) return
    const result = await this.sessions.listAgentPresets()
    const presets = (result.presets || []).map((preset) => {
      const builtInNames = {
        standard: '标准模式',
        code: 'PTC 模式',
        minimal: '极简模式',
        cordis: '创造模式',
      }
      const builtInDescriptions = {
        standard: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
        code: '具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
        minimal: '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
        cordis: '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
      }
      return {
        id: preset.id,
        name: builtInNames[preset.id] || preset.name || preset.id,
        description: builtInDescriptions[preset.id] || preset.description || '',
        trust: preset.trust,
        isDefault: preset.isDefault,
      }
    })
    this.post({ type: 'presets', presets })
  }

  async refreshModels(sessionId) {
    if (!sessionId || !this.dsh.client) return
    try {
      const models = await this.sessions.models(sessionId)
      this.post({ type: 'models', sessionId, models })
    } catch (error) {
      this.onLog(`加载模型目录失败: ${String(error)}`)
      this.post({ type: 'models', sessionId, models: { current: null, routable: null, groups: [], failures: [], error: String(error) } })
    }
  }

  async selectModel(provider, model, effort) {
    const sessionId = this.selectedSessionId
    if (!sessionId) throw new Error('请先选择或创建会话')
    await this.sessions.selectModel(sessionId, provider, model, effort)
    await this.refreshModels(sessionId)
  }

  async refreshCommands(sessionId) {
    if (!sessionId || !this.dsh.client) return
    try {
      const items = await this.sessions.listCommands(sessionId)
      const commands = (Array.isArray(items) ? items : []).map((c) => ({
        name: c.name,
        description: c.description,
        hint: c.input?.hint || c.hint,
      }))
      this.post({ type: 'commands', sessionId, available: true, items: commands })
    } catch (error) {
      this.onLog(`加载命令目录失败: ${String(error)}`)
      this.post({ type: 'commands', sessionId, available: false, items: [] })
    }
  }

  async executeCommand(sessionId, line) {
    if (!sessionId || !line) return
    await this.sessions.executeCommand(sessionId, line)
  }

  async selectPermission(sessionId, preset) {
    if (!sessionId || !preset) return
    try {
      await this.sessions.executeCommand(sessionId, '/permission ' + preset)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isTerminalFence = message.includes('persistent terminal sessions')
      if (!isTerminalFence) {
        void vscode.window.showErrorMessage(`切换权限失败：${message}`)
        return
      }
      const action = await vscode.window.showErrorMessage(
        `切换权限失败：${message}`,
        '让 Agent 关闭终端后重试',
        '重试',
        '取消',
      )
      if (action === '让 Agent 关闭终端后重试') {
        await this.closeTerminalsThenSwitch(sessionId, preset)
      } else if (action === '重试') {
        await this.selectPermission(sessionId, preset)
      }
    }
  }

  async closeTerminalsThenSwitch(sessionId, preset) {
    // 插件无法直接关闭 dsh 的持久终端（无对应 RPC），因此请求 Agent 调用
    // terminal_list / terminal_close 关闭全部终端，然后等待会话空闲再重试切换权限。
    await this.sessions.prompt(sessionId, '请使用 terminal_list 查看当前所有持久终端会话，并对每个会话调用 terminal_close 将其关闭。关闭完成后，请只回复“终端已关闭”。', 'queue')
    const idle = await this.waitForSessionIdle(sessionId, 120000)
    if (!idle) {
      void vscode.window.showWarningMessage('等待 Agent 关闭终端超时，请稍后手动重试权限切换。')
      return
    }
    await this.selectPermission(sessionId, preset)
  }

  async waitForSessionIdle(sessionId, timeoutMs) {
    const start = Date.now()
    let sawRunning = false
    while (Date.now() - start < timeoutMs) {
      const running = this.sessionRunning.get(sessionId)
      if (running === true) sawRunning = true
      if (sawRunning && running === false) return true
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return false
  }

  async refreshSettings() {
    if (!this.dsh.client) throw new Error('dsh web 尚未就绪')
    const client = this.sessions.requireClient()
    const settingsResult = await client.call('settings.describe', {})
    // 工作区列表供"管理工作区"页使用；获取失败不阻断设置面板打开。
    // 会话数按"工作中+已归档"统计：工作中 = 账本中未归档、非空白占位、非子代理的会话
    // （与下拉列表可见会话一致）；已归档 = 账本中位于全局归档集合里的会话。
    let workspaces = []
    const archivedSet = new Set()
    try {
      const list = await client.call('workspace.list', {})
      this.sessions.setArchived(list.archivedSessionIds || [])
      for (const id of list.archivedSessionIds || []) archivedSet.add(id)
      let sessionMeta = new Map()
      try {
        const { items } = await this.sessions.listAllSessions()
        sessionMeta = new Map((items || []).map((s) => [s.sessionId, s]))
      } catch (error) {
        this.onLog(`session.list 获取失败: ${error instanceof Error ? error.message : String(error)}`)
      }
      workspaces = (list.items || []).map((ws) => {
        const ids = ws.sessionIds || []
        let archivedCount = 0
        let activeCount = 0
        for (const id of ids) {
          if (archivedSet.has(id)) { archivedCount++; continue }
          const meta = sessionMeta.get(id)
          if (meta && (meta.blank || meta.origin === 'subagent')) continue
          activeCount++
        }
        return { ...ws, activeCount, archivedCount }
      })
    } catch (error) {
      this.onLog(`workspace.list 获取失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    const folder = vscode.workspace.workspaceFolders?.[0]
    this.post({
      type: 'settingsData',
      data: {
        writable: settingsResult.writable,
        hasDocument: settingsResult.hasDocument,
        sessionDisplay: this.sessionDisplay,
        fontSize: this.fontSize,
        maxWidth: this.maxWidth,
        language: this.language,
        enterToSend: this.enterToSend,
        showContextUsage: this.showContextUsage,
        contextBarColor: this.contextBarColor,
        contextBarOpacity: this.contextBarOpacity,
        autoStart: this.autoStart,
        autoOpenChat: this.autoOpenChat,
        baseUrl: this.dsh.baseUrl || null,
        workspaces,
        currentWorkspaceId: this.workspaceView?.workspaceId ?? null,
        currentFolderPath: folder ? folder.uri.fsPath : null,
        showArchivedSessions: this.showArchivedSessions,
        version: extensionVersion,
      },
    })
  }

  async renameWorkspace(workspaceId, title) {
    const next = String(title || '').trim()
    if (!next) return
    const result = await this.sessions.renameWorkspace(workspaceId, next)
    if (this.workspaceView && result?.workspace && result.workspace.workspaceId === this.workspaceView.workspaceId) {
      this.workspaceView = result.workspace
    }
    await this.refreshSettings()
    await this.refreshSessions()
  }

  async deleteWorkspace(workspaceId) {
    let targetPath = workspaceId
    try {
      const list = await this.sessions.listWorkspaces()
      targetPath = (list.items || []).find((w) => w.workspaceId === workspaceId)?.path ?? workspaceId
    } catch {
      // 取不到工作区信息时用 workspaceId 展示
    }
    const answer = await vscode.window.showWarningMessage(
      `删除工作区？\n${targetPath}\n该操作将删除该工作区及其全部会话，且不可恢复。`,
      { modal: true },
      '删除',
      '取消',
    )
    if (answer !== '删除') return
    await this.sessions.deleteWorkspace(workspaceId)
    if (this.workspaceView && this.workspaceView.workspaceId === workspaceId) {
      // 删除的是当前使用的工作区：清空映射并重新走确认流程（可重新添加）。
      this.workspaceView = null
      this.sessions.reset()
      this.selectedSessionId = null
      this.workspacePromptedPath = null
      this.workspacePromptAccepted = false
      this.post({ type: 'workspace', workspace: null })
      this.post({ type: 'sessions', sessions: [], selectedSessionId: null })
      void this.ensureWorkspaceAndSession()
    }
    await this.refreshSettings()
  }

  // 关于页的 dsh 服务地址链接：在浏览器中打开 dsh Web UI。
  async openDshWeb() {
    const url = this.dsh.baseUrl
    if (!url) {
      void vscode.window.showErrorMessage('dsh web 尚未就绪')
      return
    }
    await vscode.env.openExternal(vscode.Uri.parse(url))
  }

  async openSettingsDocument() {
    const client = this.sessions.requireClient()
    // 先让 dsh 侧物化 settings.yaml（缺失时创建）；即使远端没有桌面可打开，
    // 插件也会在 VS Code 中打开该文件，保证用户有可见反馈。
    try {
      await client.call('settings.openDocument', {})
    } catch (error) {
      this.onLog(`dsh settings.openDocument 调用失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const settingsPath = join(dshHome, 'settings.yaml')
    const uri = vscode.Uri.file(settingsPath)
    try {
      const document = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(document)
    } catch (error) {
      void vscode.window.showErrorMessage(`无法打开 ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async setSessionDisplay(value) {
    const next = value === 'detailed' ? 'detailed' : 'concise'
    this.sessionDisplay = next
    // 写入失败不静默：让错误冒泡到 handleMessage 的统一 catch，弹窗告知用户，
    // 避免“当前会话生效、重启后恢复默认”且用户无感知。
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('sessionDisplay', next, vscode.ConfigurationTarget.Global)
    this.post({ type: 'sessionDisplay', value: next })
  }

  async setFontSize(value) {
    const size = Number(value)
    if (!Number.isFinite(size) || size < 10 || size > 24) return
    this.fontSize = size
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('fontSize', size, vscode.ConfigurationTarget.Global)
    this.post({ type: 'fontSize', value: size })
  }

  async setLanguage(value) {
    const next = value === 'en' ? 'en' : 'zh'
    this.language = next
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('language', next, vscode.ConfigurationTarget.Global)
    this.post({ type: 'language', value: next })
  }

  async setEnterToSend(value) {
    const next = value === false ? false : true
    this.enterToSend = next
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('enterToSend', next, vscode.ConfigurationTarget.Global)
    this.post({ type: 'enterToSend', value: next })
  }

  async setMaxWidth(value) {
    const width = Number(value)
    if (!Number.isFinite(width) || width < 0 || width > 4000) return
    this.maxWidth = width
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('maxWidth', width, vscode.ConfigurationTarget.Global)
    this.post({ type: 'maxWidth', value: width })
  }

  async setShowContextUsage(value) {
    const next = value !== false
    this.showContextUsage = next
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('showContextUsage', next, vscode.ConfigurationTarget.Global)
    this.post({ type: 'showContextUsage', value: next })
  }

  async setContextBarColor(value) {
    const next = String(value || '').trim() || 'var(--accent)'
    this.contextBarColor = next
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('contextBarColor', next, vscode.ConfigurationTarget.Global)
    this.post({ type: 'contextBarColor', value: next })
  }

  async setContextBarOpacity(value) {
    const opacity = Number(value)
    if (!Number.isFinite(opacity)) return
    const next = Math.min(100, Math.max(0, opacity))
    this.contextBarOpacity = next
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('contextBarOpacity', next, vscode.ConfigurationTarget.Global)
    this.post({ type: 'contextBarOpacity', value: next })
  }

  async setAutoStart(value) {
    const next = value !== false
    this.autoStart = next
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('autoStart', next, vscode.ConfigurationTarget.Global)
    this.post({ type: 'autoStart', value: next })
  }

  async setAutoOpenChat(value) {
    const next = value !== false
    this.autoOpenChat = next
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('autoOpenChat', next, vscode.ConfigurationTarget.Global)
    this.post({ type: 'autoOpenChat', value: next })
  }

  async setShowArchivedSessions(value) {
    const next = value === true
    this.showArchivedSessions = next
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('showArchivedSessions', next, vscode.ConfigurationTarget.Global)
    this.post({ type: 'showArchivedSessions', value: next })
    await this.refreshSessions()
  }

  // 状态徽标（已停止/错误）点击后：重新探测 dsh web 实例。
  // autoStart 开启则允许自动生成；关闭则只复用已手动运行的实例。
  async retryConnect() {
    const status = this.dsh.statusValue
    if (status === 'ready' || status === 'starting' || status === 'discovering') return
    await this.dsh.start({ allowSpawn: this.autoStart !== false })
  }

  // 配置被外部修改（VS Code 设置 UI、settings.json 等）时同步 provider 状态与 webview。
  updatePreferences(prefs) {
    if (prefs.sessionDisplay !== undefined && prefs.sessionDisplay !== this.sessionDisplay) {
      this.sessionDisplay = prefs.sessionDisplay
      this.post({ type: 'sessionDisplay', value: prefs.sessionDisplay })
    }
    if (prefs.fontSize !== undefined && prefs.fontSize !== this.fontSize) {
      this.fontSize = prefs.fontSize
      this.post({ type: 'fontSize', value: prefs.fontSize })
    }
    if (prefs.maxWidth !== undefined && prefs.maxWidth !== this.maxWidth) {
      this.maxWidth = prefs.maxWidth
      this.post({ type: 'maxWidth', value: prefs.maxWidth })
    }
    if (prefs.showContextUsage !== undefined && prefs.showContextUsage !== this.showContextUsage) {
      this.showContextUsage = prefs.showContextUsage
      this.post({ type: 'showContextUsage', value: prefs.showContextUsage })
    }
    if (prefs.contextBarColor !== undefined && prefs.contextBarColor !== this.contextBarColor) {
      this.contextBarColor = prefs.contextBarColor
      this.post({ type: 'contextBarColor', value: prefs.contextBarColor })
    }
    if (prefs.contextBarOpacity !== undefined && prefs.contextBarOpacity !== this.contextBarOpacity) {
      this.contextBarOpacity = prefs.contextBarOpacity
      this.post({ type: 'contextBarOpacity', value: prefs.contextBarOpacity })
    }
    if (prefs.language !== undefined && prefs.language !== this.language) {
      this.language = prefs.language
      this.post({ type: 'language', value: prefs.language })
    }
    if (prefs.enterToSend !== undefined && prefs.enterToSend !== this.enterToSend) {
      this.enterToSend = prefs.enterToSend
      this.post({ type: 'enterToSend', value: prefs.enterToSend })
    }
    if (prefs.autoStart !== undefined && prefs.autoStart !== this.autoStart) {
      this.autoStart = prefs.autoStart
      this.post({ type: 'autoStart', value: prefs.autoStart })
    }
    if (prefs.autoOpenChat !== undefined && prefs.autoOpenChat !== this.autoOpenChat) {
      this.autoOpenChat = prefs.autoOpenChat
      this.post({ type: 'autoOpenChat', value: prefs.autoOpenChat })
    }
    if (prefs.showArchivedSessions !== undefined && prefs.showArchivedSessions !== this.showArchivedSessions) {
      this.showArchivedSessions = prefs.showArchivedSessions === true
      this.post({ type: 'showArchivedSessions', value: this.showArchivedSessions })
      void this.refreshSessions()
    }
  }

  async closeSession(sessionId) {
    if (!sessionId) return

    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) throw new Error('没有打开的工作区，无法归档会话')

    // 归档前先把会话记录保存到当前工作目录，避免关闭后丢失可追溯的会话副本。
    const archiveDir = join(folder.uri.fsPath, '.dsh-vsc', 'archived-sessions')
    let session
    let history
    try {
      session = await this.sessions.getSession(sessionId)
      history = await this.sessions.history(sessionId)
    } catch (error) {
      throw new Error(`读取会话信息失败，未执行归档: ${error instanceof Error ? error.message : String(error)}`)
    }

    const fallbackTitle = session?.blank ? '新会话' : sessionId.slice(0, 8)
    const title = typeof session?.title === 'string' && session.title.trim()
      ? session.title.trim()
      : fallbackTitle
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const archiveFileName = `${stamp}-${sanitizeFileName(title)}-${sessionId}.json`
    const archivePath = join(archiveDir, archiveFileName)
    const record = {
      archivedAt: new Date().toISOString(),
      workspace: folder.uri.fsPath,
      session: {
        sessionId,
        title: session?.title ?? null,
        blank: session?.blank ?? false,
        agentPreset: session?.agentPreset ?? null,
        cwd: session?.cwd ?? folder.uri.fsPath,
        updatedAt: session?.updatedAt ?? null,
      },
      history,
    }

    try {
      mkdirSync(archiveDir, { recursive: true })
      writeFileSync(archivePath, JSON.stringify(record, null, 2), 'utf8')
    } catch (error) {
      throw new Error(`保存会话归档失败，未执行归档: ${archivePath} — ${error instanceof Error ? error.message : String(error)}`)
    }

    await this.sessions.archiveSession(sessionId)
    // 归档后清理该会话的所有本地缓存，避免长期运行后内存持续增长。
    if (this.conversationFlushTimer) {
      clearTimeout(this.conversationFlushTimer)
      this.conversationFlushTimer = null
    }
    this.eventsBySession.delete(sessionId)
    this.queuesBySession.delete(sessionId)
    this.pendingQuestionsBySession.delete(sessionId)
    this.pendingApprovalsBySession.delete(sessionId)
    this.projectionsBySession.delete(sessionId)
    this.hasMoreBySession.delete(sessionId)
    this.sessionRunning.delete(sessionId)
    if (this.selectedSessionId === sessionId) this.selectedSessionId = null
    await this.refreshSessions()
    if (!this.selectedSessionId) await this.autoAttachSession()

    const notice = `会话已归档，副本保存在 ${archivePath}`
    this.post({ type: 'notice', text: notice })
    void vscode.window.showInformationMessage(notice)
  }

  async renameSession(sessionId) {
    if (!sessionId) return
    const title = await vscode.window.showInputBox({ prompt: '输入新的会话标题' })
    if (!title) return
    await this.sessions.renameSession(sessionId, title)
    await this.refreshSessions()
  }

  async cancel() {
    const sessionId = this.selectedSessionId
    if (!sessionId) return
    await this.sessions.cancel(sessionId)
  }

  async refreshSessions() {
    if (!this.dsh.client || !this.workspaceView) {
      this.post({ type: 'sessions', sessions: [], selectedSessionId: this.selectedSessionId })
      return
    }
    const list = await this.sessions.listSessions(this.selectedSessionId, this.showArchivedSessions)
    for (const item of list) {
      const running = this.sessionRunning.get(item.sessionId)
      if (running !== undefined) item.running = item.running || running
      item.archived = this.sessions.isArchived(item.sessionId)
      const title = item.projections?.values?.title
      if (!item.title && typeof title === 'string' && title) item.title = title
      if (item.projections) {
        for (const [key, value] of Object.entries(item.projections.values ?? {})) {
          this.seedProjection(item.sessionId, key, value, item.projections.asOfSeq)
        }
      }
    }
    this.post({ type: 'sessions', sessions: list, selectedSessionId: this.selectedSessionId })
    this.postStats(this.selectedSessionId)
  }

  ensureProjectionStore(sessionId) {
    let store = this.projectionsBySession.get(sessionId)
    if (!store) {
      store = new Map()
      this.projectionsBySession.set(sessionId, store)
    }
    return store
  }

  seedProjection(sessionId, key, value, seq) {
    if (sessionId === null || sessionId === undefined) return
    const store = this.ensureProjectionStore(sessionId)
    const prev = store.get(key)
    if (!prev || (typeof seq === 'number' && seq >= prev.seq)) {
      store.set(key, { seq: typeof seq === 'number' ? seq : 0, value })
    }
  }

  updateProjection(sessionId, key, value, seq) {
    if (sessionId === null || sessionId === undefined) return
    const store = this.ensureProjectionStore(sessionId)
    const prev = store.get(key)
    if (!prev || (typeof seq === 'number' && seq > prev.seq)) {
      store.set(key, { seq: typeof seq === 'number' ? seq : 0, value })
    }
  }

  projectionValue(sessionId, key) {
    if (!sessionId) return undefined
    const store = this.projectionsBySession.get(sessionId)
    return store?.get(key)?.value
  }

  postStats(sessionId) {
    if (!sessionId) return
    const store = this.projectionsBySession.get(sessionId)
    if (!store) return
    const get = (key) => store.get(key)?.value
    const stats = {
      tokenUsage: get('tokenUsage'),
      sessionStats: get('sessionStats'),
      contextPressure: get('contextPressure'),
      contextBreakdown: get('contextBreakdown'),
      todos: get('todos'),
      permissions: get('permissions'),
    }
    this.post({ type: 'stats', sessionId, stats })
  }

  queueSnapshot(sessionId) {
    return this.queuesBySession.get(sessionId) || []
  }

  postQueue(sessionId) {
    if (!sessionId) return
    this.post({ type: 'queue', sessionId, items: this.queueSnapshot(sessionId) })
  }

  ingestQueue(sessionId, items) {
    if (!sessionId) return
    const queued = (items || [])
      .map((item) => {
        const text = extractText(item.message?.content)
        return { id: item.id, placement: item.placement, text }
      })
      .filter((item) => item.placement === 'queued' && item.text.trim().length > 0)
    this.queuesBySession.set(sessionId, queued)
    if (sessionId === this.selectedSessionId) this.postQueue(sessionId)
  }

  async removeQueuedItem(sessionId, itemId) {
    if (!sessionId || !itemId) return
    await this.sessions.updateQueue(sessionId, itemId, { kind: 'remove' })
    // 本地先移除，dsh 随后会广播 session/queue 权威快照做最终收敛。
    const next = (this.queuesBySession.get(sessionId) || []).filter((item) => item.id !== itemId)
    this.queuesBySession.set(sessionId, next)
    if (sessionId === this.selectedSessionId) this.postQueue(sessionId)
  }

  questionSnapshot(sessionId) {
    const list = this.pendingQuestionsBySession.get(sessionId) || []
    return list[0] || null
  }

  postQuestion(sessionId) {
    if (!sessionId) return
    this.post({ type: 'question', sessionId, pending: this.questionSnapshot(sessionId) })
  }

  ingestQuestionRequested(sessionId, rpcId, questions) {
    if (!sessionId || !rpcId) return
    const list = this.pendingQuestionsBySession.get(sessionId) || []
    const exists = list.some((item) => item.rpcId === rpcId)
    if (!exists) {
      list.push({ rpcId, questions: questions || [] })
      this.pendingQuestionsBySession.set(sessionId, list)
    }
    if (sessionId === this.selectedSessionId) this.postQuestion(sessionId)
  }

  ingestQuestionResolved(sessionId, questionRpcId) {
    if (!sessionId) return
    const list = this.pendingQuestionsBySession.get(sessionId)
    if (!list) return
    const next = list.filter((item) => item.rpcId !== questionRpcId)
    this.pendingQuestionsBySession.set(sessionId, next)
    if (sessionId === this.selectedSessionId) this.postQuestion(sessionId)
  }

  async answerQuestion(sessionId, rpcId, answers) {
    if (!sessionId || !rpcId || !Array.isArray(answers)) return
    const client = this.sessions.requireClient()
    const receipt = await client.respond({
      type: 'client-response',
      rpcId,
      result: {
        ok: true,
        value: {
          sessionId,
          answer: { answers },
        },
      },
    })
    if (!receipt.accepted) {
      this.onLog(`问题应答未受理: ${receipt.reason || 'unknown'}`)
    }
  }

  async cancelQuestion(sessionId, rpcId) {
    if (!sessionId || !rpcId) return
    const client = this.sessions.requireClient()
    const receipt = await client.respond({
      type: 'client-response',
      rpcId,
      result: {
        ok: false,
        error: { code: 'cancelled', message: 'user cancelled the question', details: {} },
      },
    })
    if (!receipt.accepted) {
      this.onLog(`取消问题未受理: ${receipt.reason || 'unknown'}`)
    }
  }

  approvalSnapshot(sessionId) {
    const list = this.pendingApprovalsBySession.get(sessionId) || []
    return list[0] || null
  }

  postApproval(sessionId) {
    if (!sessionId) return
    this.post({ type: 'approval', sessionId, pending: this.approvalSnapshot(sessionId) })
  }

  ingestApprovalRequested(sessionId, rpcId, payload) {
    if (!sessionId || !rpcId) return
    const list = this.pendingApprovalsBySession.get(sessionId) || []
    const exists = list.some((item) => item.rpcId === rpcId)
    if (!exists) {
      list.push({
        rpcId,
        approvalId: payload.approvalId,
        toolName: payload.toolName,
        callId: payload.callId,
        reason: payload.reason,
      })
      this.pendingApprovalsBySession.set(sessionId, list)
    }
    if (sessionId === this.selectedSessionId) this.postApproval(sessionId)
  }

  ingestApprovalResolved(sessionId, approvalId) {
    if (!sessionId) return
    const list = this.pendingApprovalsBySession.get(sessionId)
    if (!list) return
    const next = list.filter((item) => item.approvalId !== approvalId)
    this.pendingApprovalsBySession.set(sessionId, next)
    if (sessionId === this.selectedSessionId) this.postApproval(sessionId)
  }

  async answerApproval(sessionId, rpcId, approvalId, outcome) {
    if (!sessionId || !rpcId || !approvalId) return
    if (outcome !== 'allowed-once' && outcome !== 'rejected') return
    const client = this.sessions.requireClient()
    const receipt = await client.respond({
      type: 'client-response',
      rpcId,
      result: {
        ok: true,
        value: { sessionId, approvalId, outcome },
      },
    })
    if (!receipt.accepted) {
      this.onLog(`审批应答未受理: ${receipt.reason || 'unknown'}`)
    }
  }

  async editQueuedItem(sessionId, itemId) {
    if (!sessionId || !itemId) return
    const current = (this.queuesBySession.get(sessionId) || []).find((item) => item.id === itemId)
    const text = await vscode.window.showInputBox({
      prompt: '编辑排队消息',
      value: current?.text || '',
    })
    if (!text) return
    await this.sessions.updateQueue(sessionId, itemId, { kind: 'edit', content: [{ type: 'text', text }] })
    // dsh 会广播 session/queue 权威快照；这里不再乐观更新，避免与快照竞态。
  }

  async steerQueuedItem(sessionId, itemId) {
    if (!sessionId || !itemId) return
    await this.sessions.updateQueue(sessionId, itemId, { kind: 'steer' })
  }

  formatConversationMarkdown(session, history) {
    const events = (history.events || []).map((item) => item.event)
    const folded = foldEvents(events)
    const lines = []
    lines.push('# 会话上下文')
    lines.push('')
    lines.push('- 会话: ' + (session?.sessionId || ''))
    lines.push('- 标题: ' + (session?.title || '未命名'))
    lines.push('- 工作目录: ' + (session?.cwd || ''))
    lines.push('- 导出时间: ' + new Date().toISOString())
    lines.push('')
    for (const item of folded.items) {
      if (item.type === 'user') {
        lines.push('## 用户');
        lines.push('');
        lines.push(item.text || '');
      } else if (item.type === 'assistant') {
        lines.push('## Assistant');
        lines.push('');
        lines.push(item.text || '');
      } else {
        continue
      }
      lines.push('');
    }
    return lines.join('\n')
  }

  async downloadSession(sessionId) {
    if (!sessionId) throw new Error('请先选择会话')
    const session = await this.sessions.getSession(sessionId)
    const history = await this.sessions.history(sessionId)
    const fallbackTitle = session?.blank ? '新会话' : sessionId.slice(0, 8)
    const title = typeof session?.title === 'string' && session.title.trim()
      ? session.title.trim()
      : fallbackTitle
    const defaultName = `${sanitizeFileName(title)}-context.md`
    const folder = vscode.workspace.workspaceFolders?.[0]
    const defaultDir = folder ? folder.uri.fsPath : homedir()
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(join(defaultDir, defaultName)),
      filters: {
        Markdown: ['md'],
        JSON: ['json'],
      },
    })
    if (!saveUri) return
    const isJson = saveUri.fsPath.toLowerCase().endsWith('.json')
    const content = isJson
      ? JSON.stringify({ session: session || { sessionId }, history }, null, 2)
      : this.formatConversationMarkdown(session, history)
    writeFileSync(saveUri.fsPath, content, 'utf8')
    void vscode.window.showInformationMessage(`会话上下文已保存到 ${saveUri.fsPath}`)
  }

  async pickFiles() {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!folder) {
      this.post({ type: 'filePickList', files: [] })
      return
    }
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*'),
      '{**/node_modules/**,**/.git/**}',
      2000,
    )
    const files = uris
      .map((uri) => toPosix(relative(folder.uri.fsPath, uri.fsPath)))
      .filter((p) => p && p !== '.' && !p.startsWith('..'))
      .sort((a, b) => a.localeCompare(b))
    this.post({ type: 'filePickList', files })
  }

  // ---- conversation state ----

  getEventsEntry(sessionId, create) {
    let entry = this.eventsBySession.get(sessionId)
    if (!entry && create) {
      entry = { seen: new Set(), events: [] }
      this.eventsBySession.set(sessionId, entry)
    }
    return entry
  }

  conversationSnapshot() {
    const sessionId = this.selectedSessionId
    if (!sessionId) return []
    const entry = this.eventsBySession.get(sessionId)
    if (!entry) return []
    const folded = foldEvents(entry.events)
    return folded.items
  }

  isSessionRunning(sessionId) {
    if (!sessionId) return false
    if (this.sessionRunning.has(sessionId)) return this.sessionRunning.get(sessionId)
    const entry = this.eventsBySession.get(sessionId)
    if (!entry) return false
    return foldEvents(entry.events).running
  }

  async loadHistory(sessionId) {
    const history = await this.sessions.history(sessionId)
    const entry = this.getEventsEntry(sessionId, true)
    for (const item of history.events) {
      const event = item.event
      if (entry.seen.has(event.seq)) continue
      entry.seen.add(event.seq)
      entry.events.push({ seq: event.seq, time: event.time, type: event.type, data: event.data })
    }
    entry.events.sort((a, b) => a.seq - b.seq)
    this.hasMoreBySession.set(sessionId, history.hasMore)
    this.postConversation(sessionId)
  }

  async loadEarlier(sessionId) {
    if (!sessionId || !this.dsh.client) return
    if (!(this.hasMoreBySession.get(sessionId) ?? false)) return
    const entry = this.getEventsEntry(sessionId, true)
    const oldestSeq = entry.events.length > 0 ? entry.events[0].seq : undefined
    const history = await this.sessions.history(sessionId, oldestSeq)
    for (const item of history.events) {
      const event = item.event
      if (entry.seen.has(event.seq)) continue
      entry.seen.add(event.seq)
      entry.events.push({ seq: event.seq, time: event.time, type: event.type, data: event.data })
    }
    entry.events.sort((a, b) => a.seq - b.seq)
    this.hasMoreBySession.set(sessionId, history.hasMore)
    this.postConversation(sessionId)
  }

  ingestEvent(sessionId, event) {
    // 所有会话的事件都入缓存（按 seq 去重）；只有选中会话需要推送渲染。
    // 未选中会话的事件在切回时由 loadHistory 兜底，这里缓存可避免重复拉取。
    const entry = this.getEventsEntry(sessionId, true)
    if (entry.seen.has(event.seq)) return
    entry.seen.add(event.seq)
    entry.events.push({ seq: event.seq, time: event.time, type: event.type, data: event.data })
    // 事件基本按 seq 顺序到达：仅在乱序时做插入，避免每个 chunk 都全量 sort。
    if (entry.events.length > 1 && entry.events[entry.events.length - 1].seq < entry.events[entry.events.length - 2].seq) {
      const item = entry.events.pop()
      let i = entry.events.length - 1
      while (i >= 0 && entry.events[i].seq > item.seq) {
        entry.events[i + 1] = entry.events[i]
        i--
      }
      entry.events[i + 1] = item
    }
    if (sessionId === this.selectedSessionId) {
      if (event.type === 'turn/end') this.flushConversationPost()
      else this.scheduleConversationPost()
    }
  }

  postConversation(sessionId) {
    if (sessionId !== this.selectedSessionId) return
    const entry = this.eventsBySession.get(sessionId)
    if (!entry) return
    const folded = foldEvents(entry.events)
    this.post({
      type: 'conversation',
      sessionId,
      selectedSessionId: this.selectedSessionId,
      conversation: folded.items,
      running: folded.running,
      hasMoreEarlier: this.hasMoreBySession.get(sessionId) ?? false,
    })
  }

  // 节流推送：合并 ~30ms 内的流式 chunk，减少全量折叠与 postMessage 次数。
  scheduleConversationPost() {
    if (this.conversationFlushTimer) return
    this.conversationFlushTimer = setTimeout(() => {
      this.conversationFlushTimer = null
      this.postConversation(this.selectedSessionId)
    }, 30)
  }

  // 回合结束时立即推送，避免结尾内容被节流延迟。
  flushConversationPost() {
    if (this.conversationFlushTimer) {
      clearTimeout(this.conversationFlushTimer)
      this.conversationFlushTimer = null
    }
    this.postConversation(this.selectedSessionId)
  }

  // 切换会话前丢弃待发送的节流任务，避免旧会话的折叠结果推送到新选中会话。
  clearConversationPost() {
    if (this.conversationFlushTimer) {
      clearTimeout(this.conversationFlushTimer)
      this.conversationFlushTimer = null
    }
  }

  appendNote(sessionId, text) {
    const entry = this.getEventsEntry(sessionId, true)
    // 使用大正 seq 避免与真实事件冲突，并让 note 排在真实事件之后；仅用于会话内展示。
    entry.events.push({ seq: 1_000_000_000 + entry.events.length, time: Date.now(), type: 'note', data: { text } })
    entry.events.sort((a, b) => a.seq - b.seq)
    this.postConversation(sessionId)
  }

  resyncSelected() {
    const sessionId = this.selectedSessionId
    if (!sessionId) return
    // 事件流重连后重拉 history 尾页；ingest 按 seq 去重，不丢不重。
    this.loadHistory(sessionId).catch((error) => this.onLog(`会话重同步失败: ${String(error)}`))
  }

  // ---- dsh frame handling ----

  applyMuxFrame(frame) {
    const payload = frame.payload
    if (frame.method === 'session/event') {
      this.ingestEvent(payload.sessionId, payload.event)
    } else if (frame.method === 'session/queue') {
      this.ingestQueue(payload.sessionId, payload.items)
    } else if (frame.method === 'question/requested') {
      this.ingestQuestionRequested(payload.sessionId, frame.rpcId, payload.questions)
    } else if (frame.method === 'question/resolved') {
      this.ingestQuestionResolved(payload.sessionId, payload.questionRpcId)
    } else if (frame.method === 'approval/requested') {
      this.ingestApprovalRequested(payload.sessionId, frame.rpcId, payload)
    } else if (frame.method === 'approval/resolved') {
      this.ingestApprovalResolved(payload.sessionId, payload.approvalId)
    } else if (frame.method === 'session/projection') {
      this.updateProjection(payload.sessionId, payload.key, payload.value, payload.seq)
      if (payload.sessionId === this.selectedSessionId) this.postStats(payload.sessionId)
    } else if (frame.method === 'stream/error') {
      this.onLog(`[events.mux] stream/error: ${payload.error?.message ?? ''}`)
    }
  }

  applyHostFrame(frame) {
    const payload = frame.payload
    switch (frame.method) {
      case 'host/session-status':
        this.sessionRunning.set(payload.sessionId, payload.running)
        void this.refreshSessions()
        break
      case 'host/session-added':
      case 'host/workspace-changed':
      case 'host/archived-sessions-changed':
        if (payload.archivedSessionIds) this.sessions.setArchived(payload.archivedSessionIds)
        void this.refreshSessions()
        break
      case 'host/agent-error':
        if (payload.sessionId === this.selectedSessionId) this.appendNote(payload.sessionId, `Agent 错误：${payload.message}`)
        break
      case 'stream/error':
        this.onLog(`[events.host] stream/error: ${payload.error?.message ?? ''}`)
        break
      default:
        break
    }
  }

  onMuxClose() {
    if (this.dsh.statusValue === 'ready') this.resyncSelected()
  }
}

const { foldEvents, extractText } = require('./conversation.js')

module.exports = { ChatViewProvider, foldEvents }
