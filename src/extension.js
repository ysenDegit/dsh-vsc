'use strict'

const vscode = require('vscode')
const { DshService } = require('./dsh-service.js')
const { SessionService } = require('./session-service.js')
const { ChatViewProvider } = require('./chat-view.js')

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
  const language = config.get('language', 'zh')
  const autoOpenChat = config.get('autoOpenChat', true)
  const enterToSend = config.get('enterToSend', true)

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
  const provider = new ChatViewProvider(dsh, sessions, { onLog: (line) => log(line), sessionDisplay, fontSize, language, enterToSend })
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
      chatPanel.onDidDispose(() => { chatPanel = null })
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
      void ensureWorkspaceAndSession()
    }
  })

  // 工作区文件夹变化时重新映射（要求 3：当前工作目录加入 dsh 工作区）。
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      sessions.reset()
      if (dsh.statusValue === 'ready') void ensureWorkspaceAndSession()
    }),
  )

  if (autoOpenChat) {
    // 只有检测到 dsh web 已经在运行（即重启前/重启后仍存活的实例），
    // 才自动打开工作区 dsh 面板；未运行时不自动打开。
    dsh.findExistingInstance()
      .then((existing) => {
        if (!existing) return
        const autoOpenTimer = setTimeout(() => {
          void vscode.commands.executeCommand('dsh-vsc.openChatFromTitle')
        }, 1000)
        context.subscriptions.push({ dispose: () => clearTimeout(autoOpenTimer) })
      })
      .catch((error) => {
        log(`检测既有 dsh 实例失败: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

  if (autoStart) {
    dsh.start().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      log(`启动失败: ${message}`)
      void vscode.window.showErrorMessage(`dsh 启动失败: ${message}`)
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
