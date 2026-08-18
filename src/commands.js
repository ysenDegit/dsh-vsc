'use strict'

/**
 * 斜杠命令行的解析辅助（与 dsh 命令注册表 parseCommand 的判定一致）：
 * 以 `/` 开头、紧跟小写字母开头的命令名，之后必须是行尾或空白。
 * 这类输入在发送时应优先路由到 commands/execute，而不是 session.prompt。
 */

const COMMAND_LINE_RE = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u

/** @returns 输入是否为一条完整的斜杠命令行。 */
function isCommandLine(line) {
  return COMMAND_LINE_RE.test(String(line ?? '').trim())
}

/** @returns 命令名（不含斜杠，小写）；不是命令时返回空串。 */
function commandNameOf(line) {
  const trimmed = String(line ?? '').trim()
  if (!COMMAND_LINE_RE.test(trimmed)) return ''
  const ws = trimmed.search(/\s/u)
  return (ws === -1 ? trimmed : trimmed.slice(0, ws)).slice(1).toLowerCase()
}

module.exports = { isCommandLine, commandNameOf, COMMAND_LINE_RE }
