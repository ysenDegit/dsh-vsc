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
    this.archivedIgnored = new Set()
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
    } else if (frame.type === 'order') {
      // 0.1.5 新增：工作区手动排序（DOM insertBefore 语义）用完整 id 顺序重排缓存。
      const ids = Array.isArray(frame.workspaceIds) ? frame.workspaceIds : []
      const byId = new Map(this.workspaces.map((item) => [item.workspaceId, item]))
      const ordered = []
      for (const id of ids) {
        const item = byId.get(id)
        if (item) {
          ordered.push(item)
          byId.delete(id)
        }
      }
      for (const item of this.workspaces) if (byId.has(item.workspaceId)) ordered.push(item)
      this.workspaces = ordered
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

  async listWorkspaces() {
    return { items: this.workspaces.slice(), archivedSessionIds: this.archivedSessionIds.slice() }
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

  async listSessions(selectedSessionId, includeArchived = false, includeSubagents = true) {
    const client = this.requireClient()
    const { items } = await client.callArgs('session/list', { _request: {} })
    const fresh = this.workspace
    const accounted = new Set(fresh?.sessionIds || [])
    const archived = this.effectiveArchivedSet()
    return (items || [])
      .filter((item) => accounted.has(item.sessionId) || item.sessionId === selectedSessionId)
      .filter((item) => includeSubagents || item.origin !== 'subagent')
      .filter((item) => includeArchived || !archived.has(item.sessionId))
      .filter((item) => !item.blank || item.sessionId === selectedSessionId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * 插件侧"本地取消归档/隐藏归档"集合：dsh 0.1.5 没有 unarchive API，
   * 这里只影响插件视图（宿主归档集合减去本地忽略集合）。
   */
  setArchivedIgnored(sessionIds) {
    this.archivedIgnored = new Set(sessionIds || [])
  }

  /**
   * 当前工作区里"仍被归档"（未被本地恢复）的会话数：抽屉按钮用它显示"显示已归档（13）"，
   * 用户点之前就知道会有多少条出现，不再出现"点了没反应"的错觉。
   */
  archivedCountInWorkspace() {
    const accounted = new Set(this.workspace?.sessionIds || [])
    let count = 0
    for (const id of this.effectiveArchivedSet()) if (accounted.has(id)) count++
    return count
  }

  effectiveArchivedSet() {
    if (!this.archivedIgnored || this.archivedIgnored.size === 0) return new Set(this.archivedSessionIds)
    return new Set(this.archivedSessionIds.filter((id) => !this.archivedIgnored.has(id)))
  }

  isArchived(sessionId) {
    return this.effectiveArchivedSet().has(sessionId)
  }

  /** 上传一个文件附件，返回 {receiptId, file}（供 session/prompt 的 file part 使用）。 */
  async uploadFile(sessionId, data, name) {
    const client = this.requireClient()
    return await client.callArgs('fileUploads/upload', {
      agentId: sessionId,
      request: { data, ...(name ? { name } : {}) },
    })
  }

  /** 本机是否可以用系统文件管理器打开路径。 */
  async canOpenWorkspacePath() {
    const client = this.requireClient()
    return await client.callArgs('session/canOpenWorkspacePath', {})
  }

  /** 让 dsh 在桌面文件管理器中定位一个路径（action: 'reveal' 为"显示"）。 */
  async openWorkspacePath(path, action) {
    const client = this.requireClient()
    return await client.callArgs('session/openWorkspacePath', { request: { path, ...(action ? { action } : {}) } })
  }

  /**
   * 打开某个用户自定义 preset 目录（0.1.5 settings 端点，参数是 preset id）。
   * @param agentPreset - preset id（如 standard / cordis / 自定义 id）。
   */
  async openAgentPresetDirectory(agentPreset) {
    const client = this.requireClient()
    return await client.callArgs('settings/openAgentPresetDirectory', { agentPreset })
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
        && (!agentPreset || sessionPresetOf(item) === agentPreset)) {
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

  /**
   * 执行一条 `/` 命令。dsh 0.1.5 起参数名为 `submittedAttachments`
   * （`{type:'image'|'file'}` 联合），旧版的 `images` 会被网关以
   * "missing submittedAttachments" 直接拒绝。
   */
  async executeCommand(sessionId, line, attachments = []) {
    const client = this.requireClient()
    return await client.callArgs('commands/execute', {
      agentId: sessionId,
      line,
      submittedAttachments: normalizeCommandAttachments(attachments),
    })
  }

  /** 会话内容搜索（0.1.5 `session/search`）：返回 {items:[{sessionId,snippet}],hasMore}。 */
  async searchSessions(query) {
    const client = this.requireClient()
    return await client.callArgs('session/search', { request: { query } })
  }

  async prompt(sessionId, text, mode = 'queue', images = [], clientTimeZone, fileReceipts = []) {
    const client = this.requireClient()
    const content = []
    if (text) content.push({ type: 'text', text })
    for (const img of images || []) {
      if (!img || !img.data) continue
      content.push({ type: 'image', mediaType: img.mediaType || 'image/png', data: img.data, ...(img.name ? { name: img.name } : {}) })
    }
    // 0.1.5 文件附件：上传后得到的收据以 `{type:'file', receiptId}` 进入 prompt content。
    for (const receiptId of fileReceipts || []) {
      if (receiptId) content.push({ type: 'file', receiptId })
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
    const events = (page.records || []).flatMap((record) => historyRecordEvent(record))
    return { events, hasMore: Boolean(page.hasMore) }
  }

  async forkSession(sessionId, atSeq) {
    const client = this.requireClient()
    const request = { sessionId }
    if (atSeq !== undefined && atSeq !== null) request.atSeq = atSeq
    return await client.callArgs('session/fork', { request })
  }

  setArchived(ids) {
    this.archivedSessionIds = [...ids]
  }
}

/**
 * 把 session/page 的一条记录摊平成折叠器认识的 `{event, time}`。
 * dsh 0.1.5 起记录只有 `{type:'event', event}`（旧的 chunkrow 打包传输已废弃）。
 */
function historyRecordEvent(record) {
  if (!record || record.type !== 'event') return []
  const event = record.event
  if (!event || typeof event !== 'object') return []
  return [{ event, time: event.time }]
}

/**
 * 归一化 `/` 命令附件为 dsh 0.1.5 的 `CommandSubmitAttachment`：
 * `{type:'image', mediaType, data, name?}` 或 `{type:'file', receiptId}`。
 * webview 传来的普通图片对象（`{mediaType,data,name?}`）会被补上 `type:'image'`。
 */
function normalizeCommandAttachments(attachments) {
  const normalized = []
  for (const item of attachments || []) {
    if (!item) continue
    if (item.type === 'image') {
      if (item.data) normalized.push(item)
      continue
    }
    if (item.type === 'file') {
      if (item.receiptId) normalized.push(item)
      continue
    }
    if (item.data) {
      normalized.push({
        type: 'image',
        mediaType: item.mediaType || 'image/png',
        data: item.data,
        ...(item.name ? { name: item.name } : {}),
      })
    }
  }
  return normalized
}

/**
 * 读取一条会话的当前工作模式：0.1.5 把 preset 放进 `agentPreset` 投影
 * （`session/list` 与 follow/control 快照都带），旧版接口只在创建结果里给。
 * @param item - session/list 条目、follow header 或带 projections 的快照对象。
 * @returns preset id，未知时 null。
 */
function sessionPresetOf(item) {
  if (!item || typeof item !== 'object') return null
  const projected = item.projections?.values?.agentPreset
  if (typeof projected === 'string' && projected) return projected
  if (typeof item.agentPreset === 'string' && item.agentPreset) return item.agentPreset
  return null
}

module.exports = {
  SessionService,
  canonicalPath,
  historyRecordEvent,
  normalizeCommandAttachments,
  sessionPresetOf,
}
