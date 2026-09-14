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
 * 计划评审提问的判定（与 webview 的 `isPlanReviewQuestion()` 同一套条件）：
 * `intent.kind === 'plan-review'`、单选、带 detail，且选项里恰好一个批准项 + 一个其它项。
 * @param question - waterfall `user-questions/request` 里的单个问题。
 */
function isPlanReviewQuestion(question) {
  if (!question || typeof question !== 'object') return false
  const intent = question.intent
  if (!intent || intent.kind !== 'plan-review') return false
  if (question.multiSelect) return false
  if (!question.detail || !Array.isArray(question.options)) return false
  const approve = intent.approve
  let hasApprove = false
  let others = 0
  for (const option of question.options) {
    if (option && option.label === approve) hasApprove = true
    else others += 1
  }
  return hasApprove && others === 1
}

/**
 * 会话行要显示的"待处理交互"种类（**与 dsh Web UI 同一口径**）：
 * 审批 > 计划待审 > 等待回答；没有待处理项时返回 null。
 * 这三种都是"Agent 正等你动手、那一轮不会自己结束"的状态，列表里必须能一眼看到。
 */
function pendingKindOf(questions, approvals) {
  if (Array.isArray(approvals) && approvals.length > 0) return 'approval'
  if (Array.isArray(questions) && questions.length > 0) {
    return questions.some(isPlanReviewQuestion) ? 'plan-review' : 'question'
  }
  return null
}

/** 子代理会话（`origin:'subagent'`）：插件不显示这类会话（用户要求删除子代理显示功能），
 * 这里仅用于把它们从会话列表里过滤掉。 */
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

/**
 * 一个会话的"待回答请求"列表的更新规则（提问与审批共用）。
 *
 * dsh 的提问/审批工具会阻塞该回合，所以同一会话同一时刻只可能有一个待回答请求：
 * 收到新请求就说明旧的已经结算/作废。必须**丢掉旧的**——否则快照永远返回那个
 * 答不掉的旧条目，把后续请求全部挡住（用户看到的现象是"一个会话只能调出一次选择器"）。
 *
 * @param current - 现有的待回答条目（可空）。
 * @param entry - 新收到的条目。
 * @param eventId - 新条目的事件 id（与 entry 里的一致；重复上报同一事件时原样返回）。
 * @returns 只含最新条目的新数组；重复上报同一事件时返回 `current` 本身。
 */
function nextPendingRequests(current, entry, eventId) {
  const list = Array.isArray(current) ? current : []
  if (list.length === 1 && list[0] && list[0].eventId === eventId) {
    return { list, stale: [], changed: false }
  }
  return { list: [entry], stale: list.filter((item) => item && item.eventId !== eventId), changed: true }
}

/**
 * 应答失败是否属于"事件已经不在了"（已结算/事件流已更换）。
 * 这类失败本地必须清掉条目，否则它会挡住后续请求；其它失败（可能是瞬时的）保留以便重试。
 */
function isEventGoneError(message) {
  return /no active event stream|unknown|not found|already|settled|expired|取消|已结束/i.test(String(message || ''))
}

module.exports = {
  workspaceTitleOf,
  sessionDisplayTitleOf,
  buildQuestionOutcome,
  buildApprovalOutcome,
  buildEventRejection,
  isSubagentSession,
  isPlanReviewQuestion,
  pendingKindOf,
  PROMPT_STASH_TEXT_LIMIT,
  normalizePromptStashEntries,
  normalizePromptStashImages,
  mergePromptStashTexts,
  applySessionActivity,
  nextPendingRequests,
  isEventGoneError,
}
