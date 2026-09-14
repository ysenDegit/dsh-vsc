'use strict'

/**
 * 最小 `vscode` 模块替身：让依赖 vscode 的宿主模块（chat-view / extension）能在 node:test 里直接 require。
 * 用法：先 `installVscodeStub()`，再 require 目标模块；返回的控制对象可读取弹框/配置写入等副作用。
 */

function installVscodeStub(options = {}) {
  const state = {
    dialogs: [],
    warnings: [],
    inputBoxAnswers: [],
    configUpdates: [],
    configThrows: false,
    openedExternal: [],
    clipboard: [],
    workspaceFolders: options.workspaceFolders ?? [],
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
      showWarningMessage: async (message, ...actions) => { state.warnings.push([String(message), actions]); return options.warningPick },
      showInputBox: async () => state.inputBoxAnswers.shift(),
      showTextDocument: async () => ({}),
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    },
    Uri: { file: (path) => ({ fsPath: path }) },
    commands: { registerCommand: () => ({ dispose() {} }) },
    ConfigurationTarget: { Global: 1 },
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
