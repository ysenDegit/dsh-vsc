'use strict'

const vscode = require('vscode')
const { DshService } = require('./dsh-service.js')
const { SessionService } = require('./session-service.js')
const { ChatViewProvider } = require('./chat-view.js')
const { translate } = require('./i18n.js')
const { PromptStashStore, migrateLegacyPromptStash, STASH_FILE_NAME } = require('./prompt-stash-store.js')

/** 本地"取消归档/隐藏归档"集合的 globalState 键（dsh 无 unarchive API，仅插件视图）。 */
const UNARCHIVED_KEY = 'dsh-vsc.unarchivedSessions'
/** 旧版（≤1.1.4）"全局共享"的提示词暂存框内容：仅用于一次性迁移。 */
const PROMPT_STASH_LEGACY_KEY = 'dsh-vsc.promptStash'
/** 迁移标记：迁移只做一次，否则每个新工作区都会凭空继承同一份暂存内容。 */
const PROMPT_STASH_MIGRATED_KEY = 'dsh-vsc.promptStashScoped'

/**
 * 提示词暂存框的存储位置：**按工作区隔离**。
 *
 * `context.storageUri` 是 VS Code 按工作区分配的存储目录（同一工作区的多个窗口指向同一个
 * 目录，不同工作区互不相通）；没有打开文件夹时它是 undefined，退化到全局存储目录
 * （此时所有"空窗口"共享一份，与旧行为一致）。
 */
function promptStashFilePath(context) {
  const base = context.storageUri || context.globalStorageUri
  if (!base) return null
  return vscode.Uri.joinPath(base, STASH_FILE_NAME).fsPath
}


function activate(context) {
  const output = vscode.window.createOutputChannel('DeepSeek Harness')
  const log = (line) => output.appendLine(line)

  const config = vscode.workspace.getConfiguration('dsh-vsc')
  const minimumVersion = config.get('minDshVersion', '0.1.5-rc.1')
  const explicitPath = config.get('dshPath', null)
  const explicitUrl = config.get('dshUrl', null)
  const autoStart = config.get('autoStart', true)
  const sessionDisplay = config.get('sessionDisplay', 'concise')
  const fontSize = config.get('fontSize', 13)
  const maxWidth = config.get('maxWidth', 1000)
  const language = config.get('language', 'zh')
  const showArchivedSessions = config.get('showArchivedSessions', false)
  const enterToSend = config.get('enterToSend', false)
  const showContextUsage = config.get('showContextUsage', true)
  const contextBarColor = config.get('contextBarColor', 'var(--accent)')
  const contextBarOpacity = config.get('contextBarOpacity', 30)
  const promptStash = config.get('promptStash', true)

  const dsh = new DshService({
    minimumVersion,
    explicitPath,
    explicitUrl,
    onStatus: (status, detail) => {
      log(`dsh status: ${status}${detail ? ` — ${detail}` : ''}`)
      provider.post({ type: 'serviceStatus', status, detail })
    },
    onLog: (line) => log(line),
    // 自动启动不再用版本检测拦截（见 discovery.js）；启动后核对发现低于要求时提醒升级。
    onVersionOutdated: async ({ current, minimum }) => {
      const upgrade = 'npm install -g @deepseek-ai/dsh@latest'
      const action = translate(language, 'dialog.upgradeDshAction')
      const picked = await vscode.window.showWarningMessage(
        translate(language, 'dialog.dshOutdated', { current, minimum }),
        action,
      )
      if (picked === action) await vscode.env.clipboard.writeText(upgrade)
    },
    onAuthRequired: async (baseUrl) => {
      log(`检测到 ${baseUrl} 上已有 dsh 服务但需要认证，等待用户提供带 token 的 URL`)
      const answer = await vscode.window.showInputBox({
        prompt: translate(language, 'dialog.tokenPrompt', { url: baseUrl }),
        placeHolder: 'http://127.0.0.1:3080/?token=...',
        ignoreFocusOut: true,
      })
      const supplied = (answer || '').trim()
      return supplied || null
    },
  })

  const sessions = new SessionService(() => dsh.client)
  // 提示词暂存框：按工作区落盘 + 监听文件变化（同一工作区的多个窗口实时同步，
  // 且不会互相覆盖——旧版存 globalState 时"每窗口一份内存副本、后写覆盖先写"）。
  const promptStashStore = new PromptStashStore({
    filePath: promptStashFilePath(context),
    scope: context.storageUri ? 'workspace' : 'global',
    onLog: log,
  })
  migrateLegacyPromptStash({
    store: promptStashStore,
    globalState: context.globalState,
    legacyKey: PROMPT_STASH_LEGACY_KEY,
    migratedKey: PROMPT_STASH_MIGRATED_KEY,
    log,
  })
  const provider = new ChatViewProvider(dsh, sessions, {
    onLog: (line) => log(line),
    sessionDisplay,
    fontSize,
    maxWidth,
    language,
    enterToSend,
    showContextUsage,
    contextBarColor,
    contextBarOpacity,
    autoStart,
    showArchivedSessions,
    promptStashEnabled: promptStash,
    // 本地取消归档：持久化在 VS Code globalState（跨窗口/跨重启保留）。
    loadUnarchived: () => context.globalState.get(UNARCHIVED_KEY, []),
    persistUnarchived: (ids) => context.globalState.update(UNARCHIVED_KEY, ids),
    // 悬浮提示词暂存框：内容按工作区落在存储目录的 prompt-stash.json（见 PromptStashStore）。
    loadPromptStash: () => promptStashStore.load(),
    persistPromptStash: (items) => promptStashStore.save(items),
  })
  let chatPanel = null

  // 别的窗口改了暂存文件 → 更新本窗口界面（同一工作区的多窗口实时一致，且不再互相覆盖）。
  promptStashStore.watch((items) => provider.applyExternalPromptStash(items))
  context.subscriptions.push({ dispose: () => promptStashStore.dispose() })

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
      // 内容与侧边栏插件保持一致（唯一的面板打开入口，插件不再自动打开）。
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
      })
      provider.attachPanel(chatPanel)
    }),
    vscode.commands.registerCommand('dsh-vsc.openInBrowser', async () => {
      // 打开前验证 token 仍有效（实例被外部重启时弹框询问新 token）；
      // 带 launch token 的完整 URL：浏览器一次 GET 即换 cookie 并进入 UI，避免 401 页。
      const authed = await dsh.ensureAuthToken()
      const url = dsh.webUrl
      if (!authed || !url) {
        void vscode.window.showErrorMessage('无法打开 dsh Web UI：认证信息不可用。')
        return
      }
      await vscode.env.openExternal(vscode.Uri.parse(url))
    }),
    vscode.commands.registerCommand('dsh-vsc.newSession', async () => {
      await provider.handleMessage({ type: 'newSession' })
    }),
    vscode.commands.registerCommand('dsh-vsc.refreshSessions', async () => {
      // 与顶栏刷新按钮一致：会话列表 + 模型/命令目录 + 工作模式 + 设置快照。
      await provider.refreshAll()
    }),
  )

  // rc.1：remote.mux 连接状态 → webview 重同步
  dsh.on('muxClose', () => provider.onMuxClose())

  dsh.on('status', (status) => {
    if (status === 'ready') {
      // rc.1：先建立 $events / session.control / workspace.follow 长流。
      provider.ensureStreams()
      // 工作区确认框仅在用户打开插件界面后弹出，见 ChatViewProvider.ensureWorkspace。
      void provider.ensureWorkspaceAndSession()
    }
  })

  // 工作区文件夹变化时重新映射（要求 3：当前工作目录加入 dsh 工作区）。
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      sessions.reset()
      if (dsh.statusValue === 'ready') void provider.ensureWorkspaceAndSession()
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
        showArchivedSessions: config.get('showArchivedSessions', false),
        promptStashEnabled: config.get('promptStash', true),
      })
    }),
  )

  if (autoStart) {
    // 自动启动：复用已运行的 dsh web；没有则自动生成一个。
    dsh.start().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      log(`启动失败: ${message}`)
      void vscode.window.showErrorMessage(translate(language, 'dialog.startFailed', { message }))
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
      void dsh.stop()
    },
  })
}

function deactivate() {
  // dsh.stop() 由 activation 的 subscription 负责。
}

module.exports = { activate, deactivate }
