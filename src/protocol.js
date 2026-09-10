'use strict'

/**
 * 与 dsh 协议/展示规则相关的纯函数。
 *
 * 这里集中存放"必须与 dsh Web 端保持一致"的编码规则与可以脱离 vscode
 * 运行的对象构造，便于单元测试（chat-view 本身依赖 vscode 模块，无法直接测）。
 */

/** 去掉尾部路径分隔符后取最后一段（等价 dsh 的 workspaceTitleOf）。 */
function workspaceTitleOf(path) {
  const trimmed = String(path || '').replace(/[/\\]+$/u, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1)
}

/**
 * 会话在列表/标题上的显示名，规则与 dsh Web 端一致：
 * `title` 投影 → cwd 目录名 → 原始 session id；空白会话由调用方本地化（如"新会话"）。
 * @param session - session/list 条目（含 projections.values.title / cwd / sessionId）。
 * @returns 显示名；空白会话返回空字符串（由 UI 决定本地化文案）。
 */
function sessionDisplayTitleOf(session) {
  if (!session || typeof session !== 'object') return ''
  const title = typeof session.title === 'string' && session.title
    ? session.title
    : session.projections?.values?.title
  if (typeof title === 'string' && title) return title
  if (session.blank) return ''
  const base = workspaceTitleOf(session.cwd)
  if (base) return base
  return typeof session.sessionId === 'string' ? session.sessionId : ''
}

/** 问题应答的 `$events/result` outcome（value 即 AskUserQuestionAnswer）。 */
function buildQuestionOutcome(answers) {
  return { kind: 'result', value: { answers } }
}

/** 审批应答的 `$events/result` outcome（value 即 ApprovalOutcome 字面量）。 */
function buildApprovalOutcome(outcome) {
  return { kind: 'result', value: outcome }
}

/** 拒绝一个 waterfall 的 `$events/result` outcome。 */
function buildEventRejection(message, code) {
  return { kind: 'rejected', error: { name: 'Error', message, code, details: {} } }
}

/**
 * 目标横幅指纹：目标内容/阶段/轮次/阻塞原因任一变化都算"更新"，
 * 用于"用户点 × 关闭后，目标更新时自动重新显示"。
 * @param goal - `goal` 投影（`{goal:{objective,phase,blockedReason?},roundsStarted}`）。
 * @returns 指纹字符串；没有目标时返回 null。
 */
function goalBannerFingerprint(goal) {
  const snapshot = goal && typeof goal === 'object' ? goal.goal : null
  if (!snapshot) return null
  return [
    String(snapshot.objective || ''),
    String(snapshot.phase || ''),
    String(goal.roundsStarted ?? ''),
    snapshot.blockedReason ? JSON.stringify(snapshot.blockedReason) : '',
  ].join('|')
}

/** 子代理会话（列表默认过滤，0.1.5 起可嵌套展示）。 */
function isSubagentSession(session) {
  return Boolean(session) && session.origin === 'subagent'
}

/** 单个暂存框保存的文本上限（防御手改 globalState / 异常大的输入）；暂存框数量不设上限。 */
const PROMPT_STASH_TEXT_LIMIT = 20000

/** 暂存框里的图片附件（与 composer 的 `{mediaType,data,name}` 同形状，base64）。 */
function normalizePromptStashImages(images) {
  if (!Array.isArray(images)) return []
  const out = []
  for (const image of images) {
    if (!image || typeof image !== 'object') continue
    if (typeof image.data !== 'string' || !image.data) continue
    if (typeof image.mediaType !== 'string' || !image.mediaType) continue
    out.push({
      mediaType: image.mediaType,
      data: image.data,
      name: typeof image.name === 'string' ? image.name : '',
    })
  }
  return out
}

/**
 * 规整提示词暂存框条目：`{ id, text, images }`（**数量不设上限**，单条文本超长截断）。
 * 兼容旧版纯字符串条目（0.1.5 早期只存文本）——字符串会被升级成空 id 的条目，
 * 由 webview 补齐 id 后回写。空文本保留（="已创建但还没写内容的暂存槽"，
 * 过滤掉会让空框在重载后消失）。
 */
function normalizePromptStashEntries(items) {
  if (!Array.isArray(items)) return []
  return items.map((item) => {
    if (item === null || item === undefined || typeof item !== 'object') {
      const text = item === null || item === undefined ? '' : String(item)
      return { id: '', text: text.slice(0, PROMPT_STASH_TEXT_LIMIT), images: [] }
    }
    const text = item.text === null || item.text === undefined ? '' : String(item.text)
    return {
      id: typeof item.id === 'string' ? item.id : '',
      text: text.slice(0, PROMPT_STASH_TEXT_LIMIT),
      images: normalizePromptStashImages(item.images),
    }
  })
}

/**
 * 只更新文本（webview 在暂存框里打字时防抖上报的轻量消息，**不带图片数据**）：
 * 按 id 把新文本合并进宿主侧条目，图片保持宿主里已有的那份，避免每次停顿都把
 * base64 图片在 webview↔宿主之间来回搬。webview 每次上报完整 id 列表（顺序即显示顺序），
 * 因此未出现在 updates 里的条目视为已删除（增删框本身走 `images:true` 的整份上报）。
 */
function mergePromptStashTexts(current, updates) {
  const byId = new Map((Array.isArray(current) ? current : []).map((entry) => [entry.id, entry]))
  const out = []
  for (const update of Array.isArray(updates) ? updates : []) {
    const id = update && typeof update === 'object' && typeof update.id === 'string' ? update.id : ''
    const text = update && typeof update === 'object' && update.text !== null && update.text !== undefined
      ? String(update.text).slice(0, PROMPT_STASH_TEXT_LIMIT)
      : ''
    const existing = byId.get(id)
    out.push({ id, text, images: existing ? existing.images : [] })
  }
  return out
}

/**
 * 会话列表的"最近修改时间"排序：把插件侧观察到的活动时间并入 `updatedAt` 后降序重排。
 *
 * 为什么需要：dsh `session/list` 的 `updatedAt` 只等于 `max(createdAt, sessionListMetadata.lastPromptAt)`
 * （即"最近一次发送提示词"），模型输出/工具调用这类"修改"在列表里体现不出来。插件从
 * `$events` 收到 `api-session/activity`（提示词时间）与 `api-session/status`（开始/结束运行）
 * 以及当前会话的 follow 事件，把这些时间记下来后在这里合并，排序与相对时间就都按
 * "最近修改时间"走。
 *
 * @param items - `session/list` 条目（dsh 顺序）。
 * @param activityBySession - Map 或普通对象：sessionId → 毫秒时间戳。
 * @returns 新数组（不改入参）；`updatedAt` 已取较大值，并按降序稳定排序。
 */
function applySessionActivity(items, activityBySession) {
  const lookup = activityBySession instanceof Map
    ? activityBySession
    : new Map(Object.entries(activityBySession || {}))
  const merged = (Array.isArray(items) ? items : []).map((item) => {
    const extra = lookup.get(item.sessionId)
    const current = typeof item.updatedAt === 'number' ? item.updatedAt : 0
    if (typeof extra !== 'number' || extra <= current) return item
    return { ...item, updatedAt: extra }
  })
  // 稳定排序：时间相同保持 dsh 的原始顺序（不因为排序抖动改变列表）。
  return merged
    .map((item, index) => ({ item, index }))
    .sort((left, right) => ((right.item.updatedAt || 0) - (left.item.updatedAt || 0)) || (left.index - right.index))
    .map((entry) => entry.item)
}

module.exports = {
  workspaceTitleOf,
  sessionDisplayTitleOf,
  buildQuestionOutcome,
  buildApprovalOutcome,
  buildEventRejection,
  isSubagentSession,
  goalBannerFingerprint,
  PROMPT_STASH_TEXT_LIMIT,
  normalizePromptStashEntries,
  normalizePromptStashImages,
  mergePromptStashTexts,
  applySessionActivity,
}
