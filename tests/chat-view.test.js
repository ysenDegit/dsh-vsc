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

test('pending notifications: unfocused mode uses the OS notification, never twice per event', async () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  vscodeState.warnings.length = 0
  const rows = [
    { sessionId: 'S-1', title: '当前会话', updatedAt: 1 },
    { sessionId: 'S-2', title: '后台会话', updatedAt: 2 },
  ]
  const { provider } = makeProvider({ sessions: rows, selected: 'S-1' })
  await provider.refreshSessions()
  const lastWarning = () => vscodeState.warnings[vscodeState.warnings.length - 1] || null

  // 默认 unfocused + 窗口在前台 → 不打扰（用户正看着 VS Code）。
  vscodeState.focused = true
  provider.ingestQuestionRequested('S-2', 'e1', { questions: [{ id: 'q1', question: 'q', options: [{ label: 'a' }] }] })
  await flush()
  assert.equal(lastWarning(), null, '窗口在前台时默认不发通知')

  // 窗口不在前台（你在别的应用里）→ 发通知，带标题与两个按钮。
  vscodeState.focused = false
  provider.ingestQuestionRequested('S-2', 'e2', { questions: [{ id: 'q1', question: 'q', options: [{ label: 'a' }] }] })
  await flush()
  const warning = lastWarning()
  assert.ok(warning, '窗口不在前台时要发通知')
  assert.match(warning[0], /后台会话/, '通知文案带会话标题')
  assert.deepEqual(warning[1], ['打开并回答', '不再提醒'])

  // 同一个事件重复上报（或再次读快照）不会重复打扰。
  const count = vscodeState.warnings.length
  provider.ingestQuestionRequested('S-2', 'e2', { questions: [{ id: 'q1', question: 'q', options: [{ label: 'a' }] }] })
  await flush()
  assert.equal(vscodeState.warnings.length, count)

  // 计划待审 / 审批用不同文案（审批带工具名）。
  vscodeState.focused = false
  const planReview = {
    id: 'p1', question: 'Approve the plan?', detail: '# Plan',
    options: [{ label: 'Approve' }, { label: 'Keep planning' }],
    intent: { kind: 'plan-review', approve: 'Approve' },
  }
  provider.ingestQuestionRequested('S-2', 'e3', { questions: [planReview] })
  await flush()
  assert.match(lastWarning()[0], /计划待你审批/)
  provider.ingestApprovalRequested('S-2', 'e4', { toolName: 'bash', callId: 'c-1' })
  await flush()
  assert.match(lastWarning()[0], /批准工具调用/)
  assert.match(lastWarning()[0], /bash/)

  // 去重只针对"同一个事件"：事件结算后，同一会话的下一次请求要重新提醒。
  const beforeNew = vscodeState.warnings.length
  provider.ingestApprovalResolved('S-2', 'e4')
  provider.ingestQuestionRequested('S-2', 'e5', { questions: [{ id: 'q1', question: 'q', options: [{ label: 'a' }] }] })
  await flush()
  assert.ok(vscodeState.warnings.length > beforeNew, '新的请求要重新提醒')
  provider.ingestQuestionResolved('S-2', 'e5')

  // "不再提醒"：该会话在本次窗口内保持安静（连新事件也不再打扰）。
  vscodeState.warningPick = '不再提醒'
  provider.ingestQuestionRequested('S-2', 'e6', { questions: [{ id: 'q1', question: 'q', options: [{ label: 'a' }] }] })
  await flush()
  const muted = vscodeState.warnings.length
  provider.ingestQuestionResolved('S-2', 'e6')
  provider.ingestQuestionRequested('S-2', 'e7', { questions: [{ id: 'q1', question: 'q', options: [{ label: 'a' }] }] })
  await flush()
  assert.equal(vscodeState.warnings.length, muted, '点过"不再提醒"的会话保持安静')
  provider.ingestQuestionResolved('S-2', 'e7')
})

test('pending notifications: "always" respects the selected session, and the button switches to it', async () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  vscodeState.warnings.length = 0
  vscodeState.warningPick = null
  const rows = [
    { sessionId: 'S-1', title: '当前会话', updatedAt: 1 },
    { sessionId: 'S-2', title: '后台会话', updatedAt: 2 },
  ]
  const { provider } = makeProvider({ sessions: rows, selected: 'S-1', provider: { notifyPending: 'always' } })
  await provider.refreshSessions()
  vscodeState.focused = true

  // "总是提醒"：窗口在前台、但不是当前会话 → 提醒。
  provider.ingestQuestionRequested('S-2', 'a1', { questions: [{ id: 'q1', question: 'q', options: [{ label: 'a' }] }] })
  await flush()
  assert.equal(vscodeState.warnings.length, 1)

  // 当前会话的请求不提醒（选择器就在眼前）。
  provider.ingestQuestionRequested('S-1', 'a2', { questions: [{ id: 'q1', question: 'q', options: [{ label: 'a' }] }] })
  await flush()
  assert.equal(vscodeState.warnings.length, 1, '当前会话不需要通知')

  // "打开并回答" → 聚焦插件面板 + 切到该会话。
  vscodeState.warningPick = '打开并回答'
  provider.ingestApprovalRequested('S-2', 'a3', { toolName: 'bash', callId: 'c-1' })
  await flush()
  await flush()
  assert.ok(vscodeState.executedCommands.some(([command]) => command === 'dsh-vsc.chat.focus'))
  assert.equal(provider.selectedSessionId, 'S-2')

  // off：彻底静音。
  const off = makeProvider({ sessions: rows, selected: 'S-1', provider: { notifyPending: 'off' } })
  await off.provider.refreshSessions()
  provider.ingestQuestionRequested('S-2', 'a4', { questions: [{ id: 'q1', question: 'q', options: [{ label: 'a' }] }] })
  await flush()
  const before = vscodeState.warnings.length
  await off.provider.handleMessage({ type: 'setNotifyPending', value: 'off' })
  assert.equal(off.provider.notifyPendingMode, 'off')
  assert.equal(vscodeState.warnings.length, before)
})

test('status bar entry: text and click target follow the dsh state, and the toggle hides it', async () => {
  const folder = { uri: { fsPath: '/home/me/proj' } }
  vscodeState.workspaceFolders.push(folder)
  try {
    const { provider } = makeProvider()
    const item = vscodeState.statusBarItems.at(-1)
    assert.ok(item, '状态栏入口应在 provider 构造时就位')
    assert.equal(item.visible, true)
    assert.equal(item.alignment, 1, '左侧状态栏')
    assert.equal(item.text, '$(comment-discussion) dsh')
    assert.equal(item.tooltip, 'dsh 已就绪 · 点击在工作区打开 dsh 面板')
    // 点状态栏 = 在**工作区（编辑器列）**打开面板，不是聚焦侧边栏视图。
    assert.equal(item.command, 'dsh-vsc.openChatFromTitle')

    // 未连接/出错：点击直接重新检测 dsh web 实例（不是先打开面板再点状态点）。
    provider.dsh.statusValue = 'stopped'
    provider.syncStatusBar()
    assert.equal(item.text, '$(comment-discussion) dsh: 未连接')
    assert.equal(item.command, 'dsh-vsc.retryConnect')

    provider.dsh.statusValue = 'error'
    provider.syncStatusBar()
    assert.equal(item.text, '$(comment-discussion) dsh: 连接失败')
    assert.equal(item.command, 'dsh-vsc.retryConnect')

    // 发现/启动/重连中：转圈图标 + 打开面板看状态。
    provider.dsh.statusValue = 'starting'
    provider.syncStatusBar()
    assert.equal(item.text, '$(sync~spin) dsh: 启动中')
    assert.equal(item.command, 'dsh-vsc.openChatFromTitle')
    provider.dsh.statusValue = 'reconnecting'
    provider.syncStatusBar()
    assert.equal(item.text, '$(sync~spin) dsh: 重连中')

    // 英文界面下文案跟着走（语言切换要重渲染状态栏，否则会停在上一种语言）。
    provider.updatePreferences({ language: 'en' })
    provider.dsh.statusValue = 'ready'
    provider.syncStatusBar()
    assert.equal(item.tooltip, 'dsh is ready — click to open the dsh panel in the editor area')
    provider.dsh.statusValue = 'stopped'
    provider.syncStatusBar()
    assert.equal(item.text, '$(comment-discussion) dsh: not connected')
    provider.updatePreferences({ language: 'zh' })

    // 没有打开文件夹：dsh 以工作目录为单位，点击改为打开文件夹。
    vscodeState.workspaceFolders.length = 0
    provider.syncStatusBar()
    assert.equal(item.text, '$(comment-discussion) dsh: 未打开文件夹')
    assert.equal(item.command, 'workbench.action.files.openFolder')
    vscodeState.workspaceFolders.push(folder)

    // 开关关闭：只隐藏不销毁；重新打开立刻可用（并落配置）。
    await provider.handleMessage({ type: 'setStatusBarEntry', value: false })
    assert.equal(provider.statusBarEnabled, false)
    assert.equal(item.visible, false)
    assert.equal(item.disposed, false)
    assert.deepEqual(vscodeState.configUpdates.at(-1), ['statusBarEntry', false])
    await provider.handleMessage({ type: 'setStatusBarEntry', value: true })
    assert.equal(item.visible, true)

    // VS Code 设置 UI 里改掉时也要同步（不依赖插件弹窗）。
    provider.updatePreferences({ statusBarEntry: false })
    assert.equal(item.visible, false)

    // 扩展停用：状态栏项随 provider 一起销毁。
    provider.dispose()
    assert.equal(item.disposed, true)
  } finally {
    vscodeState.workspaceFolders.length = 0
  }
})

test('schedule badge: rows carry active-schedule info from the schedule projection', async () => {
  const rows = [
    {
      sessionId: 'S-1', displayTitle: 'a', running: false, updatedAt: 1, archived: false,
      projections: {
        values: {
          schedule: [
            { id: 'r1', kind: 'every', prompt: 'p', everySeconds: 600, scheduledAt: '2030-01-01T10:30:00.000Z' },
            { id: 'r2', kind: 'at', prompt: 'q', scheduledAt: '2030-01-01T09:00:00.000Z' },
          ],
        },
      },
    },
    { sessionId: 'S-2', displayTitle: 'b', running: false, updatedAt: 2, archived: false },
  ]
  const { provider, posted } = makeProvider({ sessions: rows, selected: 'S-1' })
  await provider.refreshSessions()

  const frames = () => posted.filter((message) => message.type === 'sessions')
  const rowOf = (sessionId, frame = frames().pop()) => frame.sessions.find((item) => item.sessionId === sessionId)
  const at = (iso) => new Date(iso).toISOString()

  // 列表条目里的 schedule 投影（wire view = 活动提醒数组）：非空即标记，并取最早一条做"下一条"。
  assert.equal(rowOf('S-1').scheduleCount, 2)
  assert.equal(rowOf('S-1').nextScheduleAt, at('2030-01-01T09:00:00.000Z'))
  assert.equal(rowOf('S-2').scheduleCount, 0)
  assert.equal(rowOf('S-2').nextScheduleAt, null)

  // 实时投影帧（session/control 的 projection）到货时立刻重发 sessions 帧——即使不是当前会话，
  // 否则别的会话新建/触发完定时任务后徽标要等到下一次全量刷新才出现。
  const before = frames().length
  provider.applyControlFrame({
    type: 'projection', sessionId: 'S-2', key: 'schedule', seq: 3,
    value: [{ id: 'r3', kind: 'after', prompt: 'x', afterSeconds: 60, scheduledAt: '2031-05-05T08:00:00.000Z' }],
  })
  assert.equal(frames().length, before + 1, '定时任务投影变化要立刻重发 sessions 帧')
  assert.equal(rowOf('S-2').scheduleCount, 1)
  assert.equal(rowOf('S-2').nextScheduleAt, at('2031-05-05T08:00:00.000Z'))

  // 清空/非法值都按"没有定时任务"处理（旧版 dsh 没有这个投影，不能炸）。
  provider.applyControlFrame({ type: 'projection', sessionId: 'S-1', key: 'schedule', seq: 4, value: null })
  assert.equal(rowOf('S-1').scheduleCount, 0)
  assert.equal(rowOf('S-1').nextScheduleAt, null)
  provider.applyControlFrame({ type: 'projection', sessionId: 'S-2', key: 'schedule', seq: 5, value: [{ scheduledAt: 'not-a-date' }] })
  assert.equal(rowOf('S-2').scheduleCount, 1)
  assert.equal(rowOf('S-2').nextScheduleAt, null, '解析不出时间就不显示"下一条"，但标记仍在')
})
