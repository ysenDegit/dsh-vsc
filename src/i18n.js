'use strict'

/**
 * 宿主侧（extension host）最小的中英文案表。
 *
 * webview 侧有自己的 `t()`（`src/webview/script/01-i18n.js`），但折叠器笔记、
 * notice 文本、错误提示等由宿主生成，必须在宿主侧按 `dsh-vsc.language` 选语言，
 * 否则英文界面会混入中文。键名与 webview 字典保持一致，便于对照。
 */

const DICTIONARIES = {
  zh: {
    'notice.workspaceAddCancelled': '已取消添加工作区',
    'dialog.add': '添加',
    'dialog.cancel': '取消',
    'dialog.delete': '删除',
    'dialog.retry': '重试',
    'dialog.closeTerminals': '让 Agent 关闭终端后重试',
    'dialog.workspaceAdd': '是否将当前工作目录添加到 dsh 工作区？\n{path}',
    'dialog.workspaceDelete': '删除工作区？\n{path}\n该操作将删除该工作区及其全部会话，且不可恢复。',
    'notice.noWorkspaceSession': '没有打开的工作区，无法创建会话',
    'notice.noWorkspaceSend': '没有打开的工作区，无法发送消息',
    'notice.noSession': '请先选择或创建会话',
    'notice.noSessionSelected': '请先选择会话',
    'notice.forkFailed': 'fork 会话失败：未返回子会话 ID',
    'notice.eventsNotReady': '事件流尚未就绪，无法应答',
    'notice.webAuthUnavailable': '无法打开 dsh Web UI：认证信息不可用。',
    'notice.settingsMissing': 'dsh 尚未启动，settings.yaml 尚未生成；连接 dsh 后可再点"打开 settings.yaml"生成。',
    'notice.openFileFailed': '无法打开 {target}: {message}',
    'notice.terminalClosePrompt': '请使用 terminal_list 查看当前所有持久终端会话，并对每个会话调用 terminal_close 将其关闭。关闭完成后，请只回复"终端已关闭"。',
    'notice.presetSwitchFailed': '切换工作模式失败：{message}',
    'notice.commandFailed': '命令执行失败：{message}',
    'notice.sessionArchived': '会话已归档',
    'notice.forkDone': 'fork 完成：{title}',
    'dialog.startFailed': 'dsh 启动失败: {message}',
    'notice.pathOpenUnavailable': '当前环境无法用系统文件管理器打开路径。',
    'notice.presetReadOnly': '内置工作模式不可编辑；可在“创造模式”下创建自定义 preset。',
    'notice.refreshNotReady': 'dsh 尚未就绪：已保留当前列表，并重新检测连接。',
    'notice.restoredCleared': '已清除"仅插件内显示"的会话（dsh 归档状态未变）。',
    'notice.refreshFailed': '刷新失败：{message}',
    'notice.permissionSwitchFailed': '切换权限失败：{message}',
    'notice.permissionTerminalBusy': '等待 Agent 关闭终端超时，请稍后手动重试权限切换。',
    'notice.webNotReady': 'dsh web 尚未就绪',
    'notice.searchDisabled': 'dsh 未启用会话内容搜索（session-query openAt），抽屉搜索仅匹配标题',
    'notice.searchFailed': '会话搜索失败：{message}',
    'notice.uploadFailed': '上传附件失败：{message}',
    'notice.openPathFailed': '无法打开路径：{message}',
    'turn.end.error': '回合结束：{message}',
    'turn.end.aborted': '回合已中止',
    'turn.end.blocked': '回合阻塞',
    'turn.end.maxTokens': '达到输出上限',
    'context.injection': '上下文注入',
    'context.kind.agent-instructions': '项目指令',
    'context.kind.session-reference': '会话引用',
    'context.kind.skill-invocation': '技能调用',
    'context.kind.skill-catalog': '技能目录',
    'context.kind.plugin': '插件注入',
    'context.kind.agent-message': '子代理消息',
    'context.kind.subagent-settled': '子代理结束',
    'context.kind.team-message': '协作消息',
    'agent.error': 'Agent 错误：{message}',
  },
  en: {
    'notice.workspaceAddCancelled': 'Workspace addition cancelled',
    'dialog.add': 'Add',
    'dialog.cancel': 'Cancel',
    'dialog.delete': 'Delete',
    'dialog.retry': 'Retry',
    'dialog.closeTerminals': 'Ask the Agent to close terminals, then retry',
    'dialog.workspaceAdd': 'Add the current working directory to the dsh workspace?\n{path}',
    'dialog.workspaceDelete': 'Delete the workspace?\n{path}\nThis deletes the workspace and all of its sessions and cannot be undone.',
    'notice.noWorkspaceSession': 'No workspace is open; the session cannot be created',
    'notice.noWorkspaceSend': 'No workspace is open; the message cannot be sent',
    'notice.noSession': 'Select or create a session first',
    'notice.noSessionSelected': 'Select a session first',
    'notice.forkFailed': 'Fork failed: no child session id returned',
    'notice.eventsNotReady': 'The event stream is not ready yet; cannot answer',
    'notice.webAuthUnavailable': 'Cannot open the dsh Web UI: authentication information is unavailable.',
    'notice.settingsMissing': 'dsh is not running yet, so settings.yaml does not exist; connect to dsh and try "Open settings.yaml" again.',
    'notice.openFileFailed': 'Cannot open {target}: {message}',
    'notice.terminalClosePrompt': 'Use terminal_list to list every persistent terminal session and call terminal_close for each of them. When done, reply with only "terminals closed".',
    'notice.presetSwitchFailed': 'Failed to switch working mode: {message}',
    'notice.commandFailed': 'Command failed: {message}',
    'notice.sessionArchived': 'Session archived',
    'notice.forkDone': 'Fork complete: {title}',
    'dialog.startFailed': 'dsh failed to start: {message}',
    'notice.pathOpenUnavailable': 'This environment cannot open paths in the system file manager.',
    'notice.presetReadOnly': 'Built-in working modes are read-only; create a custom preset from the Creative mode.',
    'notice.refreshNotReady': 'dsh is not ready yet: the current list was kept and the connection is being re-detected.',
    'notice.restoredCleared': 'Cleared the "extension view only" sessions (dsh archive state untouched).',
    'notice.refreshFailed': 'Refresh failed: {message}',
    'notice.permissionSwitchFailed': 'Failed to switch permission: {message}',
    'notice.permissionTerminalBusy': 'Timed out waiting for the Agent to close its terminal; retry the permission switch later.',
    'notice.webNotReady': 'dsh web is not ready yet',
    'notice.searchDisabled': 'Session content search is disabled on this dsh deployment (session-query openAt); the drawer search matches titles only',
    'notice.searchFailed': 'Session search failed: {message}',
    'notice.uploadFailed': 'Failed to upload the attachment: {message}',
    'notice.openPathFailed': 'Cannot open the path: {message}',
    'turn.end.error': 'Turn ended: {message}',
    'turn.end.aborted': 'Turn aborted',
    'turn.end.blocked': 'Turn blocked',
    'turn.end.maxTokens': 'Output limit reached',
    'context.injection': 'Context injection',
    'context.kind.agent-instructions': 'project instructions',
    'context.kind.session-reference': 'session reference',
    'context.kind.skill-invocation': 'skill invocation',
    'context.kind.skill-catalog': 'skill catalog',
    'context.kind.plugin': 'plugin injection',
    'context.kind.agent-message': 'subagent message',
    'context.kind.subagent-settled': 'subagent settled',
    'context.kind.team-message': 'team message',
    'agent.error': 'Agent error: {message}',
  },
}

/**
 * 取一条文案并按 `{name}` 占位符插值。
 * @param language - `zh` 或 `en`（其它值按 zh 处理）。
 * @param key - 文案键。
 * @param vars - 占位符变量。
 * @returns 文案；键缺失时回退到键名本身（便于发现遗漏）。
 */
function translate(language, key, vars) {
  const table = DICTIONARIES[language === 'en' ? 'en' : 'zh']
  const template = table[key] ?? DICTIONARIES.zh[key] ?? key
  if (!vars) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/gu, (match, name) => (
    Object.hasOwn(vars, name) ? String(vars[name]) : match
  ))
}

module.exports = { translate, DICTIONARIES }
