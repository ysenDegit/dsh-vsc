'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { isCommandLine, commandNameOf } = require('../src/commands.js')

test('recognizes complete slash command lines', () => {
  assert.equal(isCommandLine('/compact'), true)
  assert.equal(isCommandLine('/compact foo bar'), true)
  assert.equal(isCommandLine('/permission danger-full-access'), true)
  assert.equal(isCommandLine('/plan   draft the migration  '), true)
})

test('rejects non-command input', () => {
  assert.equal(isCommandLine('hello'), false)
  assert.equal(isCommandLine('/'), false)
  assert.equal(isCommandLine('/1bad'), false)
  assert.equal(isCommandLine('/Compact'), false) // 命令名必须小写开头，与 dsh parseCommand 一致
  assert.equal(isCommandLine(''), false)
  assert.equal(isCommandLine(null), false)
})

test('extracts the command name without the slash', () => {
  assert.equal(commandNameOf('/compact'), 'compact')
  assert.equal(commandNameOf('/permission danger'), 'permission')
  assert.equal(commandNameOf('/plan   draft'), 'plan')
  assert.equal(commandNameOf('hello'), '')
  assert.equal(commandNameOf('/'), '')
})
