'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { getWebviewHtml } = require('../src/webview.js')

// webview.js 整体是一个模板字符串：node --check 只能校验外层模板，
// 无法发现生成后的内层脚本语法错误。这里把内层 <script> 抽出来用 vm 编译，
// 防止再次出现"内层脚本报错导致 webview 永不 ready"的回归（如 1.0.4 的 `\'` 转义问题）。
test('generated webview script compiles', () => {
  const html = getWebviewHtml('test-nonce')
  const match = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  assert.ok(match, 'webview html 应包含一个 <script> 块')
  const script = match[1]
  assert.ok(script.length > 1000, '内层脚本不应为空')
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'webview-inner.js' }), '内层脚本必须可编译')
})
