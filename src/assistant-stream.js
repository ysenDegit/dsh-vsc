'use strict'

/**
 * dsh 0.1.5 的实时助手输出。
 *
 * 0.1.5 起助手增量不再写入会话日志（旧的 `assistant/chunk` 事件与 chunkrow
 * 打包传输已废弃）：durable 侧只有每步结束时的 `assistant/message`
 * （内含 `stream: AssistantStreamRecord[]` 紧凑记录），而运行中的增量通过
 * `session/follow` 的 `assistantStream: true` 以进程内帧下发：
 *   {type:'start'|'chunk'|'end', attemptId, revision, turn, step, ...}
 * 本模块提供：
 *   - `expandAssistantStreamRecords()`：把 durable 的紧凑记录展开成 timed chunk
 *     （用于重连快照里 activeAttempt.stream 的还原）。
 *   - `LiveAssistantStream`：跟随进程内帧累积当前 step 的文本/思考增量。
 */

/** 把一条紧凑记录展开成 `{time, chunk}` 序列（与 dsh `expandAssistantStream` 同构）。 */
function expandAssistantStreamRecords(records) {
  const chunks = []
  for (const record of records || []) {
    if (!record || typeof record !== 'object') continue
    if (record.type === 'chunk') {
      if (record.chunk) chunks.push({ time: record.time, chunk: record.chunk })
      continue
    }
    const members = record.type === 'tool-call-chunks' ? record.args : record.texts
    if (!Array.isArray(members)) continue
    const dt = Array.isArray(record.dt) ? record.dt : []
    let time = record.time0
    for (let index = 0; index < members.length; index += 1) {
      if (index > 0) time += dt[index - 1] || 0
      if (record.type === 'text-chunks') {
        chunks.push({ time, chunk: { type: 'text-delta', index: record.index, text: members[index] } })
      } else if (record.type === 'reasoning-chunks') {
        chunks.push({ time, chunk: { type: 'reasoning-delta', index: record.index, text: members[index] } })
      } else if (record.type === 'tool-call-chunks') {
        chunks.push({
          time,
          chunk: {
            type: 'tool-call-delta',
            index: record.index,
            id: record.id,
            ...(record.name === undefined ? {} : { name: record.name }),
            argumentsDelta: members[index],
          },
        })
      }
    }
  }
  return chunks
}

/** 一个会话当前 step 的实时助手输出累积器。 */
class LiveAssistantStream {
  constructor() {
    this.reset()
  }

  reset() {
    this.attemptId = null
    this.turn = null
    this.step = null
    this.nextIndex = 0
    this.text = ''
    this.reasoning = ''
    this.ended = false
    this.abandoned = false
  }

  /** 是否有可展示的实时内容（仅有思考也算：详细模式会显示它）。 */
  get hasContent() {
    return this.text.length > 0 || this.reasoning.length > 0
  }

  /**
   * 用 follow 快照里的 activeAttempt 还原重连前的实时输出。
   * @param baseline - `SessionAssistantStreamBaseline`（`{revision, activeAttempt?}`）。
   * @returns 是否恢复了内容（调用方据此决定重绘）。
   */
  seed(baseline) {
    this.reset()
    const active = baseline && baseline.activeAttempt
    if (!active) return false
    this.attemptId = active.attemptId || null
    this.turn = active.turn ?? null
    this.step = active.step ?? null
    const chunks = expandAssistantStreamRecords(active.stream || [])
    const limit = Number.isSafeInteger(active.nextIndex) ? active.nextIndex : chunks.length
    for (let index = 0; index < chunks.length && index < limit; index += 1) {
      this.applyChunk(chunks[index].chunk)
    }
    this.nextIndex = limit
    return this.hasContent
  }

  /**
   * 处理一帧进程内助手输出。
   * @param frame - `SessionAssistantStreamFrame`（start / chunk / end）。
   * @returns 是否改变了可展示内容（调用方据此决定重绘）。
   */
  accept(frame) {
    if (!frame || typeof frame !== 'object') return false
    if (frame.type === 'start') {
      if (this.attemptId === frame.attemptId) return false
      this.reset()
      this.attemptId = frame.attemptId || null
      this.turn = frame.turn ?? null
      this.step = frame.step ?? null
      return false
    }
    if (frame.type === 'chunk') {
      // 没有对应 start（如连接中途接入）或序号有缺口时忽略，
      // 该 step 结束时的 durable assistant/message 会给出完整内容。
      if (!this.attemptId || frame.attemptId !== this.attemptId) return false
      if (frame.index !== this.nextIndex) return false
      this.nextIndex += 1
      return this.applyChunk(frame.chunk)
    }
    if (frame.type === 'end') {
      if (!this.attemptId || frame.attemptId !== this.attemptId) return false
      this.ended = true
      if (frame.outcome && frame.outcome.kind === 'abandoned') {
        // 被放弃的尝试不产出消息：丢弃已累积内容。
        const had = this.hasContent
        this.text = ''
        this.reasoning = ''
        this.abandoned = true
        return had
      }
      return false
    }
    return false
  }

  /** durable 的 assistant/message 或 assistant/attempt 落地后清空实时内容。 */
  clear() {
    const had = this.hasContent
    this.reset()
    return had
  }

  /** 该 durable 结算是否属于当前实时尝试（同 turn/step）。 */
  matchesSettlement(eventType, data) {
    if (!this.attemptId) return false
    if (eventType !== 'assistant/message' && eventType !== 'assistant/attempt') return false
    if (!data || this.turn === null || this.step === null) return false
    return data.turn === this.turn && data.step === this.step
  }

  /** 供折叠器使用的 partial 会话条目；无内容时返回 null。 */
  snapshot() {
    if (!this.attemptId || !this.hasContent) return null
    return {
      type: 'assistant',
      id: 'assistant-live-' + String(this.attemptId),
      text: this.text,
      reasoning: this.reasoning,
      partial: true,
      live: true,
    }
  }

  applyChunk(chunk) {
    if (!chunk || typeof chunk !== 'object') return false
    if (chunk.type === 'text-delta') {
      const text = typeof chunk.text === 'string' ? chunk.text : ''
      if (!text) return false
      this.text += text
      return true
    }
    if (chunk.type === 'reasoning-delta') {
      const text = typeof chunk.text === 'string' ? chunk.text : ''
      if (!text) return false
      this.reasoning += text
      return true
    }
    return false
  }
}

module.exports = { LiveAssistantStream, expandAssistantStreamRecords }
