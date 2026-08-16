'use strict'

const { spawn } = require('node:child_process')

const URL_LINE_RE = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/u
const BOOT_TIMEOUT_MS = 60_000
const GRACE_MS = 5_000

function launcherNeedsShell(command, platform = process.platform) {
  return platform === 'win32' && !/\.exe$/iu.test(command)
}

/**
 * Spawn `dsh web --port 0` and resolve once the ready URL line is observed.
 */
function startDshWeb(options) {
  const {
    launcher,
    extraArgs = [],
    env = process.env,
    onStdout,
    onStderr,
    bootTimeoutMs = BOOT_TIMEOUT_MS,
  } = options

  return new Promise((resolve, reject) => {
    const args = [...launcher.args, 'web', '--port', '0', ...extraArgs]
    const useShell = launcherNeedsShell(launcher.command)
    const childEnv = { ...(env || process.env) }
    // dsh web 的依赖（parseurl 等）可能触发 Node 的 url.parse() 弃用告警；
    // 这是 dsh 侧噪音，插件侧替用户默认静默，除非用户显式设置了 NODE_NO_WARNINGS。
    if (childEnv.NODE_NO_WARNINGS === undefined) childEnv.NODE_NO_WARNINGS = '1'
    const child = spawn(launcher.command, args, {
      env: childEnv,
      shell: useShell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdoutBuf = ''
    let stderrBuf = ''
    let settled = false

    const bootTimer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(new Error(
        `dsh web 启动超时 (${String(bootTimeoutMs)}ms)\nstdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`,
      ))
    }, bootTimeoutMs)
    bootTimer.unref()

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdoutBuf += chunk
      onStdout?.(chunk)
      if (!settled) {
        const match = URL_LINE_RE.exec(stdoutBuf)
        if (match?.[1]) {
          settled = true
          clearTimeout(bootTimer)
          const baseUrl = match[1]
          const port = Number(new URL(baseUrl).port)
          resolve(makeServer(child, baseUrl, port, stderrBuf))
        }
      }
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => {
      stderrBuf += chunk
      onStderr?.(chunk)
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(bootTimer)
      reject(new Error(`dsh web 进程启动失败: ${error.message}`))
    })

    child.on('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(bootTimer)
      reject(new Error(
        `dsh web 在就绪前退出 (code=${String(code)}, signal=${signal ?? 'none'})\nstdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`,
      ))
    })
  })
}

function makeServer(child, baseUrl, port, stderrBuf) {
  let stopping = false
  let stoppedResolve
  const stopped = new Promise((resolve) => { stoppedResolve = resolve })

  child.on('exit', (code) => stoppedResolve?.(code))

  return {
    baseUrl,
    port,
    child,
    stderrBuf,
    exited: stopped,
    async stop() {
      if (stopping) return await stopped
      stopping = true
      if (child.exitCode !== null || child.signalCode !== null) {
        stoppedResolve?.(child.exitCode)
        return await stopped
      }
      child.kill('SIGTERM')
      const grace = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, GRACE_MS)
      grace.unref()
      const code = await stopped
      clearTimeout(grace)
      return code
    },
  }
}

module.exports = { startDshWeb, launcherNeedsShell }
