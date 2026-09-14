'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const vm = require('node:vm')
const { makeFakeDom, getBundleScript } = require('./helpers/fake-dom.js')

test('webview bundle executes end-to-end and posts ready', async () => {
  const script = getBundleScript('runtime-test-nonce')

  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  // 任何加载期抛错都会让整个 webview 变成静态占位（历史 bug），这里必须零异常。
  vm.runInContext(script, context, { timeout: 10_000 })

  assert.ok(
    posted.some((message) => message && message.type === 'ready'),
    'the bundle should announce ready to the extension host',
  )
  assert.ok(
    posted.every((message) => message && typeof message.type === 'string'),
    'every posted message should carry a type',
  )

  // 再跑一遍宿主→webview 的代表性消息，覆盖渲染路径（sessions/conversation/
  // stats/presets/settings/queue/question/approval），同样要求零异常。
  const dispatch = (message) => {
    for (const listener of listeners) listener({ data: message })
  }
  const sessions = [
    { sessionId: 's-1', displayTitle: 'my-app', running: true, blank: false, updatedAt: Date.now(), archived: false },
    { sessionId: 's-2', running: false, blank: true, updatedAt: Date.now(), archived: false },
    { sessionId: 's-3', running: false, blank: false, updatedAt: Date.now(), archived: true, cwd: '/home/me/other' },
    { sessionId: 's-4', parentSessionId: 's-1', origin: 'subagent', running: false, blank: false, updatedAt: Date.now(), archived: false },
  ]
  const conversation = [
    { type: 'user', text: 'hi', id: 'user-1' },
    { type: 'context', text: 'AGENTS.md instructions', summary: 'AGENTS.md', source: 'agent-instructions', id: 'context-2' },
    { type: 'assistant', text: 'hello', reasoning: 'r', partial: false, id: 'assistant-3' },
    { type: 'tool', name: 'bash', arguments: '{}', status: 'result', resultText: 'ok', callId: 'c-1', id: 'tool-4' },
    { type: 'assistant', text: 'streaming', partial: true, id: 'assistant-live-5' },
    { type: 'note', text: 'note', id: 'note-6' },
    { type: 'command', name: 'permission', args: ' read-only', status: 'done', outcome: { kind: 'success', text: 'ok' }, id: 'command-7' },
    { type: 'produced', paths: ['/a/b.ts'], id: 'produced-8' },
  ]
  dispatch({ type: 'hydrate', status: 'ready', workspace: { workspaceId: 'w-1', path: '/home/me/my-app', title: 'my-app' }, sessions, selectedSessionId: 's-3', conversation, sessionDisplay: 'detailed' })
  dispatch({ type: 'sessions', sessions, selectedSessionId: 's-3', archivedLocalCount: 1 })
  dispatch({ type: 'conversation', sessionId: 's-3', selectedSessionId: 's-3', conversation, running: true, hasMoreEarlier: true })
  dispatch({ type: 'presets', presets: [{ id: 'standard', name: '标准模式', description: 'd', trust: 'system', isDefault: true }, { id: 'custom', name: 'Custom', description: 'd', trust: 'author' }], modeSelectionEnabled: true })
  dispatch({ type: 'stats', sessionId: 's-3', stats: { tokenUsage: { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }, jobs: [{ id: 'j-1', kind: 'bash', label: 'build', status: 'running', startedAt: 1 }], goal: { goal: { objective: 'ship it', phase: 'active' } }, plan: { active: true, pending: false }, permissions: { options: [{ value: 'read-only', name: 'read-only' }], currentValue: 'read-only' }, todos: [{ id: 't1', text: 'x', status: 'in_progress' }] } })
  dispatch({ type: 'models', sessionId: 's-3', models: { current: { provider: 'p', model: 'm' }, groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }] }], failures: [] } })
  dispatch({ type: 'commands', sessionId: 's-3', available: true, items: [{ name: 'permission', description: 'd', hint: 'h', acceptsImages: true }] })
  dispatch({ type: 'settingsData', data: { writable: true, hasDocument: true, autoStart: false, sessionDisplay: 'detailed', workspaces: [], version: '1.1.2' } })
  dispatch({ type: 'sessionSearch', query: 'ab', items: [{ sessionId: 's-1', snippet: 'snip' }], hasMore: false })
  dispatch({ type: 'serviceStatus', status: 'stopped' })
  dispatch({ type: 'refreshing', value: true })
  dispatch({ type: 'refreshing', value: false })
  dispatch({ type: 'notice', text: 'dsh 尚未就绪：已保留当前列表。' })
  dispatch({ type: 'forkDone', title: 'x' })
  dispatch({ type: 'queue', sessionId: 's-3', items: [{ id: 'q-1', placement: 'queued', text: 'queued' }] })
  dispatch({ type: 'question', sessionId: 's-3', pending: { rpcId: 'r-1', questions: [{ id: 'q1', question: 'Q?', options: [{ label: 'a' }] }] } })
  dispatch({ type: 'approval', sessionId: 's-3', pending: { rpcId: 'r-2', toolName: 'bash', callId: 'c-9', reason: 'why' } })

  assert.ok(posted.length > 1, 'dispatching host messages should not throw')

  // 让渲染节流定时器在测试内跑完：任何异步回调抛错都会让用例失败。
  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('prepending older items on "load earlier" keeps DOM order', async () => {
  const script = getBundleScript('order-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const chat = context.document.getElementById('chat')
  chat.scrollHeight = 5000
  chat.clientHeight = 600
  chat.scrollTop = 1200
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const sessions = [{ sessionId: 's-1', displayTitle: 'sess', running: false, blank: false, updatedAt: 1, archived: false }]

  const seeded = [
    { type: 'user', text: 'm1', id: 'user-1' },
    { type: 'note', text: 'm2', id: 'note-2' },
    { type: 'command', name: 'permission', args: ' read-only', status: 'done', outcome: { kind: 'success', text: 'ok' }, id: 'command-3' },
    { type: 'tool', name: 'bash', arguments: '{}', status: 'result', resultText: 'ok', callId: 'c-4', id: 'tool-4' },
  ]
  const older = [
    { type: 'context', text: 'o1', summary: 'o1', id: 'context-5' },
    { type: 'context', text: 'o2', summary: 'o2', id: 'context-6' },
  ]
  const merged = [...older, ...seeded]

  dispatch({ type: 'hydrate', status: 'ready', workspace: { workspaceId: 'w', path: '/x', title: 'x' }, sessions, selectedSessionId: 's-1', conversation: seeded, sessionDisplay: 'detailed', hasMoreEarlier: true })
  dispatch({ type: 'conversation', sessionId: 's-1', selectedSessionId: 's-1', conversation: merged, running: false, hasMoreEarlier: false })
  await new Promise((resolve) => setTimeout(resolve, 250))

  const nodes = chat.childNodes.filter((node) => node && String(node.className || '').startsWith('msg '))
  assert.deepEqual(
    nodes.map((node) => String(node.className)),
    merged.map((item) => 'msg ' + item.type),
    'DOM order must follow the folded order after older items are prepended',
  )
})

test('prompt stash: hydrate renders boxes, + steals the composer draft, no box limit, sending removes the box', async () => {
  const script = getBundleScript('stash-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }

  dispatch({
    type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null,
    conversation: [], promptStash: { enabled: true, items: [{ id: 'a', text: '第一条提示词', images: [] }, { id: 'b', text: '', images: [] }] },
  })

  const stash = context.document.getElementById('promptStash')
  const addBtn = context.document.getElementById('stashAddBtn')
  const composer = context.document.getElementById('composerInput')
  const boxCount = () => stash.childNodes.length
  const rowAt = (index) => stash.childNodes[index]
  const partOf = (row, className) => (row.childNodes || []).find((node) => node && String(node.className) === className)
  const inputOf = (row) => partOf(row, 'stash-input')
  const sendOf = (row) => partOf(row, 'stash-send')
  const removeOf = (row) => partOf(row, 'stash-remove')
  const updates = () => posted.filter((message) => message && message.type === 'promptStashUpdate')
  const persisted = () => updates().pop().items
  const sends = () => posted.filter((message) => message && message.type === 'send')

  assert.equal(stash.hidden, false, 'hydrated boxes must be visible')
  assert.equal(boxCount(), 2, 'both persisted slots (incl. the empty one) must render')
  assert.equal(inputOf(rowAt(0)).value, '第一条提示词')
  assert.equal(inputOf(rowAt(0)).placeholder, '待输入提示词1')
  assert.equal(inputOf(rowAt(1)).placeholder, '待输入提示词2')
  assert.equal(sendOf(rowAt(1)).disabled, true, 'an empty slot cannot be sent')

  // 发送：把该框内容作为普通消息发进会话（没有图片时不带 images 字段），**并删除该暂存框**。
  sendOf(rowAt(0)).click()
  assert.equal(sends().length, 1)
  assert.equal(sends()[0].text, '第一条提示词')
  assert.equal(sends()[0].images, undefined, 'a text-only stash box sends no images')
  assert.equal(boxCount(), 1, 'the sent box is removed')
  assert.deepEqual(persisted().map((entry) => entry.text), [''], 'the removal is persisted immediately')
  assert.equal(updates().pop().images, true, 'structural changes are reported with images')
  assert.equal(inputOf(rowAt(0)).placeholder, '待输入提示词1', 'remaining boxes renumber')

  // 输入框里没有文字时：＋ 新建空暂存框，且**没有数量上限**（按钮永不禁用）。
  assert.ok(addBtn.title.startsWith('添加提示词暂存框'), 'tooltip names the action (+ shortcut hint)')
  assert.ok(addBtn.title.includes('Ctrl+Shift+Enter'), 'tooltip mentions the Ctrl+Shift+Enter shortcut')
  assert.equal(addBtn.disabled, false)
  for (let i = 0; i < 12; i++) addBtn.click()
  assert.equal(boxCount(), 13, 'boxes keep being added (no 5-box limit anymore)')
  assert.equal(addBtn.disabled, false, 'the + button must stay usable')
  assert.equal(persisted().length, 13, 'every added box is persisted (nothing is truncated)')

  // 输入框里有文字时：＋ 把这段文字整段存进新暂存框，并清空输入框。
  composer.value = '预先写好的下一条提示词'
  composer.dispatchEvent({ type: 'input' })
  assert.ok(addBtn.title.startsWith('把输入框内容存入新的暂存框'))
  addBtn.click()
  assert.equal(composer.value, '', 'the composer draft moves into the new box')
  assert.equal(boxCount(), 14)
  assert.equal(inputOf(rowAt(13)).value, '预先写好的下一条提示词')
  assert.equal(persisted()[13].text, '预先写好的下一条提示词')
  assert.ok(addBtn.title.startsWith('添加提示词暂存框'), 'title falls back once the composer is empty')

  // 多行草稿原样保存（单行框只是显示不下换行，发送时仍是原文）。
  composer.value = '第一行\n第二行'
  composer.dispatchEvent({ type: 'input' })
  addBtn.click()
  assert.equal(persisted()[14].text, '第一行\n第二行')
  assert.equal(boxCount(), 15)

  // 在框里打字：防抖上报只带 {id,text}（不带图片数据），宿主按 id 合并。
  inputOf(rowAt(4)).value = '打字中'
  inputOf(rowAt(4)).dispatchEvent({ type: 'input' })
  await new Promise((resolve) => setTimeout(resolve, 350))
  const typingUpdate = updates().pop()
  assert.equal(typingUpdate.images, false, 'typing reports text only')
  assert.equal(typingUpdate.items[4].text, '打字中')
  assert.equal('images' in typingUpdate.items[4], false, 'no image payload while typing')
  assert.equal(typeof typingUpdate.items[4].id, 'string')

  // Enter 等同于点击该框的发送按钮：发送并删除该框。
  inputOf(rowAt(4)).dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} })
  assert.equal(sends().length, 2)
  assert.equal(sends()[1].text, '打字中')
  assert.equal(boxCount(), 14, 'Enter-send removes the box as well')

  // 输入法组字中的 Enter（isComposing）只用于确认候选词：既不发送也不删框。
  const imeRow = rowAt(4)
  inputOf(imeRow).value = '组字中'
  inputOf(imeRow).dispatchEvent({ type: 'input' })
  inputOf(imeRow).dispatchEvent({ type: 'keydown', key: 'Enter', isComposing: true, preventDefault() {} })
  assert.equal(sends().length, 2, 'an IME composition Enter must not send the prompt')
  assert.equal(boxCount(), 14, 'nor remove the box')

  // × 手动移除该暂存框并持久化新数量。
  removeOf(rowAt(4)).click()
  assert.equal(boxCount(), 13)
  assert.equal(persisted().length, 13)

  await new Promise((resolve) => setTimeout(resolve, 350))
})

test('prompt stash: images can be stashed, sent and removed one by one', async () => {
  const script = getBundleScript('stash-image-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const stash = context.document.getElementById('promptStash')
  const addBtn = context.document.getElementById('stashAddBtn')
  const composer = context.document.getElementById('composerInput')
  const updates = () => posted.filter((message) => message && message.type === 'promptStashUpdate')
  const persisted = () => updates().pop().items
  const sends = () => posted.filter((message) => message && message.type === 'send')
  const partOf = (row, className) => (row.childNodes || []).find((node) => node && String(node.className) === className)
  const rowAt = (index) => stash.childNodes[index]

  // 已暂存图片的框：宿主下发条目里带 images → 行内出现缩略图。
  dispatch({
    type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null,
    conversation: [], promptStash: {
      enabled: true,
      items: [{ id: 'a', text: '看看这张图', images: [{ mediaType: 'image/png', data: 'QUJD', name: 'shot.png' }] }],
    },
  })
  const thumbs = partOf(rowAt(0), 'stash-thumbs')
  assert.equal(thumbs.hidden, false)
  assert.equal(thumbs.childNodes.length, 1)
  assert.equal(thumbs.childNodes[0].childNodes[0].src, 'data:image/png;base64,QUJD')

  // 发送：文字与图片一起提交给会话。
  partOf(rowAt(0), 'stash-send').click()
  assert.equal(sends().length, 1)
  assert.equal(sends()[0].text, '看看这张图')
  assert.deepEqual(sends()[0].images, [{ mediaType: 'image/png', data: 'QUJD', name: 'shot.png' }])
  assert.equal(stash.childNodes.length, 0, 'the sent box (with its image) is gone')

  // composer 里粘贴图片 + 打字 → ＋ 把两者一起存进新框，并清空 composer。
  const file = { name: 'draft.png', type: 'image/png', __dataUrl: 'data:image/png;base64,QUJD' }
  composer.dispatchEvent({
    type: 'paste',
    clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
    preventDefault() {},
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(context.document.getElementById('pendingImages').childNodes.length, 1, 'composer holds the pasted image')
  composer.value = '这张图有问题'
  composer.dispatchEvent({ type: 'input' })
  addBtn.click()
  assert.equal(composer.value, '', 'text moves into the stash box')
  assert.equal(context.document.getElementById('pendingImages').childNodes.length, 0, 'pending images move too')
  const entry = persisted()[0]
  assert.equal(entry.text, '这张图有问题')
  assert.deepEqual(entry.images, [{ mediaType: 'image/png', data: 'QUJD', name: 'draft.png' }])
  assert.equal(updates().pop().images, true, 'moving images is a structural update')
  assert.equal(partOf(rowAt(0), 'stash-thumbs').childNodes.length, 1)

  // 缩略图上的 × 只移除那张图，暂存框（与其文字）保留。
  partOf(partOf(rowAt(0), 'stash-thumbs').childNodes[0], '__none') // noop guard for undefined className
  partOf(rowAt(0), 'stash-thumbs').childNodes[0].childNodes[1].click()
  assert.equal(partOf(rowAt(0), 'stash-thumbs').hidden, true)
  assert.equal(persisted()[0].images.length, 0)
  assert.equal(persisted()[0].text, '这张图有问题')

  await new Promise((resolve) => setTimeout(resolve, 350))
})

test('prompt stash: settings switch, pending question and hydrate never clobber typed text', async () => {
  const script = getBundleScript('stash-toggle-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const stash = context.document.getElementById('promptStash')
  const addBtn = context.document.getElementById('stashAddBtn')
  const partOf = (row, className) => (row.childNodes || []).find((node) => node && String(node.className) === className)

  const base = {
    type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null,
    conversation: [], promptStash: { enabled: true, items: [{ id: 'a', text: '草稿', images: [] }] },
  }
  dispatch(base)
  assert.equal(stash.hidden, false)

  // 关闭开关：悬浮层与 ＋ 一起隐藏，但内容不清空（重新打开仍在）。
  dispatch({ type: 'settingsData', data: { writable: true, hasDocument: true, connected: true, promptStashEnabled: true, workspaces: [], version: '1.1.2' } })
  const walk = (node, out = []) => {
    for (const child of node.childNodes || []) { out.push(child); walk(child, out) }
    return out
  }
  const labelText = walk(context.document.getElementById('settingsContent'))
    .find((node) => node.tagName === 'SPAN' && node.textContent === '启用悬浮提示词暂存框')
  assert.ok(labelText, 'settings must expose the prompt stash switch')
  const switchBox = labelText.parentNode.childNodes[0]
  assert.equal(switchBox.checked, true)
  switchBox.checked = false
  switchBox.dispatchEvent({ type: 'change' })
  assert.deepEqual(
    posted.filter((message) => message && message.type === 'setPromptStash').pop(),
    { type: 'setPromptStash', value: false },
  )
  assert.equal(stash.hidden, true, 'disabled stash layer must hide')
  assert.equal(addBtn.hidden, true, 'the + button hides with the feature')
  addBtn.click()
  assert.equal(stash.childNodes.length, 0, 'the + button must not add boxes while disabled')

  dispatch({ type: 'promptStashEnabled', value: true })
  assert.equal(stash.hidden, false)
  assert.equal(partOf(stash.childNodes[0], 'stash-input').value, '草稿', 'content survives a disable/enable cycle')

  // 有待回答问题/审批时 composer 行整行隐藏，悬浮层一并收起。
  dispatch({ type: 'question', sessionId: null, pending: { rpcId: 'r-1', questions: [{ id: 'q1', question: 'Q?', options: [{ label: 'a' }] }] } })
  assert.equal(stash.hidden, true)
  dispatch({ type: 'question', sessionId: null, pending: null })
  assert.equal(stash.hidden, false)

  // 正在输入的框不被 hydrate 顶掉（宿主值可能落后于本地 300ms 防抖）。
  const input = partOf(stash.childNodes[0], 'stash-input')
  input.focus()
  input.value = '正在输入的新内容'
  dispatch(base)
  assert.equal(partOf(stash.childNodes[0], 'stash-input').value, '正在输入的新内容')

  await new Promise((resolve) => setTimeout(resolve, 350))
})

test('session drawer: forked sessions render exactly like normal sessions (no subagent rows at all)', async () => {
  const script = getBundleScript('lineage-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }

  // dsh 的会话列表里：fork 出来的会话只有 parentSessionId，子代理会话才有 origin:'subagent'。
  // 子代理显示功能已删除（用户要求）——宿主不再下发子代理行，这里再补一帧带子代理的列表做兜底断言：
  // 即使宿主漏发，webview 也不渲染任何子代理行、不缩进、不标"子代理会话"。
  const sessions = [
    { sessionId: 'S-root', displayTitle: 'anchored-standard维护', running: false, blank: false, updatedAt: 1, archived: false },
    { sessionId: 'S-fork', displayTitle: '会话（fork 02:15）', parentSessionId: 'S-root', running: false, blank: false, updatedAt: 2, archived: false },
    { sessionId: 'S-fork2', displayTitle: '会话（fork 02:40）', parentSessionId: 'S-fork', running: false, blank: false, updatedAt: 3, archived: false },
  ]
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions, selectedSessionId: 'S-root', conversation: [] })

  const rows = context.document.getElementById('drawerList').childNodes
    .filter((node) => node && String(node.className || '').startsWith('drawer-item'))
  const rowById = new Map(rows.map((row) => [row.getAttribute('data-session-id'), row]))
  assert.deepEqual(
    rows.map((row) => row.getAttribute('data-session-id')),
    ['S-fork2', 'S-fork', 'S-root'],
    '全部平铺、按最近修改时间倒序，没有缩进层级',
  )
  const metaOf = (row) => row.childNodes[1].childNodes[1].textContent
  const actionKinds = (row) => {
    const actions = (row.childNodes || []).find((node) => node && String(node.className) === 'drawer-actions')
    return actions ? actions.childNodes.map((btn) => btn.getAttribute('data-action')) : []
  }
  for (const forkRow of [rowById.get('S-fork'), rowById.get('S-fork2')]) {
    assert.equal(forkRow.style.paddingLeft, undefined, 'a forked session must not be indented')
    assert.ok(!String(forkRow.className).includes('drawer-child'))
    assert.ok(!metaOf(forkRow).includes('子代理会话'))
    assert.deepEqual(actionKinds(forkRow), ['forkSession', 'renameSession', 'closeSession'])
  }
  // 抽屉里不再有"提升/恢复层级"这类子代理专用操作。
  for (const row of rows) {
    assert.ok(!actionKinds(row).includes('promoteSession'))
    assert.ok(!actionKinds(row).includes('demoteSession'))
  }
  // 抽屉头部也没有"显示子代理"勾选框了。
  assert.equal(context.document.getElementById('subagentsCheck').childNodes.length, 0)

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('drawer archived toggle: label states the action + count and keeps toggling both ways', async () => {
  const script = getBundleScript('archived-toggle-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const toggle = context.document.getElementById('drawerArchivedToggle')
  const sessions = [{ sessionId: 'S-1', displayTitle: 'a', updatedAt: 1, blank: false, running: false, archived: false }]

  // 初始状态（dsh-vsc.showArchivedSessions=false）→ 按钮提示"显示已归档"，并带上可显示的条数。
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions, selectedSessionId: 'S-1', conversation: [], showArchivedSessions: false, archivedAvailable: 13 })
  assert.equal(toggle.textContent, '显示已归档（13）', 'the label must state the action and how many archived sessions exist')

  toggle.click()
  assert.deepEqual(
    posted.filter((m) => m.type === 'setShowArchivedSessions').pop(),
    { type: 'setShowArchivedSessions', value: true },
  )

  // 宿主确认打开归档视图 → 按钮变成"隐藏已归档（13）"。
  dispatch({ type: 'showArchivedSessions', value: true })
  assert.equal(toggle.textContent, '隐藏已归档（13）')

  // 关键回归：再次点击必须能重新隐藏（旧实现第二次点击后状态与文案脱节、再也隐藏不了）。
  toggle.click()
  assert.deepEqual(
    posted.filter((m) => m.type === 'setShowArchivedSessions').pop(),
    { type: 'setShowArchivedSessions', value: false },
  )
  dispatch({ type: 'showArchivedSessions', value: false })
  assert.equal(toggle.textContent, '显示已归档（13）')

  // 没有归档会话时去掉括号后缀。
  dispatch({ type: 'sessions', selectedSessionId: 'S-1', sessions, archivedAvailable: 0 })
  assert.equal(toggle.textContent, '显示已归档')

  // 反复切换始终跟随同一个状态源。
  toggle.click()
  assert.equal(posted.filter((m) => m.type === 'setShowArchivedSessions').pop().value, true)
})

test('drawer archived section: archived rows are grouped under a counted header', async () => {
  const script = getBundleScript('archived-section-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const childNodes = () => context.document.getElementById('drawerList').childNodes
  const ids = () => childNodes().filter((n) => n && String(n.className || '').startsWith('drawer-item')).map((n) => n.getAttribute('data-session-id'))
  const headers = () => childNodes().filter((n) => n && String(n.className) === 'drawer-section-title').map((n) => n.textContent)

  const sessions = [
    { sessionId: 'A', displayTitle: '活动 1', updatedAt: 4, blank: false, running: false, archived: false },
    { sessionId: 'OLD', displayTitle: '归档 1', updatedAt: 3, blank: false, running: false, archived: true },
    { sessionId: 'C', displayTitle: '活动 2', updatedAt: 2, blank: false, running: false, archived: false },
    { sessionId: 'RESTORED', displayTitle: '已恢复', updatedAt: 1, blank: false, running: false, archived: true, restoredLocally: true },
    { sessionId: 'OLD2', displayTitle: '归档 2', updatedAt: 0, blank: false, running: false, archived: true },
  ]

  // 关闭归档视图时列表里本来就没有归档会话（宿主已过滤）。
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, selectedSessionId: null, conversation: [], showArchivedSessions: true, archivedAvailable: 2, sessions })
  assert.deepEqual(ids(), ['A', 'C', 'RESTORED', 'OLD', 'OLD2'], 'active sessions first, then the archived group')
  assert.deepEqual(headers(), ['已归档（2）'], 'the archived group carries a counted header')
  // 分区标题出现在归档行之前、活动行之后。
  const order = childNodes().map((n) => String(n.className) === 'drawer-section-title' ? 'HEADER' : n.getAttribute('data-session-id'))
  assert.deepEqual(order, ['A', 'C', 'RESTORED', 'HEADER', 'OLD', 'OLD2'])

  // 关闭归档视图（宿主回推的列表里已无归档会话）→ 无分区标题。
  dispatch({ type: 'showArchivedSessions', value: false })
  dispatch({
    type: 'sessions', selectedSessionId: null, archivedAvailable: 2,
    sessions: sessions.filter((s) => !s.archived || s.restoredLocally),
  })
  assert.deepEqual(ids(), ['A', 'C', 'RESTORED'])
  assert.deepEqual(headers(), [])

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('drawer archived row: local "unarchive (plugin view)" is visible and reversible', async () => {
  const script = getBundleScript('archived-row-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const rowsOf = () => context.document.getElementById('drawerList').childNodes
    .filter((node) => node && String(node.className || '').startsWith('drawer-item'))
  const metaOf = (row) => row.childNodes[1].childNodes[1].textContent
  const actionButton = (row, kind) => {
    const actions = (row.childNodes || []).find((node) => node && String(node.className) === 'drawer-actions')
    return actions ? actions.childNodes.find((btn) => btn.getAttribute('data-action') === kind) : null
  }

  const archivedRow = { sessionId: 'S-arch', displayTitle: '旧会话', updatedAt: 1, blank: false, running: false, archived: true }
  dispatch({
    type: 'hydrate', status: 'ready', workspace: null, showArchivedSessions: true,
    sessions: [archivedRow], selectedSessionId: 'S-arch', conversation: [],
  })
  assert.match(metaOf(rowsOf()[0]), /^已归档/)
  assert.ok(actionButton(rowsOf()[0], 'restoreSession'), 'an archived row offers the view-only unarchive action')

  actionButton(rowsOf()[0], 'restoreSession').click()
  assert.deepEqual(
    posted.filter((m) => m.type === 'restoreSession').pop(),
    { type: 'restoreSession', sessionId: 'S-arch' },
  )

  // 本地恢复后：行内标出"已恢复显示（仅插件视图）"，并提供反向操作（隐藏归档视图时它也仍然可见）。
  // 宿主对"本地取消归档"的会话下发的 archived 为 false（effectiveArchivedSet 已排除它），
  // 只靠 restoredLocally 标记——与真实 payload 保持一致。
  dispatch({ type: 'sessions', selectedSessionId: 'S-arch', sessions: [{ ...archivedRow, archived: false, restoredLocally: true }] })
  assert.match(metaOf(rowsOf()[0]), /^已归档会话（仅插件内显示）/)
  assert.equal(
    rowsOf()[0].childNodes[1].childNodes[1].title,
    '该会话在 dsh 里已归档；dsh 没有取消归档接口（网页端会把归档会话直接过滤掉），插件只是在本地把它显示在列表里——不影响 dsh 的归档状态。',
  )
  assert.equal(actionButton(rowsOf()[0], 'restoreSession'), null)
  assert.ok(actionButton(rowsOf()[0], 'unrestoreSession'))

  actionButton(rowsOf()[0], 'unrestoreSession').click()
  assert.deepEqual(
    posted.filter((m) => m.type === 'unrestoreSession').pop(),
    { type: 'unrestoreSession', sessionId: 'S-arch' },
  )

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('session drawer: rows carry the session mode label (host name first, built-in fallback)', async () => {
  const script = getBundleScript('mode-chip-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const rowsOf = () => context.document.getElementById('drawerList').childNodes
    .filter((node) => node && String(node.className || '').startsWith('drawer-item'))
  const rowById = (id) => rowsOf().find((row) => row.getAttribute('data-session-id') === id)
  const modeOf = (row) => {
    const chip = (row.childNodes || []).find((node) => node && String(node.className) === 'drawer-mode')
    return chip || null
  }

  const sessions = [
    { sessionId: 'S-custom', displayTitle: 'a', agentPreset: 'anchored-standard', updatedAt: 1, blank: false, running: false, archived: false },
    { sessionId: 'S-ptc', displayTitle: 'b', agentPreset: 'ptc', updatedAt: 2, blank: false, running: false, archived: false },
    { sessionId: 'S-none', displayTitle: 'c', updatedAt: 3, blank: false, running: false, archived: false },
    { sessionId: 'S-proj', displayTitle: 'd', updatedAt: 4, blank: false, running: false, archived: false, projections: { values: { agentPreset: 'minimal' } } },
  ]
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions, selectedSessionId: null, conversation: [] })
  dispatch({
    type: 'presets', modeSelectionEnabled: true,
    presets: [{ id: 'anchored-standard', name: '锚定标准模式' }, { id: 'standard', name: '标准模式' }],
  })

  assert.equal(modeOf(rowById('S-custom')).textContent, '锚定标准模式', 'custom presets use the host catalog name')
  assert.equal(modeOf(rowById('S-custom')).title, '会话模式：锚定标准模式')
  assert.equal(modeOf(rowById('S-ptc')).textContent, 'PTC 模式', 'built-in ids fall back to the localized short name')
  assert.equal(modeOf(rowById('S-none')), null, 'sessions without an agent preset show no mode label')
  assert.equal(modeOf(rowById('S-proj')).textContent, '极简模式', 'the projection value alone is enough')

  // 界面语言切换后标签跟着变（内置短名本地化；宿主目录名原样保留）。
  dispatch({ type: 'language', value: 'en' })
  assert.equal(modeOf(rowById('S-ptc')).textContent, 'PTC Mode')
  assert.equal(modeOf(rowById('S-custom')).textContent, '锚定标准模式')

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('prompt stash: Ctrl+Shift+Enter in the composer stashes the draft (feature on, non-empty input)', async () => {
  const script = getBundleScript('stash-shortcut-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const stash = context.document.getElementById('promptStash')
  const composer = context.document.getElementById('composerInput')
  const updates = () => posted.filter((message) => message && message.type === 'promptStashUpdate')
  const sends = () => posted.filter((message) => message && message.type === 'send')
  const partOf = (row, className) => (row.childNodes || []).find((node) => node && String(node.className) === className)
  const key = (event) => composer.dispatchEvent(Object.assign({ type: 'keydown', key: 'Enter', preventDefault() {} }, event))

  dispatch({
    type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null,
    conversation: [], enterToSend: false, promptStash: { enabled: true, items: [] },
  })

  // 输入框为空：快捷键什么都不做（不造空框、不吞按键）。
  key({ ctrlKey: true, shiftKey: true })
  assert.equal(stash.childNodes.length, 0)
  assert.equal(updates().length, 0)

  // 单独的 Ctrl+Enter 不再是暂存快捷键（默认发送方式下它什么都不做）。
  composer.value = '不该被暂存'
  composer.dispatchEvent({ type: 'input' })
  key({ ctrlKey: true })
  assert.equal(composer.value, '不该被暂存', 'plain Ctrl+Enter must not stash anymore')
  assert.equal(stash.childNodes.length, 0)
  assert.equal(sends().length, 0)

  // Ctrl+Shift+Enter：存进新暂存框并清空输入框，且**不发送**。
  key({ ctrlKey: true, shiftKey: true })
  assert.equal(composer.value, '', 'Ctrl+Shift+Enter moves the draft out of the composer')
  assert.equal(stash.childNodes.length, 1)
  assert.equal(partOf(stash.childNodes[0], 'stash-input').value, '不该被暂存')
  assert.equal(sends().length, 0, 'Ctrl+Shift+Enter must not send the message')
  assert.equal(updates().pop().images, true)
  assert.equal(updates().pop().items[0].text, '不该被暂存')

  // 切成 Enter 发送：普通 Enter 仍然发送，Ctrl+Shift+Enter 仍然只暂存（Shift+Enter 是换行）。
  dispatch({ type: 'enterToSend', value: true })
  composer.value = '正常发送'
  composer.dispatchEvent({ type: 'input' })
  key({})
  assert.equal(sends().length, 1)
  assert.equal(sends()[0].text, '正常发送')
  composer.value = '还要暂存'
  composer.dispatchEvent({ type: 'input' })
  key({ ctrlKey: true, shiftKey: true })
  assert.equal(sends().length, 1, 'Ctrl+Shift+Enter must not send even in Enter-to-send mode')
  assert.equal(stash.childNodes.length, 2)
  assert.equal(partOf(stash.childNodes[1], 'stash-input').value, '还要暂存')

  // 关闭功能：Ctrl+Shift+Enter 不再拦截/暂存。
  dispatch({ type: 'promptStashEnabled', value: false })
  composer.value = '不暂存'
  composer.dispatchEvent({ type: 'input' })
  key({ ctrlKey: true, shiftKey: true })
  assert.equal(stash.childNodes.length, 0)
  assert.equal(updates().length, 2, 'no further stash updates while the feature is off')

  await new Promise((resolve) => setTimeout(resolve, 350))
})

test('composer placeholder advertises Ctrl+Shift+Enter only while the stash feature is on', async () => {
  const script = getBundleScript('placeholder-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const composer = context.document.getElementById('composerInput')

  dispatch({
    type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null,
    conversation: [], promptStash: { enabled: true, items: [] },
  })
  assert.ok(composer.placeholder.startsWith('Shift+Enter 发送'), composer.placeholder)
  assert.ok(composer.placeholder.endsWith(' · Ctrl+Shift+Enter 暂存'), composer.placeholder)

  // 切成 Enter 发送：基础文案跟着换，快捷键提示保留。
  dispatch({ type: 'enterToSend', value: true })
  assert.ok(composer.placeholder.startsWith('Enter 发送'), composer.placeholder)
  assert.ok(composer.placeholder.endsWith(' · Ctrl+Shift+Enter 暂存'), composer.placeholder)

  // 关掉暂存框功能：输入框里不再提示这个快捷键。
  dispatch({ type: 'promptStashEnabled', value: false })
  assert.equal(composer.placeholder.includes('Ctrl+Shift+Enter'), false, composer.placeholder)

  // 重新打开：提示回来。
  dispatch({ type: 'promptStashEnabled', value: true })
  assert.ok(composer.placeholder.includes('Ctrl+Shift+Enter 暂存'), composer.placeholder)

  // 英文界面用英文提示。
  dispatch({ type: 'language', value: 'en' })
  assert.ok(composer.placeholder.endsWith(' · Ctrl+Shift+Enter stashes'), composer.placeholder)
  assert.ok(composer.placeholder.startsWith('Enter to send'), composer.placeholder)

  // 初始就是关闭状态时也不出现该提示。
  dispatch({
    type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null,
    conversation: [], promptStash: { enabled: false, items: [] },
  })
  assert.equal(composer.placeholder.includes('Ctrl+Shift+Enter'), false, composer.placeholder)
})

test('settings: "extension view only" sessions can be cleared in bulk', async () => {
  const script = getBundleScript('clear-restored-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const walk = (node, out = []) => {
    for (const child of node.childNodes || []) { out.push(child); walk(child, out) }
    return out
  }
  const buttons = () => walk(context.document.getElementById('settingsContent'))
    .filter((node) => node.tagName === 'BUTTON')
  const clearBtn = () => buttons().find((btn) => String(btn.textContent).startsWith('清除"仅插件内显示"'))

  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null, conversation: [] })
  // 有"仅插件内显示"的会话时才有这个按钮，并带数量。
  dispatch({
    type: 'settingsData',
    data: { writable: true, hasDocument: true, connected: true, workspaces: [], version: '1.1.2', restoredCount: 4 },
  })
  assert.ok(clearBtn(), 'a bulk clear button must appear while local restores exist')
  assert.equal(clearBtn().textContent, '清除"仅插件内显示"（4）')
  clearBtn().click()
  assert.deepEqual(
    posted.filter((m) => m.type === 'clearRestoredSessions').pop(),
    { type: 'clearRestoredSessions' },
  )
  assert.equal(clearBtn().disabled, true, 'the button disables after clicking (host clears the set)')

  // 没有本地恢复的会话时不显示该按钮。
  dispatch({
    type: 'settingsData',
    data: { writable: true, hasDocument: true, connected: true, workspaces: [], version: '1.1.2', restoredCount: 0 },
  })
  assert.equal(clearBtn(), undefined)
})

test('drawer archived toggle: explains itself when every archived session is shown anyway', async () => {
  const script = getBundleScript('archived-hint-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const toggle = context.document.getElementById('drawerArchivedToggle')
  const sessions = [{ sessionId: 'S-1', displayTitle: 'a', updatedAt: 1, blank: false, running: false, archived: false }]

  // 本工作区的归档会话全部被"本地恢复显示"（旧版"隐藏已归档"按钮留下的痕迹）：
  // 可切换的归档会话数 = 0，但本地显示的有 13 条 → 开关无事可做，tooltip 说明原因。
  dispatch({
    type: 'hydrate', status: 'ready', workspace: null, sessions, selectedSessionId: 'S-1', conversation: [],
    showArchivedSessions: true, archivedAvailable: 0, restoredCount: 13,
  })
  assert.equal(toggle.textContent, '隐藏已归档', 'no count suffix when there is nothing to toggle')
  assert.ok(toggle.title.includes('本地恢复显示'), toggle.title)
  assert.ok(toggle.title.includes('13'), toggle.title)
  assert.ok(toggle.title.includes('清除仅插件内显示'), 'the hint points at the cleanup entry')

  // 清掉本地恢复、或本来就有可切换的归档会话 → 回到正常 tooltip。
  dispatch({ type: 'sessions', selectedSessionId: 'S-1', sessions, archivedAvailable: 9, restoredCount: 0 })
  assert.equal(toggle.textContent, '隐藏已归档（9）')
  assert.equal(toggle.title, '隐藏已归档（9）')

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('settings: the sponsor tab embeds both payment QR codes', async () => {
  const script = getBundleScript('sponsor-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const walk = (node, out = []) => {
    for (const child of node.childNodes || []) { out.push(child); walk(child, out) }
    return out
  }

  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null, conversation: [] })
  dispatch({
    type: 'settingsData',
    data: { writable: true, hasDocument: true, connected: true, workspaces: [], version: '1.1.2' },
  })

  const navButtons = walk(context.document.getElementById('settingsNav')).filter((node) => node.tagName === 'BUTTON')
  assert.ok(navButtons.some((btn) => btn.textContent === '赞助'), 'settings must expose a sponsor tab')

  const sponsorPane = walk(context.document.getElementById('settingsContent'))
    .find((node) => node.dataset && node.dataset.tab === 'sponsor')
  assert.ok(sponsorPane, 'the sponsor pane must exist')
  const images = walk(sponsorPane).filter((node) => node.tagName === 'IMG')
  assert.equal(images.length, 2, 'both payment QR codes must be embedded')
  for (const image of images) {
    assert.ok(String(image.src).startsWith('data:image/jpeg;base64,'), 'QR images are embedded as data URIs (webview CSP)')
    assert.ok(String(image.src).length > 1000, 'the real image data must be inlined')
  }
  assert.deepEqual(
    walk(sponsorPane).filter((node) => String(node.className) === 'sponsor-label').map((node) => node.textContent),
    ['微信', '支付宝'],
  )
  assert.deepEqual(
    walk(sponsorPane).filter((node) => String(node.className) === 'sponsor-slogan').map((node) => node.textContent),
    ['为爱发电，永久免费，如果此插件合您心意，请随意打点。'],
  )

  // 点击放大 / 还原（手机扫码用）。
  const box = images[0].parentNode
  assert.equal(String(box.className).includes('zoomed'), false)
  box.click()
  assert.ok(String(box.className).includes('zoomed'), 'clicking a QR code enlarges it')
  box.click()
  assert.equal(String(box.className).includes('zoomed'), false, 'clicking again restores the size')
})

test('offline: settings banner, in-panel notices and the disabled New Session button', async () => {
  const script = getBundleScript('offline-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const walk = (node, out = []) => {
    for (const child of node.childNodes || []) { out.push(child); walk(child, out) }
    return out
  }

  // dsh 未启动：状态点 stopped、"新建会话"禁用、设置弹窗顶部出现离线横幅（含重试按钮）。
  dispatch({ type: 'hydrate', status: 'stopped', workspace: null, sessions: [], selectedSessionId: null, conversation: [] })
  const newSessionBtn = context.document.getElementById('drawerNewBtn')
  assert.equal(newSessionBtn.disabled, true, 'creating a session needs the backend')
  assert.equal(newSessionBtn.title, 'dsh 后端未连接，无法新建会话')

  dispatch({ type: 'settingsData', data: { writable: false, hasDocument: false, connected: false, workspaces: [], version: '1.1.3' } })
  const banner = context.document.getElementById('settingsOffline')
  assert.equal(banner.hidden, false)
  const bannerText = walk(banner).map((node) => node.textContent).join(' ')
  assert.ok(bannerText.includes('dsh 后端未连接'), bannerText)
  const retry = walk(banner).find((node) => node.tagName === 'BUTTON')
  assert.equal(retry.textContent, '重新检测 dsh')
  retry.click()
  assert.deepEqual(
    posted.filter((message) => message.type === 'retryConnect').pop(),
    { type: 'retryConnect' },
  )

  // 后端未就绪的错误 → 面板内 toast（而不是被静默丢弃/弹模态框）。
  assert.equal(String(context.document.getElementById('toast').className).includes('open'), false)
  dispatch({ type: 'notice', text: 'dsh web 尚未就绪', level: 'error' })
  const toast = context.document.getElementById('toast')
  assert.ok(String(toast.className).includes('open'), 'notices must become visible toasts')
  assert.ok(String(toast.className).includes('error'))
  assert.equal(walk(toast).map((node) => node.textContent).join(''), 'dsh web 尚未就绪')

  // 后端连上后：按钮恢复、横幅消失。
  dispatch({ type: 'serviceStatus', status: 'ready' })
  dispatch({ type: 'settingsData', data: { writable: true, hasDocument: true, connected: true, workspaces: [], version: '1.1.3' } })
  assert.equal(newSessionBtn.disabled, false)
  assert.equal(banner.hidden, true)
  assert.equal(banner.childNodes.length, 0)

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('auth: manual token entry is reachable from the menu and the offline banner', async () => {
  const script = getBundleScript('auth-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const walk = (node, out = []) => {
    for (const child of node.childNodes || []) { out.push(child); walk(child, out) }
    return out
  }

  dispatch({ type: 'hydrate', status: 'stopped', workspace: null, sessions: [], selectedSessionId: null, conversation: [] })
  dispatch({ type: 'settingsData', data: { writable: false, hasDocument: false, connected: false, workspaces: [], version: '1.1.3' } })

  // ⋯ 菜单里的手动入口（dsh 需要认证时唯一能拿到 token 的地方）。
  const menuBtn = context.document.getElementById('moreTokenBtn')
  assert.equal(menuBtn.textContent, '🔑 输入 dsh Token 地址…')
  menuBtn.click()
  assert.deepEqual(posted.filter((message) => message.type === 'enterToken').pop(), { type: 'enterToken' })

  // 设置弹窗离线横幅里也有一个，按钮顺序：重新检测 dsh → 输入 Token 地址…
  const banner = context.document.getElementById('settingsOffline')
  const bannerButtons = walk(banner).filter((node) => node.tagName === 'BUTTON')
  assert.deepEqual(bannerButtons.map((btn) => btn.textContent), ['重新检测 dsh', '输入 Token 地址…'])
  bannerButtons[1].click()
  assert.equal(posted.filter((message) => message.type === 'enterToken').length, 2)

  // 英文界面下菜单项跟着切换。
  dispatch({ type: 'language', value: 'en' })
  assert.equal(menuBtn.textContent, '🔑 Enter dsh token URL…')
})

test('settings: language lives in Display, and General has a dsh server section', async () => {
  const script = getBundleScript('dsh-server-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const walk = (node, out = []) => {
    for (const child of node.childNodes || []) { out.push(child); walk(child, out) }
    return out
  }
  const paneOf = (tab) => walk(context.document.getElementById('settingsContent'))
    .find((node) => node.dataset && node.dataset.tab === tab)
  const texts = (node) => walk(node).map((child) => child.textContent).join(' | ')

  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null, conversation: [] })
  dispatch({
    type: 'settingsData',
    data: {
      writable: true, hasDocument: true, connected: true, workspaces: [], version: '1.1.3',
      baseUrl: 'http://127.0.0.1:3080', webUrl: 'http://127.0.0.1:3080/?token=Su1HXba0PuyHXXES8fbtuClH1UUv8ou8ipaDSbS17Qs',
    },
  })

  // 1) 界面语言在"显示"页（不再在"通用"页），且位于该页最上方。
  assert.ok(texts(paneOf('display')).includes('界面语言'), 'language must live in the Display pane')
  assert.equal(texts(paneOf('general')).includes('界面语言'), false, 'language must be gone from General')
  const displaySections = walk(paneOf('display')).filter((node) => String(node.className) === 'settings-section')
  assert.ok(
    texts(displaySections[0]).includes('界面语言'),
    '语言设置必须是"显示"页的第一个分区',
  )

  // 2) 通用页有 dsh 服务器设置：当前地址只读展示 + 复制按钮。
  const general = paneOf('general')
  const generalText = texts(general)
  assert.ok(generalText.includes('dsh 服务器'), generalText.slice(0, 120))
  const currentUrl = walk(general).find((node) => node.id === 'dshCurrentUrl')
  assert.equal(currentUrl.textContent, 'http://127.0.0.1:3080/?token=Su1HXba0PuyHXXES8fbtuClH1UUv8ou8ipaDSbS17Qs')
  assert.equal(currentUrl.tagName, 'SPAN', 'the current URL is a read-only hint string, not an input')
  const copyBtn = walk(general).find((node) => node.tagName === 'BUTTON' && node.textContent === '复制')
  assert.ok(copyBtn, 'a copy button must be offered')
  let copied = null
  context.navigator.clipboard.writeText = async (value) => { copied = value }
  copyBtn.click()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(copied, 'http://127.0.0.1:3080/?token=Su1HXba0PuyHXXES8fbtuClH1UUv8ou8ipaDSbS17Qs', 'the copy button writes the full URL')

  // 3) 粘贴新地址 + 重新连接 → 发给宿主；留空 = 重连当前服务。
  const input = walk(general).find((node) => node.id === 'dshServerInput')
  assert.equal(input.placeholder, 'http://127.0.0.1:3080/?token=...')
  const reconnectBtn = walk(general).find((node) => node.tagName === 'BUTTON' && node.textContent === '重新连接')
  input.value = '  http://127.0.0.1:4000/?token=abc  '
  reconnectBtn.click()
  assert.deepEqual(
    posted.filter((message) => message.type === 'dshReconnect').pop(),
    { type: 'dshReconnect', url: 'http://127.0.0.1:4000/?token=abc' },
  )
  input.value = ''
  reconnectBtn.click()
  assert.deepEqual(
    posted.filter((message) => message.type === 'dshReconnect').pop(),
    { type: 'dshReconnect', url: '' },
  )

  // 4) 未连接时：显示占位文案、复制按钮禁用。
  dispatch({
    type: 'settingsData',
    data: { writable: false, hasDocument: false, connected: false, workspaces: [], version: '1.1.3' },
  })
  const offlineGeneral = paneOf('general')
  assert.equal(walk(offlineGeneral).find((node) => node.id === 'dshCurrentUrl').textContent, '（未连接）')
  const offlineCopy = walk(offlineGeneral).find((node) => node.tagName === 'BUTTON' && node.textContent === '复制')
  assert.equal(offlineCopy.disabled, true)
})

test('session drawer: rows are ordered by last modification time (newest first)', async () => {
  const script = getBundleScript('order-by-time-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const ids = () => context.document.getElementById('drawerList').childNodes
    .filter((node) => node && String(node.className || '').startsWith('drawer-item'))
    .map((row) => row.getAttribute('data-session-id'))

  // 宿主即使发来乱序（或旧版本顺序不对），抽屉也必须按 updatedAt 倒序渲染。
  const base = { running: false, blank: false, archived: false }
  dispatch({
    type: 'hydrate', status: 'ready', workspace: null, selectedSessionId: null, conversation: [],
    sessions: [
      { sessionId: 'A', displayTitle: 'A', updatedAt: 100, ...base },
      { sessionId: 'B', displayTitle: 'B', updatedAt: 300, ...base },
      { sessionId: 'C', displayTitle: 'C', updatedAt: 200, ...base },
    ],
  })
  assert.deepEqual(ids(), ['B', 'C', 'A'])

  // 某个会话被修改（updatedAt 变大）后应立刻排到最前。
  dispatch({
    type: 'sessions', selectedSessionId: null,
    sessions: [
      { sessionId: 'A', displayTitle: 'A', updatedAt: 400, ...base },
      { sessionId: 'B', displayTitle: 'B', updatedAt: 300, ...base },
      { sessionId: 'C', displayTitle: 'C', updatedAt: 200, ...base },
    ],
  })
  assert.deepEqual(ids(), ['A', 'B', 'C'], '越近修改的会话越靠上')

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('question selector keeps appearing for every question in one session (plan review too)', async () => {
  const script = getBundleScript('questions-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const panel = context.document.getElementById('questionPanel')
  const panelText = () => {
    const walk = (node, out = []) => {
      for (const child of node.childNodes || []) { out.push(child); walk(child, out) }
      return out
    }
    return walk(panel).map((node) => node.textContent).join(' ')
  }

  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: 'S-1', conversation: [] })

  const ask = (id, extra = {}) => dispatch({
    type: 'question', sessionId: 'S-1',
    pending: { eventId: 'e-' + id, questions: [{ id, question: '问题 ' + id, options: [{ label: 'a' }, { label: 'b' }], ...extra }] },
  })

  // 普通提问 → 面板出现，选项可点。
  ask('q1')
  assert.equal(panel.style.display, 'block')
  assert.ok(panelText().includes('问题 q1'), panelText())

  // 回答后（宿主回发 pending:null）面板收起。
  dispatch({ type: 'question', sessionId: 'S-1', pending: null })
  assert.equal(panel.style.display, 'none')

  // 计划评审提问（plan-review intent）→ 走专门的 Plan Review 面板。
  ask('q2', { intent: { kind: 'plan-review', approve: 'a' }, detail: '## 计划\n内容' })
  assert.equal(panel.style.display, 'block')
  assert.ok(panelText().includes('计划评审'), panelText())
  assert.ok(panelText().includes('问题 q2'), panelText())

  dispatch({ type: 'question', sessionId: 'S-1', pending: null })
  assert.equal(panel.style.display, 'none')

  // 同一个会话再问一次 → 依然要能调出选择器（历史 bug：第二次起被旧条目挡住）。
  ask('q3')
  assert.equal(panel.style.display, 'block')
  assert.ok(panelText().includes('问题 q3'), panelText())

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('answering posts the waterfall eventId (the rpcId-only payload used to be dropped silently)', async () => {
  const script = getBundleScript('answer-payload-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const walk = (node, out = []) => {
    for (const child of node.childNodes || []) { out.push(child); walk(child, out) }
    return out
  }
  const panel = context.document.getElementById('questionPanel')
  const approvalPanel = context.document.getElementById('approvalPanel')
  const button = (root, text) => walk(root).find((node) => node.tagName === 'BUTTON' && node.textContent === text)
  const answers = () => posted.filter((message) => message.type === 'questionAnswer')
  const approvals = () => posted.filter((message) => message.type === 'approvalAnswer')

  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: 'S-1', conversation: [] })

  // 普通单选提问：点选项 → 点"提交回答"。
  dispatch({
    type: 'question', sessionId: 'S-1',
    pending: { eventId: 'e-1', questions: [{ id: 'q1', question: 'Q?', options: [{ label: '甲' }, { label: '乙' }] }] },
  })
  button(panel, '甲').click()
  button(panel, '提交回答').click()
  assert.equal(answers().length, 1)
  assert.equal(answers()[0].eventId, 'e-1', '必须带 eventId（宿主只认这个字段）')
  assert.equal(answers()[0].rpcId, 'e-1', '同时保留 rpcId 兼容旧宿主')
  assert.deepEqual(answers()[0].answers, [{ id: 'q1', selected: ['甲'] }])
  assert.equal(panel.style.display, 'block', '提交后不本地清空，等宿主回发 pending:null 再收起')

  // 宿主确认后收起。
  dispatch({ type: 'question', sessionId: 'S-1', pending: null })
  assert.equal(panel.style.display, 'none')

  // 计划评审：批准 / 不批准两个按钮都要带 eventId。
  dispatch({
    type: 'question', sessionId: 'S-1',
    pending: { eventId: 'e-2', questions: [{ id: 'plan', question: '批准计划？', detail: '## 计划', options: [{ label: '批准' }, { label: '调整' }], intent: { kind: 'plan-review', approve: '批准' } }] },
  })
  // 计划评审的正文用更高的专用容器（q-detail-plan），便于通读整份计划。
  const detail = walk(panel).find((node) => String(node.className).includes('q-detail'))
  assert.ok(String(detail.className).includes('q-detail-plan'), '计划评审正文需要专用高度样式')

  button(panel, '批准').click()
  assert.equal(answers().pop().eventId, 'e-2')
  assert.deepEqual(answers().pop().answers, [{ id: 'plan', selected: ['批准'] }])
  button(panel, '调整').click()
  assert.deepEqual(answers().pop().answers, [{ id: 'plan', selected: ['调整'] }])
  button(panel, '聊一聊').click()
  const cancel = posted.filter((message) => message.type === 'questionCancel').pop()
  assert.equal(cancel.eventId, 'e-2', '✕/聊一聊 也要带 eventId')

  // 工具审批：允许一次 / 拒绝。
  dispatch({ type: 'question', sessionId: 'S-1', pending: null })
  dispatch({ type: 'approval', sessionId: 'S-1', pending: { eventId: 'a-1', approvalId: 'ap-1', toolName: 'bash', reason: 'why' } })
  button(approvalPanel, '允许一次').click()
  assert.equal(approvals().pop().eventId, 'a-1')
  assert.equal(approvals().pop().approvalId, 'ap-1')
  assert.equal(approvals().pop().outcome, 'allowed-once')
  button(approvalPanel, '拒绝').click()
  assert.equal(approvals().pop().outcome, 'rejected')
  assert.equal(approvals().pop().eventId, 'a-1')

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('prompt stash: a host push from another window replaces the boxes (workspace-wide sync)', async () => {
  const script = getBundleScript('stash-sync-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }

  dispatch({
    type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null,
    conversation: [], promptStash: { enabled: true, items: [{ id: 'a', text: '本窗口的草稿', images: [] }] },
  })

  const stash = context.document.getElementById('promptStash')
  const rowAt = (index) => stash.childNodes[index]
  const inputOf = (row) => (row.childNodes || []).find((node) => node && String(node.className) === 'stash-input')
  assert.equal(inputOf(rowAt(0)).value, '本窗口的草稿')

  // 另一个窗口（同一工作区）新增了一个暂存框 → 宿主下发整份内容，本窗口立刻跟上。
  dispatch({
    type: 'promptStash',
    enabled: true,
    items: [
      { id: 'a', text: '本窗口的草稿', images: [] },
      { id: 'b', text: '别的窗口写的', images: [] },
    ],
  })
  assert.equal(stash.hidden, false)
  assert.equal(stash.childNodes.length, 2)
  assert.equal(inputOf(rowAt(1)).value, '别的窗口写的')

  // 正在输入的框不被顶掉（本窗口这次输入可能还没上报给宿主）。
  const typing = inputOf(rowAt(0))
  typing.focus()
  typing.value = '正在输入'
  dispatch({
    type: 'promptStash',
    enabled: true,
    items: [{ id: 'a', text: '本窗口的草稿', images: [] }, { id: 'b', text: '更新版', images: [] }],
  })
  assert.equal(inputOf(rowAt(0)).value, '正在输入', 'focused box keeps what the user is typing')
  assert.equal(inputOf(rowAt(1)).value, '更新版', 'other boxes still follow the host')

  // 别的窗口删空了 → 悬浮层收起。
  dispatch({ type: 'promptStash', enabled: true, items: [] })
  assert.equal(stash.childNodes.length, 0)
  assert.equal(stash.hidden, true)

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('session drawer: pending dots outrank running and completed is green', async () => {
  const script = getBundleScript('row-state-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }

  const sessions = [
    { sessionId: 'S-idle', displayTitle: '空闲会话', running: false, blank: false, updatedAt: 1, archived: false },
    { sessionId: 'S-work', displayTitle: '正在跑', running: true, blank: false, updatedAt: 2, archived: false },
    { sessionId: 'S-done', displayTitle: '跑完了没人看', completed: true, running: false, blank: false, updatedAt: 3, archived: false },
    { sessionId: 'S-ask', displayTitle: '等你回答', running: true, pendingKind: 'question', blank: false, updatedAt: 4, archived: false },
    { sessionId: 'S-plan', displayTitle: '等你审计划', running: true, pendingKind: 'plan-review', blank: false, updatedAt: 5, archived: false },
    { sessionId: 'S-approve', displayTitle: '等你批准', running: true, pendingKind: 'approval', blank: false, updatedAt: 6, archived: false },
  ]
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions, selectedSessionId: 'S-idle', conversation: [] })

  const rowsOf = () => context.document.getElementById('drawerList').childNodes
    .filter((node) => node && String(node.className || '').startsWith('drawer-item'))
  const rowById = (id) => rowsOf().find((row) => row.getAttribute('data-session-id') === id)
  const metaOf = (row) => row.childNodes[1].childNodes[1].textContent
  const dotOf = (row) => (row.childNodes || []).find((node) => node && String(node.className) === 'drawer-dot')

  // 每个行的"主状态"都能从 data-state 读出来（点色由 CSS 按类上色）。
  assert.equal(rowById('S-idle').getAttribute('data-state'), 'idle')
  assert.equal(rowById('S-work').getAttribute('data-state'), 'running')
  assert.equal(rowById('S-done').getAttribute('data-state'), 'completed')
  assert.match(String(rowById('S-done').className), /completed/, 'completed 行用绿点')
  assert.equal(rowById('S-ask').getAttribute('data-state'), 'question')
  assert.equal(rowById('S-plan').getAttribute('data-state'), 'plan-review')
  assert.equal(rowById('S-approve').getAttribute('data-state'), 'approval')

  // 待处理交互优先于"运行中"：类名与文案都是琥珀点那一套。
  for (const [id, label] of [['S-ask', '等待回答'], ['S-plan', '计划待审'], ['S-approve', '等待审批']]) {
    const row = rowById(id)
    assert.match(String(row.className), /pending/, `${id} 要有 pending 类（琥珀点）`)
    assert.equal(String(row.className).includes('running'), false, `${id} 不该同时用运行中的点色`)
    assert.ok(metaOf(row).includes(label), `${id} 的文案应是 ${label}：${metaOf(row)}`)
    assert.ok(String(dotOf(row).title).includes(label), '点的 tooltip 说明是哪种等待')
  }
  assert.equal(metaOf(rowById('S-work')).includes('工作中'), true)

  // 子代理计数落在父行上。
  // 状态清掉后（宿主重发帧）回到普通状态。
  dispatch({ type: 'sessions', sessions: sessions.map((s) => ({ ...s, pendingKind: null, completed: false })), selectedSessionId: 'S-idle' })
  assert.equal(rowById('S-ask').getAttribute('data-state'), 'running')
  assert.equal(rowById('S-done').getAttribute('data-state'), 'idle')

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('the goal banner is gone (plan banner stays)', async () => {
  const script = getBundleScript('no-goal-banner-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: 'S-1', conversation: [] })

  const banner = context.document.getElementById('sessionBanner')
  // 只有目标、没有计划模式：不再显示横幅（用户要求删掉目标横幅）。
  dispatch({ type: 'stats', sessionId: 'S-1', stats: { goal: { goal: { objective: '把插件适配到 0.1.2-alpha.2', phase: 'active' } }, plan: null } })
  assert.equal(banner.hidden, true)
  assert.equal(banner.childNodes.length, 0)

  // 计划模式仍然显示，且不再有"关闭"按钮（目标横幅那个 × 已随目标横幅一起删除）。
  dispatch({ type: 'stats', sessionId: 'S-1', stats: { plan: { active: true }, goal: { goal: { objective: 'x' } } } })
  assert.equal(banner.hidden, false)
  const walk = (node, out = []) => { for (const child of node.childNodes || []) { out.push(child); walk(child, out) } return out }
  assert.ok(walk(banner).some((node) => node.textContent === '计划模式'))
  assert.equal(walk(banner).some((node) => String(node.className).includes('session-banner-close')), false)
  assert.equal(walk(banner).some((node) => String(node.textContent).includes('目标')), false)

  await new Promise((resolve) => setTimeout(resolve, 250))
})
