'use strict'

const vscode = require('vscode')
const { DshService } = require('./dsh-service.js')
const { SessionService } = require('./session-service.js')
const { ChatViewProvider } = require('./chat-view.js')

// 记录"用户关闭过工作区 dsh 面板"的 workspaceState 键：关闭面板后，
// 重启 VS Code 不再自动弹出，直到用户手动打开一次面板后清除。
const CHAT_PANEL_DISMISSED_KEY = 'dsh-vsc.chatPanelDismissed'
let deactivating = false

function activate(context) {
  const output = vscode.window.createOutputChannel('DeepSeek Harness')
  const log = (line) => output.appendLine(line)

  const config = vscode.workspace.getConfiguration('dsh-vsc')
  const minimumVersion = config.get('minDshVersion', '0.1.0-rc.6')
  const explicitPath = config.get('dshPath', null)
  const explicitUrl = config.get('dshUrl', null)
  const autoStart = config.get('autoStart', true)
  const sessionDisplay = config.get('sessionDisplay', 'concise')
  const fontSize = config.get('fontSize', 13)
  const maxWidth = config.get('maxWidth', 1000)
  const language = config.get('language', 'zh')
  const autoOpenChat = config.get('autoOpenChat', true)
  const enterToSend = config.get('enterToSend', false)
  const showContextUsage = config.get('showContextUsage', true)
  const contextBarColor = config.get('contextBarColor', 'var(--accent)')
  const contextBarOpacity = config.get('contextBarOpacity', 30)

  const dsh = new DshService({
    minimumVersion,
    explicitPath,
    explicitUrl,
    onStatus: (status, detail) => {
      log(`dsh status: ${status}${detail ? ` — ${detail}` : ''}`)
      provider.post({ type: 'serviceStatus', status, detail })
    },
    onLog: (line) => log(line),
  })

  const sessions = new SessionService(() => dsh.client)
  const provider = new ChatViewProvider(dsh, sessions, { onLog: (line) => log(line), sessionDisplay, fontSize, maxWidth, language, enterToSend, showContextUsage, contextBarColor, contextBarOpacity, autoStart, autoOpenChat })
  let chatPanel = null

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('dsh-vsc.focus', async () => {
      await vscode.commands.executeCommand('dsh-vsc.chat.focus')
    }),
    vscode.commands.registerCommand('dsh-vsc.openChatFromTitle', async () => {
      // 与 Claude Code 插件行为一致：在工作区打开 DeepSeek Harness 窗口（编辑器 Webview Panel），
      // 内容与侧边栏插件保持一致。
      // 手动打开即视为用户希望恢复自动弹出，清除“上次关闭过面板”的标记。
      await context.workspaceState.update(CHAT_PANEL_DISMISSED_KEY, false)
      if (chatPanel) {
        provider.refreshPanel(chatPanel)
        chatPanel.reveal()
        return
      }
      chatPanel = vscode.window.createWebviewPanel(
        'dsh-vsc.chatPanel',
        'DeepSeek Harness',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
      )
      chatPanel.onDidDispose(() => {
        chatPanel = null
        // 记住用户关闭了工作区面板；扩展宿主正在关闭/重载时不记录，
        // 避免“面板明明开着却被当成已关闭”。
        if (!deactivating) {
          void context.workspaceState.update(CHAT_PANEL_DISMISSED_KEY, true)
        }
      })
      provider.attachPanel(chatPanel)
    }),
    vscode.commands.registerCommand('dsh-vsc.openInBrowser', async () => {
      const url = dsh.baseUrl
      if (!url) {
        void vscode.window.showErrorMessage('dsh web 尚未就绪')
        return
      }
      await vscode.env.openExternal(vscode.Uri.parse(url))
    }),
    vscode.commands.registerCommand('dsh-vsc.newSession', async () => {
      await provider.handleMessage({ type: 'newSession' })
    }),
    vscode.commands.registerCommand('dsh-vsc.refreshSessions', async () => {
      await provider.refreshSessions()
    }),
  )

  // dsh 事件 → webview
  dsh.on('mux', (frame) => provider.applyMuxFrame(frame))
  dsh.on('host', (frame) => provider.applyHostFrame(frame))
  dsh.on('muxClose', () => provider.onMuxClose())

  // 自动打开候选：dsh web 已在运行（条件1）且上次未关闭面板（条件3）。
  // “当前目录已在 dsh 工作区中”（条件2）在 ready 后由 maybeAutoOpen 校验。
  let autoOpenCandidate = false
  let autoOpenAttempted = false

  // 条件2：当前目录必须已经在 dsh 工作区中（只查不建，不弹确认框），
  // 新窗口/新目录未加入过 dsh 工作区时不会自动弹出。
  const maybeAutoOpen = async () => {
    if (autoOpenAttempted || !autoOpenCandidate) return
    autoOpenAttempted = true
    try {
      const folder = vscode.workspace.workspaceFolders?.[0]
      if (!folder) {
        log('未打开工作区目录，本次不自动打开面板')
        return
      }
      const workspace = await sessions.findWorkspace(folder.uri.fsPath)
      if (!workspace) {
        log('当前目录不在 dsh 工作区中，本次不自动打开面板')
        return
      }
      const autoOpenTimer = setTimeout(() => {
        void vscode.commands.executeCommand('dsh-vsc.openChatFromTitle')
      }, 1000)
      context.subscriptions.push({ dispose: () => clearTimeout(autoOpenTimer) })
    } catch (error) {
      log(`自动打开前检查失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const ensureWorkspaceAndSession = async () => {
    try {
      sessions.reset()
      await provider.ensureWorkspace()
      await provider.refreshPresets()
      await provider.refreshSessions()
      await provider.autoAttachSession()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`工作区/会话初始化失败: ${message}`)
      provider.post({ type: 'notice', text: message })
    }
  }

  dsh.on('status', (status) => {
    if (status === 'ready') {
      // 先做自动打开前的“当前目录已在 dsh 工作区中”校验，再走正常的工作区/会话初始化。
      void maybeAutoOpen().then(() => ensureWorkspaceAndSession())
    }
  })

  // 工作区文件夹变化时重新映射（要求 3：当前工作目录加入 dsh 工作区）。
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      sessions.reset()
      if (dsh.statusValue === 'ready') void ensureWorkspaceAndSession()
    }),
  )

  // 配置被外部修改（VS Code 设置 UI / settings.json）时，同步 provider 与 webview，
  // 避免“插件弹窗里改的值与真实配置脱节、重启后表现不一致”。
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('dsh-vsc')) return
      const config = vscode.workspace.getConfiguration('dsh-vsc')
      provider.updatePreferences({
        sessionDisplay: config.get('sessionDisplay', 'concise'),
        fontSize: config.get('fontSize', 13),
        maxWidth: config.get('maxWidth', 1000),
        language: config.get('language', 'zh'),
        enterToSend: config.get('enterToSend', false),
        showContextUsage: config.get('showContextUsage', true),
        contextBarColor: config.get('contextBarColor', 'var(--accent)'),
        contextBarOpacity: config.get('contextBarOpacity', 30),
        autoStart: config.get('autoStart', true),
        autoOpenChat: config.get('autoOpenChat', true),
      })
    }),
  )

  if (autoOpenChat) {
    // 条件1：只有检测到 dsh web 已经在运行（即重启前/重启后仍存活的实例），
    // 才可能自动打开工作区 dsh 面板；未运行时不自动打开。
    // 条件3：若用户上次关闭过面板（workspaceState 标记），则不再自动打开，
    // 直到用户手动打开一次面板后清除标记（见 openChatFromTitle）。
    // 条件2（当前目录已在 dsh 工作区中）由 ready 后的 maybeAutoOpen 校验。
    dsh.findExistingInstance()
      .then((existing) => {
        if (!existing) return
        if (context.workspaceState.get(CHAT_PANEL_DISMISSED_KEY, false)) {
          log('工作区 dsh 面板上次被用户关闭，本次不自动打开')
          return
        }
        autoOpenCandidate = true
        // 竞态兜底：若 dsh 已在本次激活中先进入 ready，则立即补做自动打开校验。
        if (dsh.statusValue === 'ready') void maybeAutoOpen()
      })
      .catch((error) => {
        log(`检测既有 dsh 实例失败: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

  if (autoStart) {
    // 自动启动：复用已运行的 dsh web；没有则自动生成一个。
    dsh.start().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      log(`启动失败: ${message}`)
      void vscode.window.showErrorMessage(`dsh 启动失败: ${message}`)
    })
  } else {
    // 关闭自动启动：不自动生成实例，但仍复用/连接用户手动启动的 dsh web；
    // 未发现运行中的实例时保持 stopped，不弹错误。
    dsh.start({ allowSpawn: false }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      log(`复用 dsh web 失败: ${message}`)
    })
  }

  // 要求 4：VS Code 窗口关闭时退出由本插件生成的 dsh 实例。
  context.subscriptions.push({
    dispose: () => {
      deactivating = true
      void dsh.stop()
    },
  })
}

function deactivate() {
  // dsh.stop() 由 activation 的 subscription 负责。
  deactivating = true
}

module.exports = { activate, deactivate }
