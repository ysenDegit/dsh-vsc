'use strict'

const { accessSync, constants } = require('node:fs')
const { execFile } = require('node:child_process')
const { delimiter, join } = require('node:path')
const { isAtLeast } = require('./version.js')

function candidateNames() {
  if (process.platform === 'win32') return ['dsh.cmd', 'dsh.exe', 'dsh.ps1', 'dsh']
  return ['dsh']
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function probeVersion(command, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = execFile(
      command,
      [...args, '--version'],
      { timeout: timeoutMs, windowsHide: true, shell: process.platform === 'win32' },
      (error, stdout) => {
        if (error) finish(null)
        else finish(stdout.trim() || null)
      },
    )
    child.on('error', () => finish(null))
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve(null)
    }, timeoutMs + 500)
    timer.unref()
  })
}

function fromConfig(explicit) {
  if (isExecutable(explicit)) return { command: explicit, args: [], source: 'config' }
  return null
}

function fromPath() {
  const pathVar = process.env.PATH
  if (!pathVar) return null
  const names = candidateNames()
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (isExecutable(candidate)) return { command: candidate, args: [], source: 'path' }
    }
  }
  return null
}

function fromNpmPrefix() {
  return new Promise((resolve) => {
    execFile('npm', ['prefix', '-g'], { timeout: 10000, windowsHide: true }, (error, stdout) => {
      if (error) { resolve(null); return }
      const prefix = stdout.trim()
      if (!prefix) { resolve(null); return }
      const binDir = process.platform === 'win32' ? prefix : join(prefix, 'bin')
      for (const name of candidateNames()) {
        const candidate = join(binDir, name)
        if (isExecutable(candidate)) { resolve({ command: candidate, args: [], source: 'npm-prefix' }); return }
      }
      resolve(null)
    })
  })
}

function fromNpx() {
  return { command: 'npx', args: ['--no-install', '@deepseek-ai/dsh'], source: 'npx' }
}

async function discoverDsh(options) {
  const explicit = options.explicitPath?.trim()
  const launcher = (explicit ? fromConfig(explicit) : null)
    ?? fromPath()
    ?? (await fromNpmPrefix())
    ?? fromNpx()

  const version = await probeVersion(launcher.command, launcher.args)
  if (version === null) {
    if (launcher.source === 'config') {
      throw new Error(`配置的 dsh 路径不可执行或无法运行: ${explicit}`)
    }
    if (launcher.source === 'npx') {
      throw new Error(
        '未找到 dsh：PATH、npm 全局目录均无 dsh，且 `npx --no-install @deepseek-ai/dsh` 不可用。'
        + ' 请先安装：`npm install -g @deepseek-ai/dsh`，或在设置 dsh-vsc.dshPath 中指定路径。',
      )
    }
    throw new Error(`找到 dsh (${launcher.command}) 但无法执行 --version 探测。`)
  }

  if (!isAtLeast(version, options.minimumVersion)) {
    throw new Error(`dsh 版本过低: ${version} < 要求的 ${options.minimumVersion}。请升级: npm install -g @deepseek-ai/dsh@latest`)
  }

  return { ...launcher, version }
}

module.exports = { discoverDsh, probeVersion, candidateNames, isExecutable }
