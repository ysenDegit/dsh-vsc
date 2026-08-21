'use strict'

const { realpathSync } = require('node:fs')
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
    this.archivedSessionIds = []
  }

  get currentWorkspace() { return this.workspace }

  requireClient() {
    const client = this.wire()
    if (!client) throw new Error('dsh web 尚未就绪')
    return client
  }

  async ensureWorkspace(folderRoot) {
    if (this.workspace) return this.workspace
    const existing = await this.findWorkspace(folderRoot)
    if (existing) {
      this.workspace = existing
      return existing
    }
    return await this.createWorkspace(folderRoot)
  }

  async findWorkspace(folderRoot) {
    const client = this.requireClient()
    const list = await client.call('workspace.list', {})
    this.archivedSessionIds = list.archivedSessionIds
    const canonical = canonicalPath(folderRoot)
    const existing = list.items.find((item) => canonicalPath(item.path) === canonical) || null
    if (existing) this.workspace = existing
    return existing
  }

  async findWorkspaceById(workspaceId) {
    const client = this.requireClient()
    const list = await client.call('workspace.list', {})
    this.archivedSessionIds = list.archivedSessionIds
    const ws = list.items.find((w) => w.workspaceId === workspaceId) || null
    if (ws) this.workspace = ws
    return ws
  }

  async listWorkspaces() {
    const client = this.requireClient()
    return await client.call('workspace.list', {})
  }

  async listAllSessions() {
    const client = this.requireClient()
    return await client.call('session.list', {})
  }

  async renameWorkspace(workspaceId, title) {
    const client = this.requireClient()
    return await client.call('workspace.rename', { workspaceId, title })
  }

  async deleteWorkspace(workspaceId) {
    const client = this.requireClient()
    return await client.call('workspace.delete', { workspaceId })
  }

  async createWorkspace(folderRoot) {
    const client = this.requireClient()
    const created = await client.call('workspace.create', { path: folderRoot })
    this.workspace = created.workspace
    return created.workspace
  }

  reset() {
    this.workspace = null
    this.archivedSessionIds = []
  }

  async refreshWorkspace() {
    const workspace = this.workspace
    const client = this.requireClient()
    const { items, archivedSessionIds } = await client.call('workspace.list', {})
    this.archivedSessionIds = archivedSessionIds
    if (workspace) {
      const fresh = items.find((w) => w.workspaceId === workspace.workspaceId) ?? workspace
      this.workspace = fresh
    }
    return items
  }

  async listSessions(selectedSessionId, includeArchived = false) {
    const workspace = this.workspace
    if (!workspace) return []
    const client = this.requireClient()
    const { items: workspaces, archivedSessionIds } = await client.call('workspace.list', {})
    const fresh = workspaces.find((w) => w.workspaceId === workspace.workspaceId) ?? workspace
    this.workspace = fresh
    this.archivedSessionIds = archivedSessionIds

    const accounted = new Set(fresh.sessionIds)
    const archived = new Set(archivedSessionIds)
    const { items } = await client.call('session.list', {})
    return items
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
    const workspace = this.workspace
    if (!workspace) throw new Error('尚未关联 Workspace，无法创建会话')
    const client = this.requireClient()
    const { items: workspaces, archivedSessionIds } = await client.call('workspace.list', {})
    const fresh = workspaces.find((w) => w.workspaceId === workspace.workspaceId) ?? workspace
    this.workspace = fresh
    this.archivedSessionIds = archivedSessionIds

    const { items } = await client.call('session.list', {})
    const archived = new Set(archivedSessionIds)
    const occupied = new Set(occupiedBlankSessionIds)
    for (const item of items) {
      if (item.blank
        && item.origin !== 'subagent'
        && item.cwd === fresh.path
        && fresh.sessionIds.includes(item.sessionId)
        && !archived.has(item.sessionId)
        && !occupied.has(item.sessionId)
        && (!agentPreset || item.agentPreset === agentPreset)) {
        return { sessionId: item.sessionId }
      }
    }
    return await client.call('session.create', {
      workspaceId: fresh.workspaceId,
      ...(agentPreset ? { agentPreset } : {}),
    })
  }

  async listAgentPresets() {
    const client = this.requireClient()
    return await client.call('agentPreset.list', {})
  }

  async selectAgentPreset(sessionId, agentPreset) {
    const client = this.requireClient()
    return await client.call('agentPreset.select', { sessionId, agentPreset })
  }

  async getSession(sessionId) {
    const client = this.requireClient()
    const { items } = await client.call('session.list', {})
    return items.find((item) => item.sessionId === sessionId) ?? null
  }

  async archiveSession(sessionId) {
    const client = this.requireClient()
    const { archivedSessionIds } = await client.call('workspace.archiveSession', { sessionId })
    this.archivedSessionIds = archivedSessionIds
    return archivedSessionIds
  }

  async renameSession(sessionId, title) {
    const client = this.requireClient()
    return await client.call('session.rename', { sessionId, title })
  }

  async updateQueue(sessionId, itemId, action) {
    const client = this.requireClient()
    return await client.call('session.updateQueue', { sessionId, itemId, action })
  }

  async models(sessionId) {
    const client = this.requireClient()
    return await client.call('session.models', { sessionId })
  }

  async selectModel(sessionId, provider, model, reasoningEffort) {
    const client = this.requireClient()
    const payload = { sessionId, provider, model }
    if (reasoningEffort !== undefined) payload.reasoningEffort = reasoningEffort
    return await client.call('session.selectModel', payload)
  }

  async listCommands(sessionId) {
    const client = this.requireClient()
    return await client.call('commands/list', { args: { agentId: sessionId } })
  }

  async executeCommand(sessionId, line, images = []) {
    const client = this.requireClient()
    // Typert 描述符要求 args 含 images（base64 图片附件，空数组 = 无附件）；缺字段会报
    // `args fields do not match the descriptor: missing "images"`。
    return await client.call('commands/execute', { args: { agentId: sessionId, line, images } })
  }

  async prompt(sessionId, text, mode = 'queue', images = [], clientTimeZone) {
    const client = this.requireClient()
    const content = []
    if (text) content.push({ type: 'text', text })
    for (const img of images || []) {
      if (!img || !img.data) continue
      const part = { type: 'image', mediaType: img.mediaType || 'image/png', data: img.data }
      if (img.name) part.name = img.name
      content.push(part)
    }
    const payload = { sessionId, mode, content }
    if (clientTimeZone) payload.clientTimeZone = clientTimeZone
    return await client.call('session.prompt', payload)
  }

  async attachment(sessionId, attachmentId) {
    const client = this.requireClient()
    return await client.call('session.attachment', { sessionId, attachmentId })
  }

  async cancel(sessionId) {
    const client = this.requireClient()
    try {
      await client.call('session.cancel', { sessionId })
    } catch (error) {
      if (error instanceof DshRpcError && error.code === 'session-not-found') return
      throw error
    }
  }

  async history(sessionId, beforeSeq) {
    const client = this.requireClient()
    const payload = { sessionId }
    if (beforeSeq !== undefined && beforeSeq !== null) payload.beforeSeq = beforeSeq
    return await client.call('session.history', payload)
  }

  async sessionCwd(sessionId) {
    if (!sessionId) return null
    const client = this.requireClient()
    const { items } = await client.call('session.list', {})
    return items.find((item) => item.sessionId === sessionId)?.cwd ?? null
  }

  setArchived(ids) {
    this.archivedSessionIds = [...ids]
  }
}

module.exports = { SessionService, canonicalPath }
