'use strict'

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

// webview 不再是一整块模板字符串：HTML/CSS 与内联脚本按功能模块拆到
// src/webview/ 下，这里按固定顺序拼装，保持零构建、纯 CommonJS。
const PARTS_DIR = join(__dirname, 'webview')
const SCRIPT_FRAGMENTS = [
  'script/00-boot.js',
  'script/01-i18n.js',
  'script/02-markdown.js',
  'script/03-render.js',
  'script/04-actions.js',
  'script/05-settings.js',
  'script/06-listeners.js',
  'script/07-message.js',
]

let cachedCss = null
let cachedBody = null
let cachedScript = null

function readPart(rel) {
  return readFileSync(join(PARTS_DIR, rel), 'utf8')
}

function getWebviewHtml(nonce) {
  if (cachedCss === null) {
    cachedCss = readPart('style.css')
    cachedBody = readPart('body.html')
    cachedScript = SCRIPT_FRAGMENTS.map(readPart).join('\n')
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; script-src 'nonce-${nonce}';">
  <title>DeepSeek Harness Chat</title>
  <style>
${cachedCss}
  </style>
</head>
<body>
${cachedBody}

  <script nonce="${nonce}">
  (function () {
${cachedScript}
  })();
  </script>
</body>
</html>`
}

module.exports = { getWebviewHtml }
