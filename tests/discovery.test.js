'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { mkdtempSync, writeFileSync, chmodSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { discoverDsh, probeVersion } = require('../src/discovery.js')

/** 造一个假 dsh：执行时留下"跑过了"的标记文件，并回显指定版本。 */
function makeFakeDsh(version) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-discovery-'))
  const marker = join(dir, 'ran')
  const script = join(dir, 'dsh')
  writeFileSync(script, `#!/bin/sh\ntouch "${marker}"\necho "${version}"\n`)
  chmodSync(script, 0o755)
  return { script, marker }
}

test('discoverDsh locates the configured dsh without probing --version', async () => {
  const { script, marker } = makeFakeDsh('0.1.5-rc.1')
  const launcher = await discoverDsh({ explicitPath: script })
  assert.equal(launcher.command, script)
  assert.equal(launcher.source, 'config')
  assert.equal(launcher.version, undefined, '启动路径不再带版本（用户要求不再自动检测）')
  assert.equal(existsSync(marker), false, '定位阶段不应执行 dsh（不再跑 --version）')
})

test('discoverDsh freezes the exact options shape (no minimumVersion input)', async () => {
  const { script, marker } = makeFakeDsh('9.9.9')
  // 传旧的 minimumVersion 也不应触发版本拦截，更不应执行 dsh。
  const launcher = await discoverDsh({ explicitPath: script, minimumVersion: '99.0.0' })
  assert.equal(launcher.command, script)
  assert.equal(existsSync(marker), false)
})

test('probeVersion is still available for the post-start version check', async () => {
  const { script, marker } = makeFakeDsh('0.1.4')
  assert.equal(await probeVersion(script, []), '0.1.4')
  assert.equal(existsSync(marker), true, 'probeVersion 才真正执行 dsh --version')
})
