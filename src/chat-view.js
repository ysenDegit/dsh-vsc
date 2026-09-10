'use strict'

const vscode = require('vscode')
const { randomUUID } = require('node:crypto')
const { relative, join } = require('node:path')
const { homedir } = require('node:os')
const { existsSync } = require('node:fs')
const { getWebviewHtml } = require('./webview.js')
const { version: extensionVersion } = require('../package.json')
const { DshRpcError } = require('./wire.js')
const { isCommandLine } = require('./commands.js')
const { normalizePromptStashEntries, mergePromptStashTexts, applySessionActivity, isSubagentSession } = require('./protocol.js')

const viewType = 'dsh-vsc.chat'

/** 一次性挂载的会话条目上限（超出部分从"已加载窗口"里裁掉，点"加载更早"再向 dsh 分页）。 */
const LOADED_ITEM_LIMIT = 500

/** 无界面时可安全合并的消息类型（同类同会话只保留最新一条）。 */
/** 事件缓存上限（按访问顺序淘汰非选中会话）。 */
const EVENT_CACHE_LIMIT = 6

const COALESCED_MESSAGE_TYPES = new Set([
  'conversation', 'sessions', 'stats', 'queue', 'models', 'commands', 'presets',
  'question', 'approval', 'workspace', 'sessionSearch',
])

function toPosix(p) { return p.split('\\').join('/') }

/** 提示词暂存框条目是否等价（跳过重复落盘；图片按内容比较）。 */
function samePromptStash(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].text !== b[i].text) return false
    if (a[i].images.length !== b[i].images.length) return false
    for (let j = 0; j < a[i].images.length; j++) {
      const left = a[i].images[j]
      const right = b[i].images[j]
      if (left.mediaType !== right.mediaType || left.data !== right.data || left.name !== right.name) return false
    }
  }
  return true
}

class ChatViewProvider {
  constructor(dsh, sessions, options = {}) {
    this.dsh = dsh
    this.sessions = sessions
    // 保留原始 options：globalState 持久化回调（unarchived / promptStash）从这里取。
    this.options = options
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
    // 并发的初始化请求共享同一轮执行（onUiOpened / dsh ready / webview ready 可能同时触发）。
    this.ensureWork = null
    // 会话列表刷新的并发合并/防抖：host 状态帧高频到达时避免重复 RPC。
    this.refreshSessionsWork = null
    this.refreshSessionsTimer = null
    // rc.1 Remote 流：$events 的 clientId + 三个长流句柄 + 每会话 follow 句柄。
    this.remoteClientId = null
    this.eventStreamHandle = null
    this.controlStreamHandle = null
    this.workspaceStreamHandle = null
    this.followStreamHandles = new Map()
    // sessionId -> { promise, resolve }：session/follow 首个 snapshot 落地信号。
    this.followSnapshotsBySession = new Map()
    // sessionId -> 当前会话 cursor（session/page 的 throughSeq 不能超过它）。
    this.cursorBySession = new Map()
    // sessionId -> 工作模式 preset 选择。dsh 0.1.5 把 preset 放进 agentPreset 投影，
    // 这里的记录只作为乐观缓存/旧版兜底（见 doRefreshSessions 的合并顺序）。
    this.agentPresetBySession = new Map()
    // sessionId -> LiveAssistantStream：dsh 0.1.5 进程内 assistant-stream 帧
    // （durable 日志不再有 assistant/chunk，运行中的增量必须从这里来）。
    this.liveStreams = new Map()
    // 0.1.5 agentPresets/list 的 modeSelectionEnabled（旧版缺失时按 true 处理）。
    this.modeSelectionEnabled = true
    // sessionId -> 后台 jobs（session/control baseline/jobs 帧），用于统计行提示。
    this.jobsBySession = new Map()
    // 只在首次遇到"内容搜索未启用"时记一条日志，避免每次输入都刷屏。
    this.searchDisabledLogged = false
    // 本地"取消归档/隐藏归档"集合（dsh 无 unarchive API，只影响插件视图）。
    this.unarchivedLocally = new Set(options.loadUnarchived?.() || [])
    this.sessions.setArchivedIgnored(this.unarchivedLocally)
    // 悬浮提示词暂存框：开关（dsh-vsc.promptStash）+ 内容（globalState，数量不设上限）。
    // 空串是合法条目（代表"已创建但还没写内容的暂存槽"，过滤掉会让空框在重载后消失）。
    // 插件视图内的"提升为普通会话"集合：dsh 没有修改会话谱系（header 的 parentSession
    // 只在创建时写入且不可改）的 API，这里只让被提升的会话在抽屉里按顶层行显示，
    // 持久化在 globalState，随时可恢复层级。
    this.promotedLocally = new Set(options.loadPromoted?.() || [])
    this.promptStashEnabled = options.promptStashEnabled ?? true
    this.promptStashItems = normalizePromptStashEntries(options.loadPromptStash?.() || [])
    // sessionId -> 插件侧观察到的"最近修改时间"（提示词时间 / 运行状态变化 / 已加载的最后一条事件）。
    // dsh 的列表只给"最近提示词时间"，这里补上活动信息后列表按"最近修改时间"排序与显示。
    this.activityTimeBySession = new Map()
    // sessionId -> 已被用户关闭的目标横幅指纹：目标更新（objective/phase/rounds 变化）后重新显示。
    this.dismissedGoalBanner = new Map()
    // 合并刷新时记录"这次是用户主动点的"，用于决定是否弹"dsh 未就绪"提示。
    this.refreshUserInitiated = false
  }

  static get viewType() { return viewType }

  /** 宿主侧文案：按 `dsh-vsc.language` 选中英文。 */
  t(key, vars) { return translate(this.language, key, vars) }

  post(message) {
    if (this.webviews.size === 0) {
      this.enqueue(message)
      return
    }
    for (const webviewHost of this.webviews) {
      void webviewHost.webview.postMessage(message)
    }
  }

  /**
   * 无 webview 时的待发队列：会话/统计等高频率消息只保留"最新快照"，
   * 避免后台流式运行期间队列无限堆积（打开界面时 hydrate 会重新拉全量）。
   */
  enqueue(message) {
    const type = message && message.type
    if (type && COALESCED_MESSAGE_TYPES.has(type)) {
      const sessionId = message.sessionId === undefined || message.sessionId === null ? '' : String(message.sessionId)
      for (let index = this.queue.length - 1; index >= 0; index -= 1) {
        const queued = this.queue[index]
        if (!queued || queued.type !== type) continue
        const queuedId = queued.sessionId === undefined || queued.sessionId === null ? '' : String(queued.sessionId)
        if (queuedId !== sessionId) continue
        this.queue[index] = message
        return
      }
    }
    this.queue.push(message)
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
          // 竞态兜底：webview 首发 ready 往往早于工作区/会话初始化完成，
          // 此时 hydrate 会拿到空会话、且模型/命令/统计都不会被拉取。
          // 先等待（合并并发调用）初始化完成，保证首帧即带完整数据。
          if (this.dsh.statusValue === 'ready' && !this.selectedSessionId) {
            await this.ensureWorkspaceAndSession()
          }
          await this.hydrate()
          if (this.dsh.statusValue === 'ready') {
            void this.refreshPresets()
            if (this.selectedSessionId) {
              void this.refreshModels(this.selectedSessionId)
              void this.refreshCommands(this.selectedSessionId)
            }
            // 若初始化期间没有 session/projection 帧，统计行/权限按钮不会刷新；
            // 这里补发一次当前快照，保证 composer 首帧渲染完整。
            this.postStats(this.selectedSessionId)
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
          await this.send(msg.text, msg.images, msg.clientTimeZone, msg.files)
          break
        case 'loadAttachment':
          await this.loadAttachment(msg.sessionId, msg.attachmentId)
          break
        case 'log':
          this.onLog(String(msg.message ?? ''))
          break
        case 'cancel':
          await this.cancel()
          break
        case 'refreshSessions':
          await this.refreshSessions(true)
          break
        case 'refreshAll':
          await this.refreshAll()
          break
        case 'refreshPresets':
          await this.refreshPresets()
          break
        case 'sessionSearch':
          await this.searchSessions(msg.query)
          break
        case 'dismissGoalBanner':
          this.dismissGoalBanner(msg.sessionId || this.selectedSessionId)
          break
        case 'restoreSession':
          await this.restoreArchivedSession(msg.sessionId)
          break
        case 'promoteSession':
          await this.setSessionPromoted(msg.sessionId, msg.promoted !== false)
          break
        case 'unrestoreSession':
          await this.unrestoreArchivedSession(msg.sessionId)
          break
        case 'clearRestoredSessions':
          await this.clearRestoredSessions()
          break
        case 'openWorkspaceFolder':
          await this.openWorkspaceFolder(msg.sessionId || this.selectedSessionId)
          break
        case 'openPresetDirectory':
          await this.openPresetDirectory()
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
        case 'setPromptStash':
          await this.setPromptStash(msg.value)
          break
        case 'promptStashUpdate':
          // images=true 时是结构变化（新增/删除/移动图片），带完整条目；否则只是文本防抖。
          await this.updatePromptStash(msg.items, msg.images === true)
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
        case 'openFile':
          await this.openFile(msg.path)
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
        case 'forkSession':
          await this.forkSession(msg.sessionId || this.selectedSessionId)
          break
        case 'getUngroupedSessions':
          await this.getUngroupedSessions()
          break
        case 'attachUngrouped':
          await this.attachUngroupedSession(msg.sessionId)
          break
        case 'attachUngroupedAll':
          await this.attachAllUngroupedSessions()
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
    // hydrate 的列表也要带插件视图字段（提升标记），否则抽屉层级与后续 sessions 帧不一致。
    for (const item of list) {
      // 提升只对子代理会话有意义（分支会话本来就按普通会话顶层显示）。
      item.promotedLocally = isSubagentSession(item) && this.promotedLocally.has(item.sessionId)
      item.restoredLocally = this.unarchivedLocally.has(item.sessionId)
      // 会话模式（抽屉行右侧标签）：与 doRefreshSessions 同规则，首帧就能显示。
      const preset = sessionPresetOf(item) || this.agentPresetBySession.get(item.sessionId)
      if (preset) item.agentPreset = preset
    }
    // listSessions 返回的投影同样需要入缓存，供 statsSnapshot/permissions 读取。
    this.seedProjectionsFromList(list)
    this.post({
      type: 'hydrate',
      status: this.dsh.statusValue,
      workspace: this.workspaceView,
      sessions: applySessionActivity(list, this.activityTimeBySession),
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
      showArchivedSessions: this.showArchivedSessions,
      archivedAvailable: this.sessions.archivedCountInWorkspace(),
      restoredCount: this.unarchivedLocally.size,
      promptStash: { enabled: this.promptStashEnabled, items: this.promptStashItems.slice() },
      queue: this.queueSnapshot(this.selectedSessionId),
      hasMoreEarlier: this.hasMoreBySession.get(this.selectedSessionId) ?? false,
      question: this.questionSnapshot(this.selectedSessionId),
      approval: this.approvalSnapshot(this.selectedSessionId),
      todos: this.projectionValue(this.selectedSessionId, 'todos'),
      permissions: this.projectionValue(this.selectedSessionId, 'permissions'),
      // 统计快照随 hydrate 一起下发：首帧即渲染统计行/权限按钮，
      // 不依赖后续 session/projection 帧的到达时机。
      stats: this.statsSnapshot(this.selectedSessionId),
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

    // 等待 workspace/follow baseline 至少到达一次（最多 5s）：目录已在
    // dsh 工作区时不应在 baseline 到达前误判"未加入"而弹确认框。
    await this.sessions.whenWorkspaceReady()
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
      const addLabel = this.t('dialog.add')
      const answer = await vscode.window.showWarningMessage(
        this.t('dialog.workspaceAdd', { path: folder.uri.fsPath }),
        { modal: true },
        addLabel,
        this.t('dialog.cancel'),
      )
      this.workspacePromptedPath = folder.uri.fsPath
      this.workspacePromptAccepted = answer === addLabel
    }

    if (!this.workspacePromptAccepted) {
      this.workspaceView = null
      this.post({ type: 'workspace', workspace: null })
      this.post({ type: 'notice', text: this.t('notice.workspaceAddCancelled') })
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

  ensureWorkspaceAndSession() {
    // 并发合并：onUiOpened / dsh ready / webview ready 都可能触发初始化，
    // 让它们共享同一轮执行，避免两轮并行初始化造成消息交错、首帧数据缺失。
    if (!this.ensureWork) {
      this.ensureWork = this.doEnsureWorkspaceAndSession().finally(() => { this.ensureWork = null })
    }
    return this.ensureWork
  }

  async doEnsureWorkspaceAndSession() {
    try {
      this.ensureStreams()
      this.sessions.reset()
      // 重置清空了工作区缓存，且常开流不会自动重发 baseline：
      // 重开 workspace/follow 强制服务器重发，ensureWorkspace 会等它到达。
      this.reopenWorkspaceFollow()
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
    this.ensureWork = null
    await this.ensureWorkspaceAndSession()
  }

  async autoAttachSession() {
    if (this.selectedSessionId) return
    const workspace = await this.ensureWorkspace()
    if (!workspace) return
    this.clearConversationPost()
    // 启动时优先打开最近的非空白会话；只有完全没有现存会话时才创建空白新会话。
    const existingSessions = await this.sessions.listSessions(null, false, false)
    const existing = existingSessions[0]
    if (existing) {
      this.selectedSessionId = existing.sessionId
      this.ensureStreams()
      this.openSessionFollow(existing.sessionId)
      await this.refreshSessions()
      await this.loadHistory(existing.sessionId)
      await this.refreshModels(existing.sessionId)
      await this.refreshCommands(existing.sessionId)
      this.postQueue(existing.sessionId)
      this.postQuestion(existing.sessionId)
      this.postApproval(existing.sessionId)
      return
    }
    const created = await this.sessions.resolveNewSession()
    this.selectedSessionId = created.sessionId
    if (created.agentPreset) this.agentPresetBySession.set(created.sessionId, created.agentPreset)
    this.ensureStreams()
    this.openSessionFollow(created.sessionId)
    await this.refreshSessions()
    await this.loadHistory(created.sessionId)
    await this.refreshModels(created.sessionId)
    await this.refreshCommands(created.sessionId)
    this.postQueue(created.sessionId)
    this.postQuestion(created.sessionId)
    this.postApproval(created.sessionId)
  }

  async newSession() {
    if (!this.dsh.client) throw new Error(this.t('notice.webNotReady'))
    const workspace = await this.ensureWorkspace()
    if (!workspace) throw new Error(this.t('notice.noWorkspaceSession'))
    const created = await this.sessions.resolveNewSession()
    this.clearConversationPost()
    this.selectedSessionId = created.sessionId
    if (created.agentPreset) this.agentPresetBySession.set(created.sessionId, created.agentPreset)
    this.ensureStreams()
    this.openSessionFollow(created.sessionId)
    await this.refreshSessions()
    await this.loadHistory(created.sessionId)
    await this.refreshModels(created.sessionId)
    await this.refreshCommands(created.sessionId)
    this.postQueue(created.sessionId)
    this.postQuestion(created.sessionId)
    this.postApproval(created.sessionId)
  }

  async selectAgentPreset(sessionId, agentPreset) {
    if (!sessionId || !agentPreset) return
    try {
      await this.sessions.selectAgentPreset(sessionId, agentPreset)
      // rc.1 的 session/list 不携带 agentPreset：这里记录选择，刷新会话时合并回去，
      // 让欢迎页的模式卡片能立即显示选中态（否则点击后界面无任何反馈）。
      this.agentPresetBySession.set(sessionId, agentPreset)
      await this.refreshSessions()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.onLog(`切换工作模式失败: ${message}`)
      this.post({ type: 'notice', text: this.t('notice.presetSwitchFailed', { message }) })
    }
  }

  async selectSession(sessionId) {
    if (!sessionId) return
    this.clearConversationPost()
    this.selectedSessionId = sessionId
    this.ensureStreams()
    this.openSessionFollow(sessionId)
    await this.refreshSessions()
    // 历史/模型/命令目录互不依赖，并行加载以降低切换感知延迟。
    await Promise.all([
      this.loadHistory(sessionId),
      this.refreshModels(sessionId),
      this.refreshCommands(sessionId),
    ])
    this.postQueue(sessionId)
    this.postQuestion(sessionId)
    this.postApproval(sessionId)
  }

  /**
   * @param text - 文本内容。
   * @param images - `{mediaType,data,name?}` 图片附件。
   * @param clientTimeZone - 客户端时区。
   * @param files - 0.1.5 文件附件：`{name,data}`（base64）或 `{receiptId}`（已上传）。
   */
  async send(text, images = [], clientTimeZone, files = []) {
    if (!this.dsh.client) throw new Error(this.t('notice.webNotReady'))
    let sessionId = this.selectedSessionId
    if (!sessionId) {
      const workspace = await this.ensureWorkspace()
      if (!workspace) throw new Error(this.t('notice.noWorkspaceSend'))
      const created = await this.sessions.resolveNewSession()
      sessionId = created.sessionId
      this.selectedSessionId = sessionId
      this.ensureStreams()
      this.openSessionFollow(sessionId)
      await this.refreshSessions()
      await this.loadHistory(sessionId)
      await this.refreshModels(sessionId)
    }
    const line = String(text ?? '')
    // 与 web 端一致：完整斜杠命令行优先走命令执行，绝不发给模型；
    // 未注册命令才按普通消息发送。
    const receipts = await this.uploadFiles(sessionId, files)
    if (isCommandLine(line) && await this.tryDispatchCommand(sessionId, line, images, receipts)) return
    await this.sessions.prompt(sessionId, line, 'queue', images, clientTimeZone, receipts)
    // 不乐观回显：用户消息通过 session/event(user/message) 下发。
  }

  /**
   * 把 webview 选中的文件上传为 dsh 收据（file-upload 的 `upload` 端点）。
   * @returns `receiptId` 列表；单个失败只记日志并跳过，不阻断整条消息。
   */
  async uploadFiles(sessionId, files) {
    const receipts = []
    for (const file of files || []) {
      if (!file) continue
      if (file.receiptId) {
        receipts.push(file.receiptId)
        continue
      }
      if (!file.data) continue
      try {
        const uploaded = await this.sessions.uploadFile(sessionId, file.data, file.name)
        if (uploaded?.receiptId) receipts.push(uploaded.receiptId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.onLog(this.t('notice.uploadFailed', { message }))
        this.post({ type: 'notice', text: this.t('notice.uploadFailed', { message }) })
      }
    }
    return receipts
  }

  /**
   * 尝试把一条斜杠命令行交给 dsh 命令注册表执行。
   * @returns true 表示命令已被 host 接收执行（不要再按普通消息发送）；
   *   false 表示这不是已注册命令（调用方按普通消息发送）。
   *   已注册命令执行失败时抛错（调用方提示用户，不发送给模型）。
   */
  async tryDispatchCommand(sessionId, line, images = [], fileReceipts = []) {
    try {
      // commands/execute 的语义：已注册命令返回 {commandId, result}；
      // 未注册命令/非命令行返回 undefined；host 不支持该 RPC 时抛错。
      const attachments = [
        ...(images || []),
        ...(fileReceipts || []).map((receiptId) => ({ type: 'file', receiptId })),
      ]
      const result = await this.sessions.executeCommand(sessionId, line, attachments)
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
        // 0.1.5 的 preset 行自带本地化 name/description（trust/isDefault 也一并带上）；
        // 内置 id 保留中英文兜底文案，避免旧版后端只给英文 id 时界面混语言。
        name: builtInNames[preset.id] || preset.name || preset.id,
        description: builtInDescriptions[preset.id] || preset.description || '',
        trust: preset.trust,
        isDefault: preset.isDefault,
      }
    })
    this.presets = presets
    // modeSelectionEnabled：0.1.5-rc.2 起后端可关闭"未命名新会话的模式选择"。
    this.modeSelectionEnabled = result.modeSelectionEnabled !== false
    this.post({
      type: 'presets',
      presets,
      authorable: result.authorable === true,
      modeSelectionEnabled: this.modeSelectionEnabled,
    })
  }

  /**
   * 本地取消归档：dsh 0.1.5 没有 unarchive API，这里把会话从"插件视图的归档集合"
   * 中移除（宿主归档状态不变），并持久化到 globalState。
   */
  async restoreArchivedSession(sessionId) {
    if (!sessionId) return
    this.unarchivedLocally.add(sessionId)
    await this.persistUnarchived()
    this.sessions.setArchivedIgnored(this.unarchivedLocally)
    await this.refreshSessions()
  }

  /**
   * 插件视图内的"提升为普通会话 / 恢复层级"。
   *
   * dsh 侧没有对应能力：会话谱系写在创建时的 header（`parentSession`）里且不可修改，
   * RPC 面只有 create/rename/fork/prompt/…（没有 detach/promote 之类）。所以这里
   * 只改插件抽屉的层级显示（被提升的会话作为顶层行渲染），dsh Web UI 里仍是嵌套的。
   * @param sessionId - 目标会话。
   * @param promoted - true=提升为顶层行；false=恢复层级显示。
   */
  async setSessionPromoted(sessionId, promoted) {
    if (!sessionId) return
    if (promoted) this.promotedLocally.add(sessionId)
    else this.promotedLocally.delete(sessionId)
    await this.persistPromoted()
    await this.refreshSessions()
  }

  /** 一次性清空"仅插件内显示"（本地取消归档）集合——批量撤销旧版按钮留下的痕迹。 */
  async clearRestoredSessions() {
    if (this.unarchivedLocally.size === 0) return
    this.unarchivedLocally.clear()
    await this.persistUnarchived()
    this.sessions.setArchivedIgnored(this.unarchivedLocally)
    await this.refreshSessions()
    this.post({ type: 'notice', text: this.t('notice.restoredCleared') })
  }

  async persistPromoted() {
    try {
      await this.options.persistPromoted?.([...this.promotedLocally])
    } catch (error) {
      this.onLog(`保存"提升为普通会话"集合失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** `↪` 的反向操作：把"本地恢复显示"的会话重新按已归档处理（仅插件视图）。 */
  async unrestoreArchivedSession(sessionId) {
    if (!sessionId) return
    this.unarchivedLocally.delete(sessionId)
    await this.persistUnarchived()
    this.sessions.setArchivedIgnored(this.unarchivedLocally)
    await this.refreshSessions()
  }

  async persistUnarchived() {
    try {
      await this.options.persistUnarchived?.([...this.unarchivedLocally])
    } catch (error) {
      this.onLog(`保存本地归档视图失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 在系统文件管理器中定位会话工作目录（0.1.5 session/openWorkspacePath）。 */
  async openWorkspaceFolder(sessionId) {
    if (!sessionId || !this.dsh.client) return
    try {
      const can = await this.sessions.canOpenWorkspacePath()
      if (!can) {
        this.post({ type: 'notice', text: this.t('notice.pathOpenUnavailable') })
        return
      }
      const items = await this.sessions.listSessions(sessionId, true, true)
      const cwd = items.find((item) => item.sessionId === sessionId)?.cwd
      if (!cwd) {
        this.post({ type: 'notice', text: this.t('notice.pathOpenUnavailable') })
        return
      }
      await this.sessions.openWorkspacePath(cwd, 'reveal')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.post({ type: 'notice', text: this.t('notice.openPathFailed', { message }) })
    }
  }

  /** 打开用户自定义 Agent preset 目录（用于自建工作模式；端点参数是 preset id）。 */
  async openPresetDirectory() {
    if (!this.dsh.client) return
    try {
      const presets = this.presets || []
      // 内置 preset（trust:'system'）是只读的：优先打开用户可写的那个。
      const editable = presets.find((preset) => preset.trust && preset.trust !== 'system')
      const sessionId = this.selectedSessionId
      const current = sessionId && (this.projectionValue(sessionId, 'agentPreset') || this.agentPresetBySession.get(sessionId))
      const currentIsEditable = presets.some((preset) => preset.id === current && preset.trust !== 'system')
      const presetId = (currentIsEditable && current) || editable?.id || current || presets[0]?.id || 'standard'
      await this.sessions.openAgentPresetDirectory(presetId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const readOnly = /read-only|cannot be written/iu.test(message)
      this.post({ type: 'notice', text: readOnly ? this.t('notice.presetReadOnly') : this.t('notice.openPathFailed', { message }) })
    }
  }

  isGoalBannerDismissed(sessionId, goal) {
    const fingerprint = goalBannerFingerprint(goal)
    if (!fingerprint) return false
    return this.dismissedGoalBanner.get(sessionId) === fingerprint
  }

  /** 用户点掉目标横幅：记住当前目标指纹，目标更新后自动重新出现。 */
  dismissGoalBanner(sessionId) {
    if (!sessionId) return
    const fingerprint = goalBannerFingerprint(this.projectionValue(sessionId, 'goal'))
    if (fingerprint) this.dismissedGoalBanner.set(sessionId, fingerprint)
    this.postStats(sessionId)
  }

  /**
   * 裁剪"已加载窗口"：初始 follow 快照可能带回远超一屏的事件，
   * 这里按折叠后的条目数只保留最近 LOADED_ITEM_LIMIT 条（详细模式口径），
   * 被裁掉的历史保留在 dsh 侧，用户点"加载更早"时再走 `session/page` 分页取回。
   */
  trimLoadedWindow(sessionId, limit = LOADED_ITEM_LIMIT) {
    const entry = this.eventsBySession.get(sessionId)
    if (!entry || entry.events.length === 0) return
    const folded = foldEvents(entry.events, { mode: 'detailed', lang: this.language })
    if (folded.items.length <= limit) return
    const cutItem = folded.items[folded.items.length - limit]
    const cutSeq = cutItem && typeof cutItem.sourceSeq === 'number' ? cutItem.sourceSeq : null
    if (cutSeq === null) return
    entry.events = entry.events.filter((event) => event.seq >= cutSeq)
    entry.seen = new Set(entry.events.map((event) => event.seq))
    // 被裁掉的部分意味着前面还有历史：允许"加载更早"。
    this.hasMoreBySession.set(sessionId, true)
  }

  /** Sessions 抽屉的内容搜索：0.1.5 `session/search`（标题匹配仍在 webview 本地做）。 */
  async searchSessions(query) {
    const text = String(query || '').trim()
    if (!this.dsh.client || text.length < 2) {
      this.post({ type: 'sessionSearch', query: text, items: [], hasMore: false })
      return
    }
    try {
      const result = await this.sessions.searchSessions(text)
      this.post({
        type: 'sessionSearch',
        query: text,
        items: result?.items || [],
        hasMore: result?.hasMore === true,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // dsh 默认部署把全文索引配成 openAt:'never'（内容搜索是 opt-in）：
      // 这不是故障，静默降级为"仅标题本地过滤"，只在首次记录一条日志。
      const unavailable = /search is disabled|not enabled|unavailable/iu.test(message)
      if (unavailable) {
        if (!this.searchDisabledLogged) {
          this.searchDisabledLogged = true
          this.onLog(this.t('notice.searchDisabled'))
        }
      } else {
        this.onLog(this.t('notice.searchFailed', { message }))
      }
      this.post({ type: 'sessionSearch', query: text, items: [], hasMore: false, ...(unavailable ? { unavailable: true } : { error: message }) })
    }
  }

  async refreshModels(sessionId) {
    if (!sessionId || !this.dsh.client) return
    try {
      const catalog = await this.sessions.models(sessionId)
      // 0.1.5 session/modelCatalog：{default, routableProviders, groups, failures}；
      // default 只是部署默认值，会话当前选择以 modelSelection 投影为准
      // （{lastUsed, next}：next 优先，其次 lastUsed，最后才是 default）。
      const selection = this.projectionValue(sessionId, 'modelSelection')
      const current = selection?.next || selection?.lastUsed || catalog?.default || null
      const models = {
        current,
        default: catalog?.default || null,
        routable: catalog?.routableProviders || [],
        groups: catalog?.groups || [],
        failures: catalog?.failures || [],
      }
      this.post({ type: 'models', sessionId, models })
    } catch (error) {
      this.onLog(`加载模型目录失败: ${String(error)}`)
      this.post({ type: 'models', sessionId, models: { current: null, routable: null, groups: [], failures: [], error: String(error) } })
    }
  }

  async selectModel(provider, model, effort) {
    const sessionId = this.selectedSessionId
    if (!sessionId) throw new Error(this.t('notice.noSession'))
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
        // 0.1.5 的 CommandInputDescriptor 用 attachments 表示可带附件（旧版是 images）。
        acceptsImages: Boolean(c.input && (c.input.attachments || c.input.images)),
      }))
      this.post({ type: 'commands', sessionId, available: true, items: commands })
    } catch (error) {
      this.onLog(`加载命令目录失败: ${String(error)}`)
      this.post({ type: 'commands', sessionId, available: false, items: [] })
    }
  }

  async executeCommand(sessionId, line, images = []) {
    if (!sessionId || !line) return
    try {
      const execution = await this.sessions.executeCommand(sessionId, line, images)
      // 0.1.5 的 commands/execute 直接返回 {commandId, result}：
      // 失败结果在事件流之外立刻可见，无需等 command/done。
      if (execution && execution.result && execution.result.kind === 'error') {
        this.post({ type: 'notice', text: this.t('notice.commandFailed', { message: execution.result.text || '' }) })
      }
      return execution
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.onLog(`命令执行失败: ${message}`)
      this.post({ type: 'notice', text: this.t('notice.commandFailed', { message }) })
    }
  }

  // 会话内图片：按 attachmentId 取回 base64 数据，回推给 webview 渲染缩略图。
  async loadAttachment(sessionId, attachmentId) {
    if (!sessionId || !attachmentId) return
    try {
      const result = await this.sessions.attachment(sessionId, attachmentId)
      this.post({
        type: 'attachmentData',
        sessionId,
        attachmentId,
        mediaType: result.attachment?.mediaType || 'image/png',
        data: result.data || '',
      })
    } catch (error) {
      this.post({
        type: 'attachmentData',
        sessionId,
        attachmentId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async selectPermission(sessionId, preset) {
    if (!sessionId || !preset) return
    try {
      await this.sessions.executeCommand(sessionId, '/permission ' + preset)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isTerminalFence = message.includes('persistent terminal sessions')
      if (!isTerminalFence) {
        void vscode.window.showErrorMessage(this.t('notice.permissionSwitchFailed', { message }))
        return
      }
      const closeLabel = this.t('dialog.closeTerminals')
      const retryLabel = this.t('dialog.retry')
      const action = await vscode.window.showErrorMessage(
        this.t('notice.permissionSwitchFailed', { message }),
        closeLabel,
        retryLabel,
        this.t('dialog.cancel'),
      )
      if (action === closeLabel) {
        await this.closeTerminalsThenSwitch(sessionId, preset)
      } else if (action === retryLabel) {
        await this.selectPermission(sessionId, preset)
      }
    }
  }

  async closeTerminalsThenSwitch(sessionId, preset) {
    // 插件无法直接关闭 dsh 的持久终端（无对应 RPC），因此请求 Agent 调用
    // terminal_list / terminal_close 关闭全部终端，然后等待会话空闲再重试切换权限。
    await this.sessions.prompt(sessionId, this.t('notice.terminalClosePrompt'), 'queue')
    const idle = await this.waitForSessionIdle(sessionId, 120000)
    if (!idle) {
      void vscode.window.showWarningMessage(this.t('notice.permissionTerminalBusy'))
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
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (!this.dsh.client) {
      // dsh 未连接：设置面板仍可打开，只下发本地可编辑项，后端相关能力标记不可用。
      this.post({
        type: 'settingsData',
        data: {
          writable: false,
          hasDocument: false,
          connected: false,
          sessionDisplay: this.sessionDisplay,
          fontSize: this.fontSize,
          maxWidth: this.maxWidth,
          language: this.language,
          enterToSend: this.enterToSend,
          showContextUsage: this.showContextUsage,
          contextBarColor: this.contextBarColor,
          contextBarOpacity: this.contextBarOpacity,
          autoStart: this.autoStart,
          promptStashEnabled: this.promptStashEnabled,
          baseUrl: null,
          workspaces: [],
          currentWorkspaceId: null,
          currentFolderPath: folder ? folder.uri.fsPath : null,
          showArchivedSessions: this.showArchivedSessions,
          restoredCount: this.unarchivedLocally.size,
          version: extensionVersion,
        },
      })
      return
    }
    const client = this.sessions.requireClient()
    const settingsResult = await client.callArgs('settings/describe', {})
    // 工作区列表供"管理工作区"页使用；获取失败不阻断设置面板打开。
    // 会话数按"工作中+已归档"统计：工作中 = 账本中未归档、非空白占位、非子代理的会话
    // （与下拉列表可见会话一致）；已归档 = 账本中位于全局归档集合里的会话。
    let workspaces = []
    const archivedSet = new Set()
    try {
      const list = await this.sessions.listWorkspaces()
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
      this.onLog(`workspace 列表获取失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.post({
      type: 'settingsData',
      data: {
        writable: settingsResult.writable,
        hasDocument: settingsResult.hasDocument,
        connected: true,
        sessionDisplay: this.sessionDisplay,
        fontSize: this.fontSize,
        maxWidth: this.maxWidth,
        language: this.language,
        enterToSend: this.enterToSend,
        showContextUsage: this.showContextUsage,
        contextBarColor: this.contextBarColor,
        contextBarOpacity: this.contextBarOpacity,
        autoStart: this.autoStart,
        promptStashEnabled: this.promptStashEnabled,
        baseUrl: this.dsh.baseUrl || null,
        // 设置页超链接 href 直接用带 token 的地址，点击/复制都不会落进 401 页。
        webUrl: this.dsh.webUrl || null,
        workspaces,
        currentWorkspaceId: this.workspaceView?.workspaceId ?? null,
        currentFolderPath: folder ? folder.uri.fsPath : null,
        showArchivedSessions: this.showArchivedSessions,
        restoredCount: this.unarchivedLocally.size,
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
    const deleteLabel = this.t('dialog.delete')
    const answer = await vscode.window.showWarningMessage(
      this.t('dialog.workspaceDelete', { path: targetPath }),
      { modal: true },
      deleteLabel,
      this.t('dialog.cancel'),
    )
    if (answer !== deleteLabel) return
    await this.sessions.deleteWorkspace(workspaceId)
    if (this.workspaceView && this.workspaceView.workspaceId === workspaceId) {
      // 删除的是当前使用的工作区：清空映射并重新走确认流程（可重新添加）。
      this.workspaceView = null
      this.sessions.reset()
      this.selectedSessionId = null
      for (const handle of this.followStreamHandles.values()) handle?.close?.()
      this.followStreamHandles.clear()
      this.workspacePromptedPath = null
      this.workspacePromptAccepted = false
      this.post({ type: 'workspace', workspace: null })
      this.post({ type: 'sessions', sessions: [], selectedSessionId: null })
      void this.ensureWorkspaceAndSession()
    }
    await this.refreshSettings()
  }

  // 关于页的 dsh 服务地址链接 / 顶栏 ⋯ 菜单：在浏览器中打开 dsh Web UI。
  async openDshWeb() {
    // 打开前验证 token 仍有效（实例被外部重启时弹框询问新 token）；
    // 带 launch token 的完整 URL：浏览器一次 GET 即换 cookie 并进入 UI，避免 401 页。
    const authed = await this.dsh.ensureAuthToken()
    const url = this.dsh.webUrl
    if (!authed || !url) {
      void vscode.window.showErrorMessage(this.t('notice.webAuthUnavailable'))
      return
    }
    await vscode.env.openExternal(vscode.Uri.parse(url))
  }

  async openSettingsDocument() {
    // dsh 未连接时跳过 RPC（settings.yaml 可能尚未生成），直接尝试打开本地文件。
    if (this.dsh.client) {
      const client = this.sessions.requireClient()
      // 先让 dsh 侧物化 settings.yaml（缺失时创建）；即使远端没有桌面可打开，
      // 插件也会在 VS Code 中打开该文件，保证用户有可见反馈。
      try {
        await client.callArgs('settings/openSettingsDocument', {})
      } catch (error) {
        this.onLog(`dsh settings.openDocument 调用失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      this.onLog('dsh 未启动，跳过 settings.openDocument RPC，仅尝试打开本地 settings.yaml')
    }
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const settingsPath = join(dshHome, 'settings.yaml')
    if (!existsSync(settingsPath)) {
      void vscode.window.showErrorMessage(this.t('notice.settingsMissing'))
      return
    }
    const uri = vscode.Uri.file(settingsPath)
    try {
      const document = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(document)
    } catch (error) {
      void vscode.window.showErrorMessage(this.t('notice.openFileFailed', { target: settingsPath, message: error instanceof Error ? error.message : String(error) }))
    }
  }

  async setSessionDisplay(value) {
    const next = value === 'detailed' ? 'detailed' : 'concise'
    this.sessionDisplay = next
    // 写入失败不静默：让错误冒泡到 handleMessage 的统一 catch，弹窗告知用户，
    // 避免“当前会话生效、重启后恢复默认”且用户无感知。
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('sessionDisplay', next, vscode.ConfigurationTarget.Global)
    // 先按新模式重新折叠并推送会话内容，再通知 webview 切换模式，
    // 避免 webview 先切模式后仍用旧模式的会话数据渲染出错误内容。
    this.postConversation(this.selectedSessionId)
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

  async setPromptStash(value) {
    const next = value !== false
    this.promptStashEnabled = next
    const config = vscode.workspace.getConfiguration('dsh-vsc')
    await config.update('promptStash', next, vscode.ConfigurationTarget.Global)
    // 关闭时只隐藏界面，不清空内容：重新打开后暂存的提示词仍在。
    this.post({ type: 'promptStashEnabled', value: next })
  }

  /**
   * 保存 webview 上报的暂存框内容（数量不设上限，条目形如 `{id,text,images}`）。
   *
   * @param items - webview 上报的条目；`includeImages=false` 时只有 `{id,text}`，
   *   宿主按 id 合并文本、保留自己那份图片（打字防抖不再搬运 base64 图片）。
   * @param includeImages - true = 结构变化（新增框/删除框/增删图片/发送后删除），整份替换。
   */
  async updatePromptStash(items, includeImages = false) {
    const next = includeImages
      ? normalizePromptStashEntries(items)
      : mergePromptStashTexts(this.promptStashItems, items)
    if (samePromptStash(this.promptStashItems, next)) return
    this.promptStashItems = next
    try {
      await this.options.persistPromptStash?.(next)
    } catch (error) {
      this.onLog(`保存提示词暂存框失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async setShowArchivedSessions(value) {
    const next = value === true
    this.showArchivedSessions = next
    // 先让界面生效、再落配置：远程/只读设置下 `config.update` 可能失败，
    // 若把它放在前面，按钮就会表现为"点了完全没反应"（旧顺序的坑）。
    this.post({ type: 'showArchivedSessions', value: next })
    await this.refreshSessions()
    try {
      const config = vscode.workspace.getConfiguration('dsh-vsc')
      await config.update('showArchivedSessions', next, vscode.ConfigurationTarget.Global)
    } catch (error) {
      this.onLog(`保存 showArchivedSessions 失败: ${error instanceof Error ? error.message : String(error)}`)
    }
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
      this.postConversation(this.selectedSessionId)
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
    if (prefs.promptStashEnabled !== undefined && prefs.promptStashEnabled !== this.promptStashEnabled) {
      this.promptStashEnabled = prefs.promptStashEnabled
      this.post({ type: 'promptStashEnabled', value: prefs.promptStashEnabled })
    }
    if (prefs.showArchivedSessions !== undefined && prefs.showArchivedSessions !== this.showArchivedSessions) {
      this.showArchivedSessions = prefs.showArchivedSessions === true
      this.post({ type: 'showArchivedSessions', value: this.showArchivedSessions })
      void this.refreshSessions()
    }
  }

  async closeSession(sessionId) {
    if (!sessionId) return

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
    this.closeSessionFollow(sessionId)
    if (this.selectedSessionId === sessionId) this.selectedSessionId = null
    await this.refreshSessions()
    if (!this.selectedSessionId) await this.autoAttachSession()

    const notice = this.t('notice.sessionArchived')
    this.post({ type: 'notice', text: notice })
    void vscode.window.showInformationMessage(notice)
  }

  async forkSession(sessionId) {
    if (!sessionId) throw new Error(this.t('notice.noSessionSelected'))
    let child
    try {
      child = await this.sessions.forkSession(sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.isForkUnavailable(error)) {
        const notice = '当前会话无可 fork 的已完成回合'
        this.post({ type: 'forkError', message: notice })
        void vscode.window.showErrorMessage(notice)
        this.onLog(`fork 不可用: ${message}`)
        return
      }
      throw error
    }
    const childId = child && child.sessionId
    if (!childId) throw new Error(this.t('notice.forkFailed'))

    // 继承源会话标题并把 fork 时间追加到名称后，便于区分刚 fork 出的子会话。
    let sourceTitle = '会话'
    try {
      const source = await this.sessions.getSession(sessionId)
      const title = source && source.title
      if (typeof title === 'string' && title.trim()) sourceTitle = title.trim()
    } catch (error) {
      this.onLog(`读取源会话标题失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    const now = new Date()
    const pad2 = (n) => ('0' + n).slice(-2)
    const forkTime = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes())
    const forkTitle = sourceTitle + '（fork ' + forkTime + '）'
    try {
      await this.sessions.renameSession(childId, forkTitle)
    } catch (error) {
      // 重命名失败不阻塞 fork 完成，仅记录日志。
      this.onLog(`fork 后重命名新会话失败: ${error instanceof Error ? error.message : String(error)}`)
    }

    this.clearConversationPost()
    this.selectedSessionId = childId
    this.ensureStreams()
    this.openSessionFollow(childId)
    await this.refreshSessions()
    await this.loadHistory(childId)
    await this.refreshModels(childId)
    await this.refreshCommands(childId)
    this.postQueue(childId)
    this.postQuestion(childId)
    this.postApproval(childId)
    const doneNotice = this.t('notice.forkDone', { title: forkTitle })
    this.post({ type: 'forkDone', title: forkTitle })
    void vscode.window.showInformationMessage(doneNotice)
  }

  isForkUnavailable(error) {
    const message = String(error && error.message || '')
    if (error instanceof DshRpcError && error.code === 'fork-unavailable') return true
    return /fork-unavailable|no completed turn/u.test(message)
  }

  // ---- ungrouped sessions (未分组会话) ----

  async getUngroupedSessions() {
    const workspaceId = this.workspaceView?.workspaceId ?? null
    if (!workspaceId) {
      this.post({ type: 'ungroupedSessions', workspaceId: null, items: [], error: null })
      return
    }
    try {
      const { items } = await this.sessions.listUngroupedSessions(workspaceId)
      this.post({ type: 'ungroupedSessions', workspaceId, items, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.onLog(`列出未分组会话失败: ${message}`)
      this.post({ type: 'ungroupedSessions', workspaceId, items: [], error: message })
    }
  }

  async attachUngroupedSession(sessionId) {
    if (!sessionId) return
    const workspaceId = this.workspaceView?.workspaceId
    if (!workspaceId) return
    try {
      // dsh 的 session.create 对已存在会话是幂等采用：同 sessionId + workspaceId
      // 即把未分组会话纳入当前工作区（要求 cwd 与工作区路径一致）。
      await this.sessions.attachUngroupedSession(sessionId, workspaceId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.onLog(`加载未分组会话失败: ${message}`)
      this.post({ type: 'ungroupedAttachDone', sessionId, ok: false, message })
      return
    }
    let title = null
    try {
      const session = await this.sessions.getSession(sessionId)
      title = session && session.title ? session.title : null
    } catch (error) {
      this.onLog(`读取会话标题失败: ${error instanceof Error ? error.message : String(error)}`)
    }
    await this.refreshSessions()
    await this.getUngroupedSessions()
    this.post({ type: 'ungroupedAttachDone', sessionId, ok: true, title })
  }

  async attachAllUngroupedSessions() {
    const workspaceId = this.workspaceView?.workspaceId
    if (!workspaceId) return
    let items = []
    try {
      const result = await this.sessions.listUngroupedSessions(workspaceId)
      items = result.items
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.onLog(`列出未分组会话失败: ${message}`)
      this.post({ type: 'ungroupedAttachAllDone', done: 0, failed: 0, message })
      return
    }
    let done = 0
    let failed = 0
    let lastMessage = null
    for (const item of items) {
      try {
        await this.sessions.attachUngroupedSession(item.sessionId, workspaceId)
        done++
      } catch (error) {
        failed++
        lastMessage = error instanceof Error ? error.message : String(error)
        this.onLog(`加载未分组会话 ${item.sessionId} 失败: ${lastMessage}`)
      }
    }
    await this.refreshSessions()
    await this.getUngroupedSessions()
    this.post({ type: 'ungroupedAttachAllDone', done, failed, message: lastMessage })
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

  refreshSessions(userInitiated = false) {
    if (userInitiated) this.refreshUserInitiated = true
    // 并发合并：同一轮共享一次执行，避免 host 状态帧/用户刷新叠加成多次 RPC。
    if (this.refreshSessionsWork) return this.refreshSessionsWork
    this.refreshSessionsWork = this.doRefreshSessions().finally(() => {
      this.refreshSessionsWork = null
    })
    return this.refreshSessionsWork
  }

  async doRefreshSessions() {
    const userInitiated = this.refreshUserInitiated === true
    this.refreshUserInitiated = false
    if (!this.dsh.client || !this.workspaceView) {
      // dsh 未就绪/工作区未确定：保留界面上的既有列表（不要用空列表覆盖），
      // 用户主动点刷新时给出提示并顺带重新探测一次连接。
      if (userInitiated) this.post({ type: 'notice', text: this.t('notice.refreshNotReady') })
      if (this.dsh.statusValue !== 'ready' && this.dsh.statusValue !== 'starting' && this.dsh.statusValue !== 'discovering') {
        void this.dsh.start({ allowSpawn: this.autoStart !== false }).catch((error) => {
          this.onLog(`刷新时重新探测 dsh 失败: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
      return
    }
    const list = await this.sessions.listSessions(this.selectedSessionId, this.showArchivedSessions)
    this.seedProjectionsFromList(list)
    for (const item of list) {
      const running = this.sessionRunning.get(item.sessionId)
      if (running !== undefined) item.running = item.running || running
      item.archived = this.sessions.isArchived(item.sessionId)
      const title = item.projections?.values?.title
      if (!item.title && typeof title === 'string' && title) item.title = title
      // 工作模式：0.1.5 以 agentPreset 投影为准（session/list 与快照都带），
      // 插件侧记录只用于旧版后端与点击后的乐观显示。
      const preset = sessionPresetOf(item) || this.agentPresetBySession.get(item.sessionId)
      if (preset) item.agentPreset = preset
      // 与 dsh Web 端一致的显示名（title → cwd 目录名 → sessionId），
      // 避免插件列表出现"会话 1a2b3c4d"而网页显示目录名的不一致。
      item.displayTitle = sessionDisplayTitleOf(item)
      item.promotedLocally = isSubagentSession(item) && this.promotedLocally.has(item.sessionId)
      item.restoredLocally = this.unarchivedLocally.has(item.sessionId)
    }
    this.post({
      type: 'sessions',
      // 按"最近修改时间"（dsh 的 updatedAt + 插件观察到的活动时间）降序重排。
      sessions: applySessionActivity(list, this.activityTimeBySession),
      selectedSessionId: this.selectedSessionId,
      archivedAvailable: this.sessions.archivedCountInWorkspace(),
      restoredCount: this.unarchivedLocally.size,
    })
    this.postStats(this.selectedSessionId)
  }

  /**
   * 顶部刷新按钮：一次"轻量全量刷新"——会话列表 + 模型目录 + 命令目录 +
   * 工作模式 + 设置快照（不重载会话历史，避免打断阅读与流式渲染）。
   */
  async refreshAll() {
    this.post({ type: 'refreshing', value: true })
    try {
      if (!this.dsh.client) {
        this.post({ type: 'notice', text: this.t('notice.refreshNotReady') })
        if (this.dsh.statusValue !== 'starting' && this.dsh.statusValue !== 'discovering') {
          void this.dsh.start({ allowSpawn: this.autoStart !== false }).catch((error) => {
            this.onLog(`刷新时重新探测 dsh 失败: ${error instanceof Error ? error.message : String(error)}`)
          })
        }
        return
      }
      const sessionId = this.selectedSessionId
      await Promise.all([
        this.refreshSessions(true),
        this.refreshPresets(),
        this.refreshSettings(),
        sessionId ? this.refreshModels(sessionId) : Promise.resolve(),
        sessionId ? this.refreshCommands(sessionId) : Promise.resolve(),
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.onLog(`刷新失败: ${message}`)
      this.post({ type: 'notice', text: this.t('notice.refreshFailed', { message }) })
    } finally {
      this.post({ type: 'refreshing', value: false })
    }
  }

  // host 事件（session-status/added/workspace-changed/archived-changed）触发时防抖：
  // 短时间内的多次状态帧只刷一次；用户主动刷新仍走上面的 refreshSessions()。
  scheduleRefreshSessions(delayMs = 120) {
    if (this.refreshSessionsTimer) return
    this.refreshSessionsTimer = setTimeout(() => {
      this.refreshSessionsTimer = null
      void this.refreshSessions()
    }, delayMs)
    this.refreshSessionsTimer.unref?.()
  }

  seedProjectionsFromList(list) {
    for (const item of list || []) {
      if (item.projections) {
        for (const [key, value] of Object.entries(item.projections.values ?? {})) {
          this.seedProjection(item.sessionId, key, value, item.projections.asOfSeq)
        }
      }
    }
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

  statsSnapshot(sessionId) {
    if (!sessionId) return null
    const store = this.projectionsBySession.get(sessionId)
    if (!store) return null
    const get = (key) => store.get(key)?.value
    return {
      tokenUsage: get('tokenUsage'),
      sessionStats: get('sessionStats'),
      contextPressure: get('contextPressure'),
      contextBreakdown: get('contextBreakdown'),
      todos: get('todos'),
      permissions: get('permissions'),
      jobs: this.jobsBySession.get(sessionId) || [],
      // 0.1.5 投影：目标与计划模式横幅（goalDismissed 由用户点 × 后置位）。
      goal: get('goal') ?? null,
      plan: get('plan') ?? null,
      goalDismissed: this.isGoalBannerDismissed(sessionId, get('goal')),
    }
  }

  postStats(sessionId) {
    if (!sessionId) return
    this.post({ type: 'stats', sessionId, stats: this.statsSnapshot(sessionId) })
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

  /** session/control 的 jobs 帧：仅展示用，运行状态仍以 api-session/status 为准。 */
  ingestJobs(sessionId, jobs) {
    if (!sessionId) return
    this.jobsBySession.set(sessionId, Array.isArray(jobs) ? jobs : [])
    if (sessionId === this.selectedSessionId) this.postStats(sessionId)
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

  ingestQuestionRequested(sessionId, eventId, request) {
    if (!sessionId || !eventId) return
    const list = this.pendingQuestionsBySession.get(sessionId) || []
    const exists = list.some((item) => item.eventId === eventId)
    if (!exists) {
      list.push({ eventId, questions: (request && request.questions) || [] })
      this.pendingQuestionsBySession.set(sessionId, list)
    }
    if (sessionId === this.selectedSessionId) this.postQuestion(sessionId)
  }

  ingestQuestionResolved(sessionId, eventId) {
    if (!sessionId) return
    const list = this.pendingQuestionsBySession.get(sessionId)
    if (!list) return
    const next = list.filter((item) => item.eventId !== eventId)
    this.pendingQuestionsBySession.set(sessionId, next)
    if (sessionId === this.selectedSessionId) this.postQuestion(sessionId)
  }

  async answerQuestion(sessionId, eventId, answers) {
    if (!sessionId || !eventId || !Array.isArray(answers)) return
    if (!this.remoteClientId) throw new Error(this.t('notice.eventsNotReady'))
    const client = this.sessions.requireClient()
    // 0.1.5：waterfall 返回值就是 AskUserQuestionAnswer（`{answers:[{id,selected,custom?}]}`），
    // 不能再包一层 {sessionId, answer}，否则宿主拿到的回答结构不合法。
    await client.callArgs('$events/result', {
      clientId: this.remoteClientId,
      eventId,
      outcome: buildQuestionOutcome(answers),
    })
    this.ingestQuestionResolved(sessionId, eventId)
  }

  async cancelQuestion(sessionId, eventId) {
    if (!sessionId || !eventId) return
    if (!this.remoteClientId) throw new Error(this.t('notice.eventsNotReady'))
    const client = this.sessions.requireClient()
    await client.callArgs('$events/result', {
      clientId: this.remoteClientId,
      eventId,
      outcome: buildEventRejection('user cancelled the question', 'cancelled'),
    })
    this.ingestQuestionResolved(sessionId, eventId)
  }

  approvalSnapshot(sessionId) {
    const list = this.pendingApprovalsBySession.get(sessionId) || []
    return list[0] || null
  }

  postApproval(sessionId) {
    if (!sessionId) return
    this.post({ type: 'approval', sessionId, pending: this.approvalSnapshot(sessionId) })
  }

  ingestApprovalRequested(sessionId, eventId, request) {
    if (!sessionId || !eventId) return
    const list = this.pendingApprovalsBySession.get(sessionId) || []
    const exists = list.some((item) => item.eventId === eventId)
    if (!exists) {
      list.push({
        eventId,
        approvalId: request?.approvalId || request?.callId,
        toolName: request?.toolName,
        callId: request?.callId,
        reason: request?.reason,
      })
      this.pendingApprovalsBySession.set(sessionId, list)
    }
    if (sessionId === this.selectedSessionId) this.postApproval(sessionId)
  }

  ingestApprovalResolved(sessionId, eventId) {
    if (!sessionId) return
    const list = this.pendingApprovalsBySession.get(sessionId)
    if (!list) return
    const next = list.filter((item) => item.eventId !== eventId)
    this.pendingApprovalsBySession.set(sessionId, next)
    if (sessionId === this.selectedSessionId) this.postApproval(sessionId)
  }

  async answerApproval(sessionId, eventId, approvalId, outcome) {
    if (!sessionId || !eventId || !approvalId) return
    if (outcome !== 'allowed-once' && outcome !== 'rejected') return
    if (!this.remoteClientId) throw new Error(this.t('notice.eventsNotReady'))
    const client = this.sessions.requireClient()
    // 0.1.5：waterfall 返回值就是 ApprovalOutcome 字面量（allowed-once/rejected/...）。
    await client.callArgs('$events/result', {
      clientId: this.remoteClientId,
      eventId,
      outcome: buildApprovalOutcome(outcome),
    })
    this.ingestApprovalResolved(sessionId, eventId)
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

  // 打开“产物”列表中的文件（点击 chip）。
  async openFile(path) {
    if (!path) return
    try {
      const uri = vscode.Uri.file(path)
      const doc = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(doc)
    } catch (error) {
      void vscode.window.showErrorMessage(this.t('notice.openFileFailed', { target: path, message: error instanceof Error ? error.message : String(error) }))
    }
  }

  // ---- conversation state ----

  getEventsEntry(sessionId, create) {
    let entry = this.eventsBySession.get(sessionId)
    if (!entry && create) {
      entry = { seen: new Set(), events: [] }
      this.eventsBySession.set(sessionId, entry)
      this.pruneEventCache()
    }
    return entry
  }

  /**
   * 事件缓存 LRU：只保留最近访问的若干个会话，避免浏览大量会话后
   * 每个会话的完整事件数组常驻内存（重选会话时由 follow 快照重建）。
   */
  pruneEventCache(limit = EVENT_CACHE_LIMIT) {
    if (this.eventsBySession.size <= limit) return
    const keep = this.selectedSessionId
    for (const sessionId of [...this.eventsBySession.keys()]) {
      if (this.eventsBySession.size <= limit) break
      if (sessionId === keep) continue
      this.eventsBySession.delete(sessionId)
      this.hasMoreBySession.delete(sessionId)
      this.cursorBySession.delete(sessionId)
      this.sessionRunning.delete(sessionId)
    }
  }

  conversationSnapshot() {
    const sessionId = this.selectedSessionId
    if (!sessionId) return []
    const entry = this.eventsBySession.get(sessionId)
    if (!entry) return []
    const folded = foldEvents(entry.events, { mode: this.sessionDisplay, lang: this.language })
    return folded.items
  }

  isSessionRunning(sessionId) {
    if (!sessionId) return false
    if (this.sessionRunning.has(sessionId)) return this.sessionRunning.get(sessionId)
    const entry = this.eventsBySession.get(sessionId)
    if (!entry) return false
    return foldEvents(entry.events, { mode: this.sessionDisplay }).running
  }

  async loadHistory(sessionId) {
    if (!sessionId || !this.dsh.client) return
    // rc.1：初始历史由 session/follow 首帧 snapshot 种子化；这里等它落地（8s 兜底）。
    const slot = this.followSnapshotsBySession.get(sessionId)
    if (slot) {
      await Promise.race([slot.promise, new Promise((resolve) => setTimeout(resolve, 8000))])
    }
    const entry = this.getEventsEntry(sessionId, true)
    if (entry.events.length === 0) {
      // snapshot 未到位（如流失败）时，用已知 cursor 补一页；无 cursor 则跳过。
      const throughSeq = this.cursorBySession.get(sessionId)
      if (throughSeq !== undefined) {
        const history = await this.sessions.history(sessionId, undefined, throughSeq)
        for (const item of history.events) {
          const event = item.event
          if (entry.seen.has(event.seq)) continue
          entry.seen.add(event.seq)
          entry.events.push({ seq: event.seq, time: event.time, type: event.type, data: event.data })
        }
        entry.events.sort((a, b) => a.seq - b.seq)
        this.hasMoreBySession.set(sessionId, history.hasMore)
      }
    }
    this.postConversation(sessionId)
  }

  async loadEarlier(sessionId) {
    if (!sessionId || !this.dsh.client) return
    if (!(this.hasMoreBySession.get(sessionId) ?? false)) return
    const entry = this.getEventsEntry(sessionId, true)
    const oldestSeq = entry.events.length > 0 ? entry.events[0].seq : undefined
    if (oldestSeq === undefined) return
    const throughSeq = this.cursorBySession.get(sessionId)
    if (throughSeq === undefined) return
    const history = await this.sessions.history(sessionId, oldestSeq, throughSeq)
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

  ingestEvent(sessionId, event, view) {
    // 所有会话的事件都入缓存（按 seq 去重）；只有选中会话需要推送渲染。
    // 未选中会话的事件在切回时由 loadHistory 兜底，这里缓存可避免重复拉取。
    // view 是宿主在 live 流上附带的工具渲染意图（call/result），历史回放不含。
    const entry = this.getEventsEntry(sessionId, true)
    if (entry.seen.has(event.seq)) return
    entry.seen.add(event.seq)
    entry.events.push({ seq: event.seq, time: event.time, type: event.type, data: event.data, view })
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
    // 0.1.5：durable 的 assistant/message / assistant/attempt 落地即代表该 step 结算，
    // 清掉对应的实时增量副本，避免同一段文本显示两遍。
    const liveStream = this.liveStreams.get(sessionId)
    if (liveStream && liveStream.matchesSettlement(event.type, event.data)) liveStream.clear()
    if (sessionId === this.selectedSessionId) {
      if (event.type === 'turn/end') this.flushConversationPost()
      else this.scheduleConversationPost()
    }
  }

  postConversation(sessionId) {
    if (sessionId !== this.selectedSessionId) return
    // 没有界面时不折叠、不推送：打开时由 hydrate 重新折叠一份完整快照。
    if (this.webviews.size === 0) return
    const entry = this.eventsBySession.get(sessionId)
    if (!entry) return
    const live = this.liveStreams.get(sessionId)?.snapshot() ?? null
    const folded = foldEvents(entry.events, { mode: this.sessionDisplay, live, lang: this.language })
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
    // 计数器单调递增（不按数组长度取），避免"加载更早/裁剪"改变长度后 note 的 id 撞车。
    if (typeof entry.nextNoteSeq !== 'number') entry.nextNoteSeq = 1_000_000_000
    entry.events.push({ seq: entry.nextNoteSeq++, time: Date.now(), type: 'note', data: { text } })
    entry.events.sort((a, b) => a.seq - b.seq)
    this.postConversation(sessionId)
  }

  resyncSelected() {
    const sessionId = this.selectedSessionId
    if (!sessionId) return
    // 事件流重连后重拉 history 尾页；ingest 按 seq 去重，不丢不重。
    this.loadHistory(sessionId).catch((error) => this.onLog(`会话重同步失败: ${String(error)}`))
  }

  // ---- rc.1 Remote streams ----

  ensureStreams() {
    if (this.eventStreamHandle || !this.dsh.client) return
    // $events：全局 emit + waterfall（提问/审批）
    this.eventStreamHandle = this.dsh.openStream('$events', { args: {} }, {
      onItem: (value) => this.applyRemoteEventFrame(value),
      onError: (error) => this.onLog(`[events] ${error?.message ?? JSON.stringify(error)}`),
    })
    // session/control：队列/投影/jobs
    this.controlStreamHandle = this.dsh.openStream('session/control', { args: {} }, {
      onItem: (value) => this.applyControlFrame(value),
      onError: (error) => this.onLog(`[control] ${error?.message ?? JSON.stringify(error)}`),
    })
    // workspace/follow：工作区列表/归档集合
    this.openWorkspaceFollow()
  }

  openWorkspaceFollow() {
    if (!this.dsh.client) return
    this.workspaceStreamHandle = this.dsh.openStream('workspace/follow', { args: {} }, {
      onItem: (value) => this.applyWorkspaceFrame(value),
      onError: (error) => this.onLog(`[workspace] ${error?.message ?? JSON.stringify(error)}`),
    })
  }

  /**
   * workspace/follow 常开流只在打开时下发一次 baseline；
   * sessions.reset() 清空缓存后必须重开该流，服务器才会重发 baseline。
   */
  reopenWorkspaceFollow() {
    this.workspaceStreamHandle?.close?.()
    this.workspaceStreamHandle = null
    this.openWorkspaceFollow()
  }

  stopStreams() {
    this.eventStreamHandle?.close?.()
    this.controlStreamHandle?.close?.()
    this.workspaceStreamHandle?.close?.()
    this.eventStreamHandle = null
    this.controlStreamHandle = null
    this.workspaceStreamHandle = null
    for (const handle of this.followStreamHandles.values()) handle?.close?.()
    this.followStreamHandles.clear()
  }

  openSessionFollow(sessionId) {
    if (!sessionId || !this.dsh.client) return
    if (this.followStreamHandles.has(sessionId)) return
    // 只保留当前会话的 follow 长流：否则浏览过多少会话就会常驻多少条服务端流。
    for (const [otherId, handle] of [...this.followStreamHandles]) {
      if (otherId === sessionId) continue
      handle?.close?.()
      this.followStreamHandles.delete(otherId)
      this.followSnapshotsBySession.delete(otherId)
      this.cursorBySession.delete(otherId)
      this.liveStreams.delete(otherId)
    }
    let resolveSnapshot
    const snapshotPromise = new Promise((resolve) => { resolveSnapshot = resolve })
    this.followSnapshotsBySession.set(sessionId, { promise: snapshotPromise, resolve: resolveSnapshot })
    const handle = this.dsh.openStream('session/follow', {
      // assistantStream: 0.1.5 起 durable 日志不再写助手增量，运行中的输出只能
      // 通过进程内 assistant-stream 帧获得（见 applyFollowFrame）。
      args: { request: { address: { kind: 'session', sessionId }, maxMessages: 200, assistantStream: true } },
    }, {
      onItem: (value) => this.applyFollowFrame(sessionId, value),
      onError: (error) => this.onLog(`[session/${sessionId}] ${error?.message ?? JSON.stringify(error)}`),
    })
    this.followStreamHandles.set(sessionId, handle)
  }

  closeSessionFollow(sessionId) {
    const handle = this.followStreamHandles.get(sessionId)
    if (handle) {
      handle.close?.()
      this.followStreamHandles.delete(sessionId)
    }
    this.followSnapshotsBySession.delete(sessionId)
    this.cursorBySession.delete(sessionId)
    this.liveStreams.delete(sessionId)
  }

  liveStreamFor(sessionId) {
    let stream = this.liveStreams.get(sessionId)
    if (!stream) {
      stream = new LiveAssistantStream()
      this.liveStreams.set(sessionId, stream)
    }
    return stream
  }

  /**
   * 记录一个会话的"最近修改时间"（单调递增；只保留近 2000 条）。
   * @param sessionId - 目标会话。
   * @param time - 毫秒时间戳（提示词事件时间 / 状态变化时的 now / 已加载事件时间）。
   */
  noteSessionActivity(sessionId, time) {
    if (!sessionId) return
    const value = Number(time)
    if (!Number.isFinite(value) || value <= 0) return
    const current = this.activityTimeBySession.get(sessionId)
    if (current !== undefined && current >= value) return
    this.activityTimeBySession.set(sessionId, value)
    if (this.activityTimeBySession.size > 2000) {
      const oldest = [...this.activityTimeBySession.entries()].sort((a, b) => a[1] - b[1]).slice(0, 500)
      for (const [id] of oldest) this.activityTimeBySession.delete(id)
    }
  }

  applyRemoteEventFrame(frame) {
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'ready') {
      this.remoteClientId = frame.clientId
      return
    }
    if (frame.type === 'cancel') {
      const eventId = frame.eventId
      for (const [sessionId, list] of this.pendingQuestionsBySession) {
        if (list.some((item) => item.eventId === eventId)) this.ingestQuestionResolved(sessionId, eventId)
      }
      for (const [sessionId, list] of this.pendingApprovalsBySession) {
        if (list.some((item) => item.eventId === eventId)) this.ingestApprovalResolved(sessionId, eventId)
      }
      return
    }
    if (frame.type === 'waterfall') {
      const sessionId = frame.agentId
      if (frame.event === 'user-questions/request') {
        this.ingestQuestionRequested(sessionId, frame.eventId, frame.request || {})
      } else if (frame.event === 'approval/request') {
        this.ingestApprovalRequested(sessionId, frame.eventId, frame.request || {})
      }
      return
    }
    if (frame.type !== 'emit') return
    const args = Array.isArray(frame.args) ? frame.args : []
    switch (frame.event) {
      case 'api-session/status':
        this.sessionRunning.set(args[0], Boolean(args[1]))
        // 开始/结束一轮工作本身就是"会话被修改"（模型输出、工具调用都在这一轮里）。
        this.noteSessionActivity(args[0], Date.now())
        this.scheduleRefreshSessions()
        break
      case 'api-session/activity':
        // 参数是 [sessionId, event.time]（用户提示词时间）。
        this.noteSessionActivity(args[0], args[1])
        this.scheduleRefreshSessions()
        break
      case 'api-session/added':
      case 'api-session/removed':
        this.scheduleRefreshSessions()
        break
      case 'api-session/error':
        if (args[0] === this.selectedSessionId) this.appendNote(args[0], this.t('agent.error', { message: args[1] ?? '' }))
        break
      case 'commands/change':
        if (this.selectedSessionId) void this.refreshCommands(this.selectedSessionId)
        break
      case 'llm/adapters-updated':
        if (this.selectedSessionId) void this.refreshModels(this.selectedSessionId)
        break
      case 'settings/document-updated':
        void this.refreshSettings()
        break
      case 'agent-preset/selected':
        // emit 参数为 [sessionId, presetId]；记录后刷新会话，欢迎页同步选中态。
        this.agentPresetBySession.set(args[0], args[1])
        this.scheduleRefreshSessions()
        break
      default:
        break
    }
  }

  applyControlFrame(frame) {
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'baseline') {
      const value = frame.value || {}
      for (const [sessionId, items] of Object.entries(value.queues || {})) this.ingestQueue(sessionId, items)
      for (const [sessionId, jobs] of Object.entries(value.jobs || {})) this.ingestJobs(sessionId, jobs)
      for (const [sessionId, block] of Object.entries(value.projections || {})) {
        this.seedProjectionsFromBlock(sessionId, block)
      }
      if (this.selectedSessionId) this.postStats(this.selectedSessionId)
      return
    }
    if (frame.type === 'queue') {
      this.ingestQueue(frame.sessionId, frame.items)
      return
    }
    if (frame.type === 'jobs') {
      this.ingestJobs(frame.sessionId, frame.jobs)
      return
    }
    if (frame.type === 'projection') {
      this.updateProjection(frame.sessionId, frame.key, frame.value, frame.seq)
      if (frame.sessionId === this.selectedSessionId) {
        this.postStats(frame.sessionId)
        // 模型选择可能在别处（如 dsh Web UI）改变：投影变化后重取当前选择。
        if (frame.key === 'modelSelection') void this.refreshModels(frame.sessionId)
        // 工作模式投影是权威值：同步到会话列表，欢迎页选中态随帧更新。
        if (frame.key === 'agentPreset' && typeof frame.value === 'string') {
          this.agentPresetBySession.set(frame.sessionId, frame.value)
          this.scheduleRefreshSessions()
        }
      }
      return
    }
  }

  applyWorkspaceFrame(frame) {
    this.sessions.applyWorkspaceFrame(frame)
    // 增量帧到达时刷新会话列表；baseline 也刷一轮，保证首屏完整。
    this.scheduleRefreshSessions()
  }

  applyFollowFrame(sessionId, frame) {
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'snapshot') {
      const entry = this.getEventsEntry(sessionId, true)
      entry.seen = new Set()
      entry.events = []
      entry.nextNoteSeq = 1_000_000_000
      for (const record of frame.records || []) {
        for (const item of historyRecordEvent(record)) {
          const event = item.event
          if (entry.seen.has(event.seq)) continue
          entry.seen.add(event.seq)
          entry.events.push({ seq: event.seq, time: event.time, type: event.type, data: event.data })
        }
      }
      entry.events.sort((a, b) => a.seq - b.seq)
      this.trimLoadedWindow(sessionId)
      this.hasMoreBySession.set(sessionId, Boolean(frame.hasMore) || (this.hasMoreBySession.get(sessionId) ?? false))
      this.cursorBySession.set(sessionId, frame.cursor)
      if (frame.projections) this.seedProjectionsFromBlock(sessionId, frame.projections)
      // 重连时正在运行的助手输出：用快照里的 activeAttempt 紧凑记录还原 partial。
      this.liveStreamFor(sessionId).seed(frame.assistantStream)
      const snapshotSlot = this.followSnapshotsBySession.get(sessionId)
      if (snapshotSlot) {
        this.followSnapshotsBySession.delete(sessionId)
        snapshotSlot.resolve()
      }
      if (sessionId === this.selectedSessionId) this.postConversation(sessionId)
      return
    }
    if (frame.type === 'event') {
      const event = frame.event
      if (event) {
        this.ingestEvent(sessionId, event)
        // 当前会话每来一条新事件都刷新它的"最近修改时间"（长回合也能保持排在最前）。
        this.noteSessionActivity(sessionId, event.time)
      }
      return
    }
    if (frame.type === 'assistant-stream') {
      // 进程内助手增量（start/chunk/end）；不影响 durable 事件缓存，只驱动 partial 渲染。
      const changed = this.liveStreamFor(sessionId).accept(frame.frame)
      if (changed && sessionId === this.selectedSessionId) this.scheduleConversationPost()
    }
  }

  seedProjectionsFromBlock(sessionId, block) {
    if (!block) return
    for (const [key, value] of Object.entries(block.values || {})) {
      this.seedProjection(sessionId, key, value, block.asOfSeq)
    }
  }

  onMuxClose() {
    if (this.dsh.statusValue === 'ready') {
      this.ensureStreams()
      this.resyncSelected()
    }
  }
}

const { foldEvents, extractText } = require('./conversation.js')
const { historyRecordEvent, sessionPresetOf } = require('./session-service.js')
const { LiveAssistantStream } = require('./assistant-stream.js')
const { translate } = require('./i18n.js')
const {
  sessionDisplayTitleOf,
  buildQuestionOutcome,
  buildApprovalOutcome,
  buildEventRejection,
  goalBannerFingerprint,
} = require('./protocol.js')

module.exports = { ChatViewProvider, foldEvents }
