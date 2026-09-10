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
  'script/08-prompt-stash.js',
]

// 收款码（sponsor/*.jpg，用户提供）：webview 的 CSP 只允许 data:/https: 图片，
// 也没有 asWebviewUri 通道，所以读取后以 data URI 内嵌进脚本，离线可用。
const SPONSOR_FILES = { wechat: 'wx.jpg', alipay: 'zfb.jpg' }
const SPONSOR_DIR = join(__dirname, '..', 'sponsor')

function readSponsorDataUri(file) {
  try {
    return `data:image/jpeg;base64,${readFileSync(join(SPONSOR_DIR, file)).toString('base64')}`
  } catch {
    return ''
  }
}

function sponsorImages() {
  const out = {}
  for (const [key, file] of Object.entries(SPONSOR_FILES)) out[key] = readSponsorDataUri(file)
  return out
}

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
    // 收款码内嵌在脚本最前面，webview 直接读 DSH_SPONSOR（图片缺失时为空串，界面降级提示）。
    cachedScript = `var DSH_SPONSOR = ${JSON.stringify(sponsorImages())};\n`
      + SCRIPT_FRAGMENTS.map(readPart).join('\n')
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
