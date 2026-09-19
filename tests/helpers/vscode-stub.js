'use strict'

/**
 * 最小 `vscode` 模块替身：让依赖 vscode 的宿主模块（chat-view / extension）能在 node:test 里直接 require。
 * 用法：先 `installVscodeStub()`，再 require 目标模块；返回的控制对象可读取弹框/配置写入等副作用。
 */

function installVscodeStub(options = {}) {
  const state = {
    focused: true,
    dialogs: [],
    warnings: [],
    /** 下一次 showWarningMessage 返回哪个按钮（测试可随时改；安装时的 options.warningPick 作为初值）。 */
    warningPick: options.warningPick,
    executedCommands: [],
    inputBoxAnswers: [],
    configUpdates: [],
    configThrows: false,
    openedExternal: [],
    clipboard: [],
    workspaceFolders: options.workspaceFolders ?? [],
    /** 创建过的状态栏项（chat-view 的状态栏入口用；记录 text/tooltip/command 与显隐）。 */
    statusBarItems: [],
  }

  const vscode = {
    workspace: {
      getConfiguration: () => ({
        get: (key, fallback) => (key in (options.config || {}) ? options.config[key] : fallback),
        update: async (key, value) => {
          if (state.configThrows) throw new Error('settings.json is read-only')
          state.configUpdates.push([key, value])
        },
      }),
      workspaceFolders: state.workspaceFolders,
      onDidChangeConfiguration: () => ({ dispose() {} }),
      openTextDocument: async () => ({}),
    },
    window: {
      showErrorMessage: async (message) => { state.dialogs.push(String(message)); return undefined },
      showWarningMessage: async (message, ...actions) => { state.warnings.push([String(message), actions]); return state.warningPick },
      showInputBox: async () => state.inputBoxAnswers.shift(),
      showTextDocument: async () => ({}),
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      createStatusBarItem: (alignment, priority) => {
        const item = {
          alignment,
          priority,
          text: '',
          tooltip: '',
          command: undefined,
          visible: false,
          disposed: false,
          show() { this.visible = true },
          hide() { this.visible = false },
          dispose() { this.disposed = true; this.visible = false },
        }
        state.statusBarItems.push(item)
        return item
      },
      // 通知的"窗口是否在前台"判定（`unfocused` 模式依赖它）；测试可改 state.focused。
      state: { get focused() { return state.focused }, set focused(value) { state.focused = value } },
    },
    Uri: { file: (path) => ({ fsPath: path }) },
    commands: {
      registerCommand: () => ({ dispose() {} }),
      executeCommand: async (command, ...args) => { state.executedCommands.push([command, ...args]) },
    },
    ConfigurationTarget: { Global: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    env: { openExternal: async (uri) => { state.openedExternal.push(uri) }, clipboard: { writeText: async (text) => { state.clipboard.push(text) } } },
    ViewColumn: { Active: 1 },
  }

  const original = require('module')._resolveFilename
  require('module')._resolveFilename = function (request, ...rest) {
    if (request === 'vscode') return 'vscode-stub'
    return original.call(this, request, ...rest)
  }
  require.cache['vscode-stub'] = { id: 'vscode-stub', filename: 'vscode-stub', loaded: true, exports: vscode }
  return state
}

module.exports = { installVscodeStub }
