'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { launcherNeedsShell } = require('../src/server.js')

test('launcherNeedsShell handles Windows shims', () => {
  assert.equal(launcherNeedsShell('D:\\nodejs\\dsh.cmd', 'win32'), true)
  assert.equal(launcherNeedsShell('D:\\nodejs\\dsh.exe', 'win32'), false)
  assert.equal(launcherNeedsShell('/usr/bin/dsh', 'linux'), false)
})
