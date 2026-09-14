'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { installVscodeStub } = require('./helpers/vscode-stub.js')

const vscodeState = installVscodeStub()
const { ChatViewProvider } = require('../src/chat-view.js')

/** 造一个只回答 $events/result 的客户端替身。 */
function makeClient(options = {}) {
  return {
    results: [],
    async callArgs(method, args) {
      if (method === '$events/result') {
        this.results.push(args)
        if (options.failNext) {
          const message = options.failNext
          options.failNext = null
          throw new Error(message)
        }
      }
      return {}
    },
  }
}

function makeProvider(options = {}) {
  const client = makeClient(options.client)
  const sessions = {
    setArchivedIgnored() {},
    archivedCountInWorkspace: () => 0,
    effectiveArchivedSet: () => new Set(),
    isArchived: () => false,
    listSessions: async () => options.sessions || [],
    listAgentPresets: async () => ({ presets: [] }),
    listWorkspaces: async () => ({ items: [], archivedSessionIds: [] }),
    listAllSessions: async () => ({ items: [] }),
    whenWorkspaceReady: async () => {},
    reset() {},
    requireClient: () => client,
  }
  const dsh = {
    statusValue: 'ready', client, baseUrl: 'http://127.0.0.1:3080', webUrl: 'http://127.0.0.1:3080/?token=t',
    start: async () => {}, on() {}, openStream() { return { close() {} } },
  }
  const provider = new ChatViewProvider(dsh, sessions, { language: 'zh', onLog: () => {}, ...options.provider })
  const posted = []
  provider.webviews.add({ webview: { postMessage: (message) => posted.push(message) } })
  provider.remoteClientId = 'client-1'
  provider.selectedSessionId = options.selected || 'S-1'
  provider.workspaceView = { workspaceId: 'w-1', sessionIds: [] }
  return { provider, posted, client }
}

const questionFrame = (eventId, id, agentId = 'S-1') => ({
  type: 'waterfall',
  event: 'user-questions/request',
  eventId,
  agentId,
  request: { questions: [{ id, question: id, options: [{ label: 'a' }] }] },
})
const approvalFrame = (eventId, agentId = 'S-1') => ({
  type: 'waterfall',
  event: 'approval/request',
  eventId,
  agentId,
  request: { toolName: 'bash', callId: 'c-1', reason: 'why' },
})
const questionIds = (posted) => posted
  .filter((message) => message.type === 'question')
  .map((message) => (message.pending ? message.pending.questions.map((q) => q.id) : null))

test('a new question supersedes a stale unanswered one (selector keeps working)', () => {
  const { provider, posted } = makeProvider()
  provider.applyRemoteEventFrame(questionFrame('e1', 'q1'))
  assert.deepEqual(questionIds(posted).pop(), ['q1'])

  // 旧事件答不掉（用户没答、事件已作废）时，新事件不能被它挡住。
  provider.applyRemoteEventFrame(questionFrame('e2', 'q2'))
  assert.deepEqual(questionIds(posted).pop(), ['q2'], '新提问必须取代旧条目')
  assert.deepEqual(provider.pendingQuestionsBySession.get('S-1').map((item) => item.eventId), ['e2'])
})

test('answering clears the pending question; a failure on a dead event clears it too', async () => {
  const { provider, posted, client } = makeProvider()
  provider.applyRemoteEventFrame(questionFrame('e1', 'q1'))
  assert.equal(await provider.answerQuestion('S-1', 'e1', [{ id: 'q1', selected: ['a'] }]), true)
  assert.deepEqual(questionIds(posted).pop(), null)
  assert.equal(client.results.length, 1)

  // 事件已不在（例如 mux 重连后事件流换了）：本地必须清掉，否则后续提问永远出不来。
  const failing = makeProvider({ client: { failNext: 'typert gateway: Remote event result identifies no active event stream' } })
  failing.provider.applyRemoteEventFrame(questionFrame('e2', 'q2'))
  assert.equal(await failing.provider.answerQuestion('S-1', 'e2', [{ id: 'q2', selected: ['a'] }]), false)
  assert.equal(failing.provider.pendingQuestionsBySession.get('S-1').length, 0, '事件已不在时必须清掉条目')
  assert.ok(failing.posted.some((message) => message.type === 'notice' && message.level === 'error'))
  // 之后的新提问照常出现
  failing.provider.applyRemoteEventFrame(questionFrame('e3', 'q3'))
  assert.deepEqual(questionIds(failing.posted).pop(), ['q3'])

  // 瞬时失败：保留条目以便重试（但新提问依然会取代它）。
  const flaky = makeProvider({ client: { failNext: 'fetch failed' } })
  flaky.provider.applyRemoteEventFrame(questionFrame('e9', 'q9'))
  assert.equal(await flaky.provider.answerQuestion('S-1', 'e9', [{ id: 'q9', selected: ['a'] }]), false)
  assert.equal(flaky.provider.pendingQuestionsBySession.get('S-1').length, 1, '瞬时失败保留可重试')
})

test('a question/approval in another session notifies the user instead of hanging silently', () => {
  const { provider, posted } = makeProvider({ selected: 'S-1' })
  provider.applyRemoteEventFrame(questionFrame('e4', 'q4', 'S-2'))
  const notices = posted.filter((message) => message.type === 'notice')
  assert.equal(notices.length, 1)
  assert.match(notices[0].text, /S-2/)
  // 同一会话的重复提醒会被节流，不会刷屏。
  provider.applyRemoteEventFrame(questionFrame('e5', 'q5', 'S-2'))
  assert.equal(posted.filter((message) => message.type === 'notice').length, 1)

  const approval = makeProvider({ selected: 'S-1' })
  approval.provider.applyRemoteEventFrame(approvalFrame('a1', 'S-3'))
  assert.match(approval.posted.filter((message) => message.type === 'notice')[0].text, /S-3/)
})

test('refreshAll re-posts the pending question so the selector can be pulled back', async () => {
  const { provider, posted } = makeProvider()
  provider.applyRemoteEventFrame(questionFrame('e1', 'q1'))
  posted.length = 0
  await provider.refreshAll()
  assert.deepEqual(questionIds(posted).filter(Boolean).pop(), ['q1'])
  assert.deepEqual(
    posted.filter((message) => message.type === 'refreshing').map((message) => message.value),
    [true, false],
  )
})

test('cancelQuestion clears locally and tolerates a dead event', async () => {
  const { provider, posted } = makeProvider({ client: { failNext: 'no active event stream' } })
  provider.applyRemoteEventFrame(questionFrame('e1', 'q1'))
  await provider.cancelQuestion('S-1', 'e1')
  assert.equal(provider.pendingQuestionsBySession.get('S-1').length, 0)
  assert.deepEqual(questionIds(posted).pop(), null)
})

test('handleMessage answers questions/approvals with the webview payload shape (eventId + rpcId)', async () => {
  const { provider, client } = makeProvider()
  provider.applyRemoteEventFrame(questionFrame('e-1', 'q1'))
  // webview 现在发 eventId（并附 rpcId 兼容）；宿主必须用 eventId 调 $events/result。
  await provider.handleMessage({ type: 'questionAnswer', sessionId: 'S-1', eventId: 'e-1', rpcId: 'e-1', answers: [{ id: 'q1', selected: ['a'] }] })
  assert.equal(client.results.length, 1)
  assert.equal(client.results[0].eventId, 'e-1')
  assert.deepEqual(client.results[0].outcome, { kind: 'result', value: { answers: [{ id: 'q1', selected: ['a'] }] } })
  assert.equal(provider.pendingQuestionsBySession.get('S-1').length, 0)

  // 旧版 webview 只发 rpcId 时也照样接受。
  const legacy = makeProvider()
  legacy.provider.applyRemoteEventFrame(questionFrame('e-2', 'q2'))
  await legacy.provider.handleMessage({ type: 'questionAnswer', sessionId: 'S-1', rpcId: 'e-2', answers: [{ id: 'q2', selected: ['a'] }] })
  assert.equal(legacy.client.results.length, 1)

  // 审批同理。
  const approval = makeProvider()
  approval.provider.applyRemoteEventFrame(approvalFrame('a-1'))
  await approval.provider.handleMessage({ type: 'approvalAnswer', sessionId: 'S-1', eventId: 'a-1', approvalId: 'c-1', outcome: 'allowed-once' })
  assert.equal(approval.client.results.length, 1)
  assert.equal(approval.client.results[0].eventId, 'a-1')
  assert.deepEqual(approval.client.results[0].outcome, { kind: 'result', value: 'allowed-once' })
})

test('an answer without an event id is never dropped silently', async () => {
  const { provider, posted, client } = makeProvider()
  provider.applyRemoteEventFrame(questionFrame('e-1', 'q1'))
  // 缺少事件 id（例如插件与 webview 版本不匹配的老问题）：必须提示 + 记日志，并保留条目可重试。
  const ok = await provider.handleMessage({ type: 'questionAnswer', sessionId: 'S-1', answers: [{ id: 'q1', selected: ['a'] }] })
  assert.equal(ok, undefined) // handleMessage 不返回结果，这里只断言副作用
  assert.equal(client.results.length, 0, '不应发出无效的 $events/result')
  assert.equal(provider.pendingQuestionsBySession.get('S-1').length, 1, '条目保留，可重试')
  const notice = posted.filter((message) => message.type === 'notice').pop()
  assert.equal(notice.level, 'error')
  assert.match(notice.text, /事件 id/)

  // 审批缺字段同样提示而不是静默。
  const approval = makeProvider()
  approval.provider.applyRemoteEventFrame(approvalFrame('a-1'))
  await approval.provider.handleMessage({ type: 'approvalAnswer', sessionId: 'S-1', approvalId: 'c-1', outcome: 'allowed-once' })
  assert.equal(approval.client.results.length, 0)
  assert.equal(approval.posted.filter((message) => message.type === 'notice').pop().level, 'error')
})

test('applyExternalPromptStash: 别的窗口的改动推给 webview，内容没变则不重复推送', () => {
  const { provider, posted } = makeProvider()
  const image = { mediaType: 'image/png', data: 'QUJD', name: 'shot.png' }

  provider.applyExternalPromptStash([{ id: 'a', text: '来自另一个窗口', images: [image] }])
  const message = posted.filter((entry) => entry.type === 'promptStash').pop()
  assert.ok(message, 'a host-side file change must reach the webview')
  assert.equal(message.enabled, true)
  assert.deepEqual(message.items, [{ id: 'a', text: '来自另一个窗口', images: [image] }])

  // 内容一致（同一个文件被重复通知）→ 不再推送，避免打断本窗口正在输入的内容。
  const before = posted.length
  provider.applyExternalPromptStash([{ id: 'a', text: '来自另一个窗口', images: [{ mediaType: 'image/png', data: 'QUJD', name: 'shot.png' }] }])
  assert.equal(posted.length, before)

  // 外部清空（最后一个框被别的窗口删掉）同样要同步。
  provider.applyExternalPromptStash([])
  assert.deepEqual(posted.filter((entry) => entry.type === 'promptStash').pop().items, [])
})

test('updatePromptStash: 文本防抖按 id 合并、保留图片，并写入注入的工作区存储', async () => {
  const image = { mediaType: 'image/png', data: 'QUJD', name: '' }
  const saved = []
  const { provider } = makeProvider({
    provider: {
      loadPromptStash: () => [{ id: 'a', text: '旧文本', images: [image] }],
      persistPromptStash: (items) => saved.push(items),
    },
  })

  // images=false（打字防抖）：只有 id/text，宿主自己那份图片必须留住。
  await provider.updatePromptStash([{ id: 'a', text: '新文本' }], false)
  assert.equal(saved.length, 1)
  assert.equal(saved[0][0].text, '新文本')
  assert.deepEqual(saved[0][0].images, [image])

  // images=true（新增/删除框）：整份替换。
  await provider.updatePromptStash([{ id: 'a', text: '新文本', images: [] }, { id: 'b', text: '', images: [] }], true)
  assert.equal(saved.length, 2)
  assert.deepEqual(saved[1].map((entry) => entry.id), ['a', 'b'])
  assert.deepEqual(saved[1][0].images, [])
})

test('promptStash 跨窗口同步：界面没打开时只留最新一份快照', () => {
  const { provider } = makeProvider()
  provider.webviews.clear()
  provider.applyExternalPromptStash([{ id: 'a', text: '第一版', images: [] }])
  provider.applyExternalPromptStash([{ id: 'a', text: '第二版', images: [] }])
  assert.equal(provider.queue.length, 1, 'the pending queue must not grow with every sync')
  assert.equal(provider.queue[0].type, 'promptStash')
  assert.equal(provider.queue[0].items[0].text, '第二版')
})

test('row state: pendingKind and the completed edge ride the sessions frame', async () => {
  const rows = [
    { sessionId: 'S-1', updatedAt: 1 },
    { sessionId: 'S-2', updatedAt: 2 },
    { sessionId: 'S-sub', parentSessionId: 'S-2', origin: 'subagent', running: true, updatedAt: 3 },
  ]
  const { provider, posted } = makeProvider({ sessions: rows, selected: 'S-1' })
  const lastSessions = () => posted.filter((message) => message.type === 'sessions').pop()
  const rowOf = (id) => lastSessions().sessions.find((item) => item.sessionId === id)
  await provider.refreshSessions()

  // 子代理会话不下发（子代理显示功能已删除），只剩普通会话行。
  assert.deepEqual(lastSessions().sessions.map((item) => item.sessionId), ['S-2', 'S-1'], '按最近修改时间倒序，且没有子代理行')

  // 非当前会话"跑完了"→ completed（绿点）；切过去看就清掉。
  provider.applyRemoteEventFrame({ type: 'emit', event: 'api-session/status', args: ['S-2', true] })
  provider.applyRemoteEventFrame({ type: 'emit', event: 'api-session/status', args: ['S-2', false] })
  assert.equal(rowOf('S-2').completed, true, '跑完但没被打开过 → 已完成')
  provider.completedBySession.delete('S-2')
  await provider.selectSession('S-2')
  assert.equal(rowOf('S-2').completed, false, '打开会话即"看过"')

  // 当前会话跑完不算"没看过"（你正看着它）。
  provider.selectedSessionId = 'S-1'
  provider.applyRemoteEventFrame({ type: 'emit', event: 'api-session/status', args: ['S-1', true] })
  provider.applyRemoteEventFrame({ type: 'emit', event: 'api-session/status', args: ['S-1', false] })
  assert.equal(rowOf('S-1').completed, false)

  // 提问 / 计划评审 / 审批 → 三种待处理交互（审批优先级最高）。
  const ask = (request) => provider.applyRemoteEventFrame({ type: 'waterfall', event: 'user-questions/request', eventId: 'e-q', agentId: 'S-2', request })
  ask({ questions: [{ id: 'q1', question: 'q', options: [{ label: 'a' }] }] })
  assert.equal(rowOf('S-2').pendingKind, 'question')
  const planReview = {
    id: 'q2', question: 'Approve the plan?', detail: '# Plan',
    options: [{ label: 'Approve' }, { label: 'Keep planning' }],
    intent: { kind: 'plan-review', approve: 'Approve' },
  }
  provider.applyRemoteEventFrame({ type: 'waterfall', event: 'user-questions/request', eventId: 'e-p', agentId: 'S-2', request: { questions: [planReview] } })
  assert.equal(rowOf('S-2').pendingKind, 'plan-review')
  provider.applyRemoteEventFrame({ type: 'waterfall', event: 'approval/request', eventId: 'e-a', agentId: 'S-2', request: { toolName: 'bash', callId: 'c-1' } })
  assert.equal(rowOf('S-2').pendingKind, 'approval')
  provider.ingestApprovalResolved('S-2', 'e-a')
  provider.ingestQuestionResolved('S-2', 'e-p')
  provider.ingestQuestionResolved('S-2', 'e-q')
  assert.equal(rowOf('S-2').pendingKind, null, '答完就回到普通状态')
})

test('subagent sessions never reach the drawer (and are filtered out of search hits)', async () => {
  const rows = [
    { sessionId: 'S-1', updatedAt: 1 },
    { sessionId: 'S-sub', parentSessionId: 'S-1', origin: 'subagent', running: true, updatedAt: 3 },
  ]
  const { provider, posted } = makeProvider({ sessions: rows, selected: 'S-1' })
  await provider.refreshSessions()
  const sessionsFrame = posted.filter((message) => message.type === 'sessions').pop()
  assert.deepEqual(sessionsFrame.sessions.map((item) => item.sessionId), ['S-1'], '子代理会话不再下发')
  // fork 出来的会话（只有 parentSessionId、没有 origin）依旧按普通会话列出。
  assert.equal('promotedLocally' in sessionsFrame.sessions[0], false, '提升标记已随子代理功能一起删除')

  // 当前选中的恰好是子代理会话时保留它（否则列表与顶栏标题会对不上）。
  provider.selectedSessionId = 'S-sub'
  await provider.refreshSessions()
  assert.deepEqual(
    posted.filter((message) => message.type === 'sessions').pop().sessions.map((item) => item.sessionId),
    ['S-sub', 'S-1'],
  )

  // 内容搜索命中子代理会话时不再下发（点了会跳到列表里不存在的会话）。
  provider.selectedSessionId = 'S-1'
  provider.sessionSearchHandled = null
  provider.sessions.searchSessions = async () => ({ items: [{ sessionId: 'S-sub', snippet: 'x' }, { sessionId: 'S-1', snippet: 'y' }], hasMore: false })
  await provider.searchSessions('abc')
  const search = posted.filter((message) => message.type === 'sessionSearch').pop()
  assert.deepEqual(search.items.map((hit) => hit.sessionId), ['S-1'])
})
