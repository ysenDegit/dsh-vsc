'use strict'

const { realpathSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { DshRpcError } = require('./wire.js')

function canonicalPath(p) {
  try {
    const real = realpathSync.native(p)
    return process.platform === 'win32' ? real.toLowerCase() : real
  } catch {
    const fallback = p
    return process.platform === 'win32' ? fallback.toLowerCase() : fallback
  }
}

class SessionService {
  constructor(wire) {
    this.wire = wire
    this.workspace = null
    // workspace/follow 缓存在线工作区列表（rc.1 没有 workspace.list 一元 RPC）。
    this.workspaces = []
    this.archivedSessionIds = []
    this.workspaceReady = false
    this.workspaceReadyWaiters = []
  }

  /** 等待 workspace/follow baseline 至少到达一次（最多 5s 兜底），避免首屏误建重复工作区。 */
  whenWorkspaceReady() {
    if (this.workspaceReady) return Promise.resolve()
    return new Promise((resolve) => {
      this.workspaceReadyWaiters.push(resolve)
      const timer = setTimeout(() => { this.resolveWorkspaceReady() }, 5000)
      // 兜底计时器不阻塞进程退出；服务已停止时 Promise 交由流程自己结束。
      timer.unref?.()
    })
  }

  resolveWorkspaceReady() {
    if (this.workspaceReady) return
    this.workspaceReady = true
    for (const resolve of this.workspaceReadyWaiters) resolve()
    this.workspaceReadyWaiters = []
  }

  get currentWorkspace() { return this.workspace }

  requireClient() {
    const client = this.wire()
    if (!client) throw new Error('dsh web 尚未就绪')
    return client
  }

  /** 由 workspace/follow 流帧维护缓存。 */
  applyWorkspaceFrame(frame) {
    if (!frame || typeof frame !== 'object') return
    if (frame.type === 'baseline') {
      this.workspaces = Array.isArray(frame.value?.items) ? frame.value.items.slice() : []
      this.archivedSessionIds = Array.isArray(frame.value?.archivedSessionIds)
        ? frame.value.archivedSessionIds.slice()
        : []
      this.resolveWorkspaceReady()
    } else if (frame.type === 'upsert') {
      const ws = frame.workspace
      if (ws) {
        const index = this.workspaces.findIndex((item) => item.workspaceId === ws.workspaceId)
        if (index === -1) this.workspaces.push(ws)
        else this.workspaces[index] = ws
      }
    } else if (frame.type === 'remove') {
      this.workspaces = this.workspaces.filter((item) => item.workspaceId !== frame.workspaceId)
    } else if (frame.type === 'archived') {
      this.archivedSessionIds = Array.isArray(frame.archivedSessionIds)
        ? frame.archivedSessionIds.slice()
        : []
    }
    // 同步当前工作区引用，避免后续 findWorkspace/listSessions 用旧对象。
    if (this.workspace) {
      const fresh = this.workspaces.find((w) => w.workspaceId === this.workspace.workspaceId)
      if (fresh) this.workspace = fresh
      else this.workspace = null
    }
  }

  async ensureWorkspace(folderRoot) {
    if (this.workspace) return this.workspace
    await this.whenWorkspaceReady()
    const existing = await this.findWorkspace(folderRoot)
    if (existing) {
      this.workspace = existing
      return existing
    }
    return await this.createWorkspace(folderRoot)
  }

  async findWorkspace(folderRoot) {
    const canonical = canonicalPath(folderRoot)
    const existing = this.workspaces.find((item) => canonicalPath(item.path) === canonical) || null
    if (existing) this.workspace = existing
    return existing
  }

  async findWorkspaceById(workspaceId) {
    const ws = this.workspaces.find((w) => w.workspaceId === workspaceId) || null
    if (ws) this.workspace = ws
    return ws
  }

  async listWorkspaces() {
    return { items: this.workspaces.slice(), archivedSessionIds: this.archivedSessionIds.slice() }
  }

  async refreshWorkspace() {
    return this.workspaces.slice()
  }

  async listAllSessions() {
    const client = this.requireClient()
    return await client.callArgs('session/list', { _request: {} })
  }

  async listUngroupedSessions(workspaceId) {
    const client = this.requireClient()
    const { items } = await client.callArgs('session/list', { _request: {} })
    const target = this.workspaces.find((w) => w.workspaceId === workspaceId) || null
    if (!target) return { workspaceId, items: [] }
    const accounted = new Set()
    for (const ws of this.workspaces) {
      for (const id of ws.sessionIds) accounted.add(id)
    }
    const archived = new Set(this.archivedSessionIds)
    const ungrouped = (items || [])
      .filter((item) => !accounted.has(item.sessionId))
      .filter((item) => item.origin !== 'subagent')
      .filter((item) => !archived.has(item.sessionId))
      .filter((item) => item.cwd === target.path)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return { workspaceId, items: ungrouped }
  }

  async attachUngroupedSession(sessionId, workspaceId) {
    const client = this.requireClient()
    const result = await client.callArgs('session/create', { request: { sessionId, workspaceId } })
    const ws = this.workspaces.find((w) => w.workspaceId === workspaceId)
    if (ws && result?.sessionId && !ws.sessionIds.includes(result.sessionId)) {
      ws.sessionIds = [...ws.sessionIds, result.sessionId]
    }
    return result
  }

  async renameWorkspace(workspaceId, title) {
    const client = this.requireClient()
    const result = await client.callArgs('workspace/rename', { request: { workspaceId, title } })
    this.applyWorkspaceFrame({ type: 'upsert', workspace: result?.workspace })
    return result
  }

  async deleteWorkspace(workspaceId) {
    const client = this.requireClient()
    const result = await client.callArgs('workspace/delete', { request: { workspaceId } })
    this.applyWorkspaceFrame({ type: 'remove', workspaceId })
    return result
  }

  async createWorkspace(folderRoot) {
    const client = this.requireClient()
    const created = await client.callArgs('workspace/create', { request: { path: folderRoot } })
    this.applyWorkspaceFrame({ type: 'upsert', workspace: created?.workspace })
    this.workspace = created.workspace
    return created.workspace
  }

  reset() {
    this.workspace = null
    this.workspaces = []
    this.archivedSessionIds = []
    // 重置后缓存为空：让 whenWorkspaceReady() 重新等待下一次 baseline
    // （调用方须重开 workspace/follow 流以触发服务器重发 baseline）。
    this.workspaceReady = false
  }

  async listSessions(selectedSessionId, includeArchived = false) {
    const client = this.requireClient()
    const { items } = await client.callArgs('session/list', { _request: {} })
    const fresh = this.workspace
    const accounted = new Set(fresh?.sessionIds || [])
    const archived = new Set(this.archivedSessionIds)
    return (items || [])
      .filter((item) => accounted.has(item.sessionId) || item.sessionId === selectedSessionId)
      .filter((item) => item.origin !== 'subagent')
      .filter((item) => includeArchived || !archived.has(item.sessionId))
      .filter((item) => !item.blank || item.sessionId === selectedSessionId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  isArchived(sessionId) {
    return this.archivedSessionIds.includes(sessionId)
  }

  async resolveNewSession(agentPreset, occupiedBlankSessionIds = []) {
    const client = this.requireClient()
    const workspace = this.workspace
    if (!workspace) throw new Error('尚未关联 Workspace，无法创建会话')
    const { items } = await client.callArgs('session/list', { _request: {} })
    const archived = new Set(this.archivedSessionIds)
    const occupied = new Set(occupiedBlankSessionIds || [])
    for (const item of items || []) {
      if (item.blank
        && item.origin !== 'subagent'
        && item.cwd === workspace.path
        && (workspace.sessionIds || []).includes(item.sessionId)
        && !archived.has(item.sessionId)
        && !occupied.has(item.sessionId)
        && (!agentPreset || item.agentPreset === agentPreset)) {
        return { sessionId: item.sessionId }
      }
    }
    const result = await client.callArgs('session/create', {
      request: {
        workspaceId: workspace.workspaceId,
        ...(agentPreset ? { agentPreset } : {}),
      },
    })
    if (result?.sessionId && !workspace.sessionIds.includes(result.sessionId)) {
      workspace.sessionIds = [...workspace.sessionIds, result.sessionId]
    }
    return result
  }

  async listAgentPresets() {
    const client = this.requireClient()
    return await client.callArgs('agentPresets/list', {})
  }

  async selectAgentPreset(sessionId, agentPreset) {
    const client = this.requireClient()
    return await client.callArgs('agentPresets/select', { agentId: sessionId, agentPreset })
  }

  async getSession(sessionId) {
    const client = this.requireClient()
    const { items } = await client.callArgs('session/list', { _request: {} })
    return (items || []).find((item) => item.sessionId === sessionId) ?? null
  }

  async archiveSession(sessionId) {
    const client = this.requireClient()
    const result = await client.callArgs('workspace/archiveSession', { request: { sessionId } })
    this.archivedSessionIds = Array.isArray(result?.archivedSessionIds)
      ? result.archivedSessionIds.slice()
      : this.archivedSessionIds
    return this.archivedSessionIds
  }

  async renameSession(sessionId, title) {
    const client = this.requireClient()
    return await client.callArgs('session/rename', { request: { sessionId, title } })
  }

  async updateQueue(sessionId, itemId, action) {
    const client = this.requireClient()
    return await client.callArgs('session/updateQueue', { request: { sessionId, itemId, action } })
  }

  async models(sessionId) {
    const client = this.requireClient()
    return await client.callArgs('session/modelCatalog', {})
  }

  async selectModel(sessionId, provider, model, reasoningEffort) {
    const client = this.requireClient()
    const request = { sessionId, provider, model }
    if (reasoningEffort !== undefined) request.reasoningEffort = reasoningEffort
    return await client.callArgs('session/selectModel', { request })
  }

  async listCommands(sessionId) {
    const client = this.requireClient()
    return await client.callArgs('commands/list', { agentId: sessionId })
  }

  async executeCommand(sessionId, line, images = []) {
    const client = this.requireClient()
    return await client.callArgs('commands/execute', { agentId: sessionId, line, images })
  }

  async prompt(sessionId, text, mode = 'queue', images = [], clientTimeZone) {
    const client = this.requireClient()
    const content = []
    if (text) content.push({ type: 'text', text })
    for (const img of images || []) {
      if (!img || !img.data) continue
      content.push({ type: 'image', mediaType: img.mediaType || 'image/png', data: img.data, ...(img.name ? { name: img.name } : {}) })
    }
    const request = {
      requestId: randomUUID(),
      sessionId,
      mode,
      content,
    }
    if (clientTimeZone) request.clientTimeZone = clientTimeZone
    return await client.callArgs('session/prompt', { request })
  }

  async attachment(sessionId, attachmentId) {
    const client = this.requireClient()
    return await client.callArgs('session/attachment', { request: { sessionId, attachmentId } })
  }

  async cancel(sessionId) {
    const client = this.requireClient()
    try {
      return await client.callArgs('session/cancel', { request: { sessionId } })
    } catch (error) {
      if (error instanceof DshRpcError && error.code === 'session-not-found') return
      throw error
    }
  }

  /** 历史分页：throughSeq 用最大整数取当前尾页；beforeSeq 用于“加载更早”。 */
  async history(sessionId, beforeSeq, throughSeq) {
    const client = this.requireClient()
    // rc.1 的 session/page 要求 throughSeq 不晚于该会话当前 cursor；
    // 无 cursor 可用的增量页直接返回空，避免 Host 拒绝请求。
    if (throughSeq === undefined || throughSeq === null) return { events: [], hasMore: false }
    const request = {
      address: { kind: 'session', sessionId },
      throughSeq,
      ...(beforeSeq !== undefined && beforeSeq !== null ? { beforeSeq } : {}),
      maxMessages: 200,
    }
    const page = await client.callArgs('session/page', { request })
    const events = (page.records || []).flatMap((record) => expandHistoryRecord(record))
    return { events, hasMore: Boolean(page.hasMore) }
  }

  async forkSession(sessionId, atSeq) {
    const client = this.requireClient()
    const request = { sessionId }
    if (atSeq !== undefined && atSeq !== null) request.atSeq = atSeq
    return await client.callArgs('session/fork', { request })
  }

  async sessionCwd(sessionId) {
    const client = this.requireClient()
    const { items } = await client.callArgs('session/list', { _request: {} })
    return (items || []).find((item) => item.sessionId === sessionId)?.cwd ?? null
  }

  setArchived(ids) {
    this.archivedSessionIds = [...ids]
  }
}

/** 把 session/page 的 chunks 记录展开成旧折叠器认识的标量 event 形态。 */
function expandHistoryRecord(record) {
  if (!record) return []
  if (record.type === 'event') {
    const event = record.event
    if (event && typeof event === 'object') return [{ event, time: event.time }]
    return []
  }
  if (record.type === 'chunks') {
    const event = record.event
    if (!event || !event.data) return []
    const chunkEvent = (chunk) => ({ event: chunk, time: event.time })
    if (event.type === 'chunkrow/text-chunks') {
      const data = event.data
      const texts = Array.isArray(data.texts) ? data.texts : []
      return texts.map((text, index) => chunkEvent({
        type: 'assistant/chunk',
        seq: event.seq,
        time: event.time,
        data: { turn: data.turn, step: data.step, index: data.index + index, chunk: { type: 'text-delta', text } },
      }))
    }
    if (event.type === 'chunkrow/reasoning-chunks') {
      const data = event.data
      const texts = Array.isArray(data.texts) ? data.texts : []
      return texts.map((text, index) => chunkEvent({
        type: 'assistant/chunk',
        seq: event.seq,
        time: event.time,
        data: { turn: data.turn, step: data.step, index: data.index + index, chunk: { type: 'reasoning-delta', text } },
      }))
    }
    if (event.type === 'chunkrow/tool-call-chunks') {
      const data = event.data
      const args = Array.isArray(data.args) ? data.args : []
      return args.map((arg, index) => chunkEvent({
        type: 'tool/call',
        seq: event.seq,
        time: event.time,
        data: {
          turn: data.turn,
          step: data.step,
          index: data.index + index,
          callId: data.id,
          name: data.name || 'tool',
          arguments: arg,
        },
      }))
    }
  }
  return []
}

module.exports = { SessionService, canonicalPath, expandHistoryRecord }
