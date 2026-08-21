'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { launcherNeedsShell, webArgs } = require('../src/server.js')

test('launcherNeedsShell handles Windows shims', () => {
  assert.equal(launcherNeedsShell('D:\\nodejs\\dsh.cmd', 'win32'), true)
  assert.equal(launcherNeedsShell('D:\\nodejs\\dsh.exe', 'win32'), false)
  assert.equal(launcherNeedsShell('/usr/bin/dsh', 'linux'), false)
})

test('webArgs always appends --no-open to prevent the browser from opening', () => {
  // 常规发现路径：command=可执行文件，无前缀参数
  assert.deepEqual(webArgs({ args: [] }), ['web', '--port', '0', '--no-open'])
  // npx 启动器：launcher.args 带前缀，web 参数紧随其后
  assert.deepEqual(
    webArgs({ args: ['--no-install', '@deepseek-ai/dsh'] }),
    ['--no-install', '@deepseek-ai/dsh', 'web', '--port', '0', '--no-open'],
  )
})

test('webArgs places --no-open last so extraArgs cannot override it', () => {
  assert.deepEqual(
    webArgs({ args: [] }, ['--open']),
    ['web', '--port', '0', '--open', '--no-open'],
  )
})
