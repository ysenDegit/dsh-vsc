'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { DICTIONARIES, translate } = require('../src/i18n.js')

test('host zh/en dictionaries declare exactly the same keys', () => {
  assert.deepEqual(Object.keys(DICTIONARIES.zh).sort(), Object.keys(DICTIONARIES.en).sort())
})

test('host translate interpolates and falls back to the key', () => {
  assert.equal(translate('zh', 'notice.presetSwitchFailed', { message: 'x' }), '切换工作模式失败：x')
  assert.equal(translate('en', 'notice.presetSwitchFailed', { message: 'x' }), 'Failed to switch working mode: x')
  assert.equal(translate('en', 'dialog.retry'), 'Retry')
  assert.equal(translate('zh', 'missing.key'), 'missing.key')
  // 未知语言按中文处理。
  assert.equal(translate('fr', 'dialog.retry'), '重试')
})

test('webview zh/en dictionaries declare the same keys', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/webview/script/01-i18n.js'), 'utf8')
  const I18N = vm.runInNewContext(`${source}\nI18N`)
  const zhKeys = Object.keys(I18N.zh).sort()
  const enKeys = Object.keys(I18N.en).sort()
  assert.deepEqual(zhKeys.filter((key) => !(key in I18N.en)), [])
  assert.deepEqual(enKeys.filter((key) => !(key in I18N.zh)), [])
})
