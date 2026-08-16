'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { isAtLeast, compareVersions, parseVersion } = require('../src/version.js')

test('semver prerelease comparison', () => {
  assert.equal(isAtLeast('0.1.0-rc.6', '0.1.0-rc.6'), true)
  assert.equal(isAtLeast('0.1.0-rc.7', '0.1.0-rc.6'), true)
  assert.equal(isAtLeast('0.1.0-rc.5', '0.1.0-rc.6'), false)
  assert.equal(isAtLeast('0.1.0', '0.1.0-rc.6'), true)
  assert.equal(isAtLeast('v1.2.3', '1.2.2'), true)
  assert.equal(parseVersion('garbage'), null)
})

test('numeric prerelease identifiers compare numerically', () => {
  assert.equal(compareVersions(parseVersion('1.0.0-2'), parseVersion('1.0.0-10')), -1)
})
