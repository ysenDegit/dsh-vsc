'use strict'

const { accessSync, constants } = require('node:fs')
const { execFile } = require('node:child_process')
const { delimiter, join } = require('node:path')

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

/**
 * 定位 dsh 可执行文件（配置路径 → PATH → npm 全局目录 → `npx --no-install`）。
 *
 * **不再做版本探测**（用户要求：插件自动启动 dsh 后端时不再自动检测 dsh 版本）：
 * 这里只判断"文件存在且可执行"，不再跑 `dsh --version`、也不再因为版本低而拒绝启动。
 * 版本核对改到启动之后由 `DshService.verifyVersion()` 在后台进行，不满足要求时提醒升级。
 */
async function discoverDsh(options = {}) {
  const explicit = options.explicitPath?.trim()
  return (explicit ? fromConfig(explicit) : null)
    ?? fromPath()
    ?? (await fromNpmPrefix())
    ?? fromNpx()
}

module.exports = { discoverDsh, probeVersion, candidateNames, isExecutable }
