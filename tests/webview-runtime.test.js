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
  // 选项行现在带编号/说明（与网页端一致），按 data-label（原始 label，提交时用的就是它）点选。
  const option = (root, label) => walk(root).find((node) => node.tagName === 'BUTTON'
    && typeof node.getAttribute === 'function' && node.getAttribute('data-label') === label)
  const answers = () => posted.filter((message) => message.type === 'questionAnswer')
  const approvals = () => posted.filter((message) => message.type === 'approvalAnswer')

  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: 'S-1', conversation: [] })

  // 普通单选提问：点选项 → 点"提交回答"。
  dispatch({
    type: 'question', sessionId: 'S-1',
    pending: { eventId: 'e-1', questions: [{ id: 'q1', question: 'Q?', options: [{ label: '甲' }, { label: '乙' }] }] },
  })
  option(panel, '甲').click()
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

test('settings: the pending-notification mode lives in General and posts the chosen mode', async () => {
  const script = getBundleScript('notify-pending-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null, conversation: [], notifyPending: 'always' })
  dispatch({
    type: 'settingsData',
    data: { writable: true, hasDocument: true, connected: true, workspaces: [], version: '1.1.5', notifyPending: 'always' },
  })

  const walk = (node, out = []) => {
    for (const child of node.childNodes || []) { out.push(child); walk(child, out) }
    return out
  }
  const settings = context.document.getElementById('settingsContent')
  const texts = walk(settings).map((node) => node.textContent)
  assert.ok(texts.includes('等待操作提醒'), 'General 里要有"等待操作提醒"分区')
  const select = walk(settings).find((node) => node.tagName === 'SELECT' && (node.childNodes || []).length === 3)
  assert.ok(select, '要有三个模式的下来选单')
  assert.deepEqual(select.childNodes.map((option) => option.value), ['unfocused', 'always', 'off'])
  assert.deepEqual(
    select.childNodes.map((option) => option.textContent),
    ['窗口不在前台时提醒（推荐）', '总是提醒', '从不提醒'],
  )
  assert.equal(select.value, 'always', 'hydrate 下发的模式要反映到界面上')

  select.value = 'off'
  select.dispatchEvent({ type: 'change' })
  assert.deepEqual(
    posted.filter((message) => message.type === 'setNotifyPending').pop(),
    { type: 'setNotifyPending', value: 'off' },
  )

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('settings: the status bar entry toggle lives in General and posts the chosen value', async () => {
  const script = getBundleScript('status-bar-entry-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null, conversation: [] })
  dispatch({
    type: 'settingsData',
    data: { writable: true, hasDocument: true, connected: true, workspaces: [], version: '1.1.5', statusBarEntry: false },
  })

  const walk = (node, out = []) => {
    for (const child of node.childNodes || []) { out.push(child); walk(child, out) }
    return out
  }
  const settings = context.document.getElementById('settingsContent')
  const texts = walk(settings).map((node) => node.textContent)
  assert.ok(texts.includes('状态栏入口'), '通用里要有"状态栏入口"分区')
  assert.ok(texts.includes('在状态栏显示 dsh 入口'))

  // hydrate 下发的值要反映到勾选框上（默认开，显式 false 才是关）。
  const label = walk(settings).find((node) => node.tagName === 'LABEL' && walk(node).some((child) => child.textContent === '在状态栏显示 dsh 入口'))
  assert.ok(label, '要有"在状态栏显示 dsh 入口"勾选框')
  const check = walk(label).find((node) => node.tagName === 'INPUT')
  assert.equal(check.type, 'checkbox')
  assert.equal(check.checked, false, 'statusBarEntry=false 时勾选框不应被勾上')
  check.checked = true
  check.dispatchEvent({ type: 'change' })
  assert.deepEqual(
    posted.filter((message) => message.type === 'setStatusBarEntry').pop(),
    { type: 'setStatusBarEntry', value: true },
  )

  // 外部（VS Code 设置 UI）改动下发时不报错（界面状态在下次打开设置弹窗时按 settingsData 重建）。
  dispatch({ type: 'statusBarEntry', value: false })

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('multi-question pending: one question per page with pager, skip and per-question drafts', async () => {
  const script = getBundleScript('multi-question-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const walk = (node, out = []) => { for (const child of node.childNodes || []) { out.push(child); walk(child, out) } return out }
  const panel = context.document.getElementById('questionPanel')
  const texts = (root) => walk(root).map((node) => node.textContent).join('|')
  const button = (root, text) => walk(root).find((node) => node.tagName === 'BUTTON' && node.textContent === text)
  const option = (root, label) => walk(root).find((node) => node.tagName === 'BUTTON'
    && typeof node.getAttribute === 'function' && node.getAttribute('data-label') === label)
  // 页码在 <span class="q-page"> 里（不是按钮）。
  const hasText = (root, text) => walk(root).some((node) => node.textContent === text)
  const answers = () => posted.filter((message) => message.type === 'questionAnswer')

  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: 'S-1', conversation: [] })
  dispatch({
    type: 'question', sessionId: 'S-1',
    pending: {
      eventId: 'e-multi',
      questions: [
        { id: 'q1', header: '数据集目录', question: '“数据集目录”具体指哪一层？', options: [{ label: 'A. 真建数据集层' }, { label: 'B. 输入不动', description: '树结构不变' }, { label: 'D. 其他（推荐）' }] },
        { id: 'q2', question: '参数表落在哪一层？', options: [{ label: '两级' }, { label: '单级' }] },
        { id: 'q3', question: '并发模型怎么定？', options: [{ label: '进程池' }, { label: '多线程' }, { label: '先不做（推荐）' }] },
      ],
    },
  })

  // 一页只呈现一题（web 端那种多层提问），底部是 1/3 + 跳过本题 + 下一题。
  assert.equal(texts(panel).includes('数据集目录'), true, '分组标签要显示')
  assert.equal(texts(panel).includes('“数据集目录”具体指哪一层？'), true)
  assert.equal(texts(panel).includes('参数表落在哪一层？'), false, '第 2 题不该同时出现')
  assert.ok(hasText(panel, '1/3'), '要显示进度 1/3')
  assert.ok(button(panel, '跳过本题'))
  assert.ok(button(panel, '下一题'), '非最后一页是"下一题"')
  // 选项行：编号 + 标签 +（推荐）徽标拆出来，说明单独一行；data-label 保留原始 label。
  assert.equal(walk(panel).some((node) => node.textContent === '1'), true, '选项要有编号')
  assert.equal(walk(panel).some((node) => node.className === 'q-option-badge' && node.textContent === '推荐'), true)
  assert.equal(walk(panel).some((node) => node.className === 'q-option-desc' && node.textContent === '树结构不变'), true)
  assert.equal(option(panel, 'D. 其他（推荐）') !== undefined, true, '提交用的仍是原始 label')

  // 未处理就点"下一题"会被拦住（停在本题并提示）。
  button(panel, '下一题').click()
  assert.ok(hasText(panel, '1/3'), '仍在第 1 题')
  assert.equal(answers().length, 0)
  assert.ok(walk(panel).some((node) => node.className === 'q-error' && String(node.textContent).includes('跳过本题')))

  // 单选后自动翻页（web 端行为）。
  option(panel, 'B. 输入不动').click()
  assert.ok(hasText(panel, '2/3'), '选完单选自动到第 2 题')

  // 第 2 题填自定义回答，回车 → 第 3 题；再翻回去草稿还在。
  const custom = walk(panel).find((node) => node.className === 'q-custom-input')
  custom.value = '两级：全局默认 + 数据集表'
  custom.dispatchEvent({ type: 'input' })
  custom.dispatchEvent({ type: 'keydown', key: 'Enter' })
  assert.ok(hasText(panel, '3/3'), '回车翻到第 3 题')
  button(panel, '‹').click()
  assert.ok(hasText(panel, '2/3'), '翻回第 2 题')
  assert.equal(walk(panel).find((node) => node.className === 'q-custom-input').value, '两级：全局默认 + 数据集表', '草稿跨页保留')

  // 最后一页按钮是"提交回答"；当前页没处理会被拦住（停在本题并提示）。
  button(panel, '›').click()
  assert.ok(button(panel, '提交回答'), '最后一页是"提交回答"')
  button(panel, '提交回答').click()
  assert.equal(answers().length, 0, '当前题没处理就不提交')
  assert.ok(hasText(panel, '3/3'), '停在未处理的第 3 题')
  assert.ok(walk(panel).some((node) => node.className === 'q-error' && String(node.textContent).includes('还没处理')))

  // 跳过本题 = 显式空回答，然后提交。
  button(panel, '跳过本题').click()
  assert.equal(answers().length, 1, '最后一题跳过即直接提交（与 web 端一致）')
  assert.deepEqual(answers()[0].answers, [
    { id: 'q1', selected: ['B. 输入不动'] },
    { id: 'q2', selected: [], custom: '两级：全局默认 + 数据集表' },
    { id: 'q3', selected: [] },
  ])

  // 宿主确认后收起；换一个请求（新 eventId）时草稿与页码重置。
  dispatch({ type: 'question', sessionId: 'S-1', pending: null })
  dispatch({
    type: 'question', sessionId: 'S-1',
    pending: { eventId: 'e-next', questions: [{ id: 'n1', question: '新问题一', options: [{ label: 'x' }] }, { id: 'n2', question: '新问题二', options: [{ label: 'y' }] }] },
  })
  assert.ok(hasText(panel, '1/2'), '新请求从第 1 页开始')

  // 用翻页箭头跳过第 1 题、在第 2 题提交 → 会被拉回未处理的那一页并点名题号。
  button(panel, '›').click()
  assert.ok(hasText(panel, '2/2'))
  option(panel, 'y').click()
  const submitted = answers().length
  button(panel, '提交回答').click()
  assert.equal(answers().length, submitted, '还有未处理的题就不提交')
  assert.ok(hasText(panel, '1/2'), '被拉回未处理的那一页')
  assert.ok(walk(panel).some((node) => node.className === 'q-error' && String(node.textContent).includes('第 1 题')))
  button(panel, '跳过本题').click()
  assert.ok(hasText(panel, '2/2'), '跳过第 1 题后前进到第 2 题')
  button(panel, '提交回答').click()
  assert.equal(answers().length, submitted + 1, '全部处理完才提交')
  assert.deepEqual(answers()[submitted].answers, [{ id: 'n1', selected: [] }, { id: 'n2', selected: ['y'] }])

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('single-question pending keeps the plain panel (no pager)', async () => {
  const script = getBundleScript('single-question-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const walk = (node, out = []) => { for (const child of node.childNodes || []) { out.push(child); walk(child, out) } return out }
  const panel = context.document.getElementById('questionPanel')
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: 'S-1', conversation: [] })
  dispatch({
    type: 'question', sessionId: 'S-1',
    pending: { eventId: 'e-one', questions: [{ id: 'q1', question: '只有一个问题？', options: [{ label: '是' }, { label: '否' }] }] },
  })
  const texts = walk(panel).map((node) => node.textContent)
  assert.equal(texts.includes('1/1'), false, '单题不显示分页')
  assert.equal(texts.includes('跳过本题'), false, '单题保持原来的面板')
  assert.ok(walk(panel).find((node) => node.tagName === 'BUTTON' && node.textContent === '提交回答'))

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('language: switching to English leaves no Chinese in time labels, todo bar, model dropdown or static tooltips', async () => {
  const script = getBundleScript('i18n-leak-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const doc = context.document
  const walk = (node, out = []) => { for (const child of node.childNodes || []) { out.push(child); walk(child, out) } return out }
  const CJK = /[\u4e00-\u9fff]/

  // 5 分钟前修改过的会话（相对时间走 t('timeMinutes')）+ 一条计划 + 空模型目录。
  const fiveMinAgo = Date.now() - 5 * 60 * 1000
  dispatch({
    type: 'hydrate', status: 'ready', workspace: null, selectedSessionId: 'S-1', conversation: [],
    sessions: [{ sessionId: 'S-1', displayTitle: 'my-app', running: false, blank: false, updatedAt: fiveMinAgo, archived: false }],
  })
  dispatch({ type: 'language', value: 'en' })
  dispatch({
    type: 'stats', sessionId: 'S-1',
    stats: { todos: [{ id: 't1', content: 'x', status: 'completed' }], permissions: { options: [{ value: 'read-only', name: 'read-only' }], currentValue: 'read-only' } },
  })
  dispatch({ type: 'models', sessionId: 'S-1', models: { groups: [], current: null } })

  const firstRow = () => doc.getElementById('drawerList').childNodes
    .find((node) => node && String(node.className || '').startsWith('drawer-item'))
  const meta = firstRow().childNodes[1].childNodes[1].textContent
  assert.equal(meta, '5 min ago', '抽屉里的相对时间要跟着语言走')
  assert.equal(CJK.test(meta), false)

  const todoText = () => walk(doc.getElementById('todoDock')).map((node) => node.textContent).join(' ')
  assert.ok(todoText().includes('Plan'), '计划条标题要本地化')
  assert.ok(todoText().includes('1 done'), '计划条统计要本地化')
  assert.equal(CJK.test(todoText()), false, '计划条不得残留中文：' + todoText())

  const modelOptions = walk(doc.getElementById('modelSelect')).map((node) => node.textContent)
  assert.ok(modelOptions.includes('No models'))
  assert.equal(CJK.test(modelOptions.join(' ')), false)

  // body.html 里静态写死的中文 tooltip / 分组标题同样要跟着语言走。
  assert.equal(doc.getElementById('imageBtn').title, 'Pick image')
  assert.equal(doc.getElementById('fileBtn').title, 'Attach file')
  assert.equal(doc.getElementById('modelSelect').title, 'Select model')
  assert.equal(doc.getElementById('effortSelect').title, 'Select reasoning effort')
  assert.equal(doc.getElementById('permissionGroupTitle').textContent, 'Permission / Mode')
  assert.equal(doc.getElementById('settingsClose').title, 'Close')
  assert.equal(doc.getElementById('archiveClose').title, 'Close')

  // fork 的面板内提示也不再写死中文。
  dispatch({ type: 'forkDone', title: 'my-app (fork)' })
  const toastText = walk(doc.getElementById('toast')).map((node) => node.textContent).join('')
  assert.ok(toastText.includes('Forked: my-app (fork)'), toastText)

  // 切回中文时相对时间/计划条也要复原。
  dispatch({ type: 'language', value: 'zh' })
  assert.equal(firstRow().childNodes[1].childNodes[1].textContent, '5 分钟前')
  assert.ok(todoText().includes('1 已完成'), todoText())
  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('drawer rows show an alarm-clock marker when the session has an active scheduled task', async () => {
  const script = getBundleScript('schedule-badge-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const walk = (node, out = []) => { for (const child of node.childNodes || []) { out.push(child); walk(child, out) } return out }

  // "下一条"用今天的某个时刻：同一天只显示 HH:mm。
  const soon = new Date()
  soon.setHours(23, 5, 0, 0)
  const sessions = [
    { sessionId: 'S-1', displayTitle: '有定时任务', running: false, blank: false, updatedAt: Date.now(), archived: false, scheduleCount: 2, nextScheduleAt: soon.toISOString() },
    { sessionId: 'S-2', displayTitle: '没有定时任务', running: false, blank: false, updatedAt: Date.now(), archived: false, scheduleCount: 0, nextScheduleAt: null },
  ]
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions, selectedSessionId: 'S-1', conversation: [] })

  const rowsOf = () => context.document.getElementById('drawerList').childNodes
    .filter((node) => node && String(node.className || '').startsWith('drawer-item'))
  const rowById = (id) => rowsOf().find((row) => row.getAttribute('data-session-id') === id)
  const indicatorOf = (row) => walk(row).find((node) => String(node.className) === 'drawer-schedule')

  const indicator = indicatorOf(rowById('S-1'))
  assert.ok(indicator, '有活动定时任务的行要有闹钟标记')
  assert.equal(indicator.textContent, '⏰')
  assert.match(indicator.title, /有活动定时任务/)
  assert.match(indicator.title, /2 个/)
  assert.match(indicator.title, /下一条 23:05/)
  assert.equal(indicator.getAttribute('aria-label'), '有活动定时任务')
  assert.equal(indicatorOf(rowById('S-2')), undefined, '没有定时任务的行不显示标记')

  // 英文界面下说明文案跟着走。
  dispatch({ type: 'language', value: 'en' })
  const enIndicator = indicatorOf(rowById('S-1'))
  assert.match(enIndicator.title, /Has active scheduled task/)
  assert.match(enIndicator.title, /2 active/)
  assert.match(enIndicator.title, /next 23:05/)

  // 投影被清空后标记随之消失（宿主会重发 sessions 帧）。
  dispatch({ type: 'sessions', sessions: [{ ...sessions[0], scheduleCount: 0, nextScheduleAt: null }, sessions[1]], selectedSessionId: 'S-1' })
  assert.equal(indicatorOf(rowById('S-1')), undefined)

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('drawer: only the first five ordinary sessions show until "show more" is clicked', async () => {
  const script = getBundleScript('drawer-collapse-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const walk = (node, out = []) => { for (const child of node.childNodes || []) { out.push(child); walk(child, out) } return out }

  // 7 个普通会话 + 1 个空白「新会话」占位（空白不计入 5 条额度、始终显示）。
  const sessions = []
  for (let i = 1; i <= 7; i++) {
    sessions.push({ sessionId: `S-${i}`, displayTitle: `sess-${i}`, running: false, blank: false, updatedAt: 1000 - i, archived: false })
  }
  sessions.push({ sessionId: 'S-blank', displayTitle: '新会话', running: false, blank: true, updatedAt: 1, archived: false })
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions, selectedSessionId: 'S-1', conversation: [] })

  const drawerList = context.document.getElementById('drawerList')
  const ids = () => drawerList.childNodes
    .filter((node) => node && String(node.className || '').startsWith('drawer-item'))
    .map((row) => row.getAttribute('data-session-id'))
  const moreBtn = () => drawerList.childNodes.find((node) => node && String(node.className) === 'drawer-more')

  assert.deepEqual(ids(), ['S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-blank'], '普通会话只显示前 5 条，空白会话始终在')
  assert.equal(moreBtn().textContent, '展开其余 2 个会话')
  assert.equal(moreBtn().getAttribute('aria-expanded'), 'false')

  moreBtn().click()
  assert.equal(ids().length, 8, '展开后全部显示')
  assert.equal(ids().includes('S-7'), true)
  assert.equal(moreBtn().textContent, '收起')
  assert.equal(moreBtn().getAttribute('aria-expanded'), 'true')

  moreBtn().click()
  assert.deepEqual(ids(), ['S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-blank'], '再点一次收起来')

  // 标题过滤期间不折叠：正在找会话时不该把匹配结果藏起来
  // （空白会话标题是「新会话」，不匹配 'sess-'，所以这里只剩 7 条匹配）。
  const search = context.document.getElementById('drawerSearch')
  search.value = 'sess-'
  search.dispatchEvent({ type: 'input' })
  assert.equal(ids().length, 7)
  assert.equal(ids().includes('S-7'), true, '过滤时要能看到全部匹配')
  assert.equal(moreBtn(), undefined, '过滤时不显示折叠按钮')
  search.value = ''
  search.dispatchEvent({ type: 'input' })

  // 选中的会话正好被折叠掉（例如从通知/搜索切过来）→ 自动展开，不让选中的行看不见。
  dispatch({ type: 'selectedSession', sessionId: 'S-7' })
  dispatch({ type: 'sessions', sessions, selectedSessionId: 'S-7' })
  assert.equal(ids().includes('S-7'), true, '选中被折叠的会话要自动展开')
  assert.equal(moreBtn().textContent, '收起')

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('prompt stash: the take-back button swaps the box with the composer draft', async () => {
  const script = getBundleScript('stash-take-back-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }
  const walk = (node, out = []) => { for (const child of node.childNodes || []) { out.push(child); walk(child, out) } return out }
  const doc = context.document
  const composer = doc.getElementById('composerInput')
  const stashRows = () => doc.getElementById('promptStash').childNodes
    .filter((node) => node && String(node.className) === 'stash-row')
  const takeBackOf = (row) => walk(row).find((node) => String(node.className) === 'stash-take-back')
  const inputOf = (row) => walk(row).find((node) => String(node.className) === 'stash-input')

  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions: [], selectedSessionId: null, conversation: [] })
  dispatch({
    type: 'promptStash',
    enabled: true,
    items: [{ id: 'a', text: '暂存里的提示词', images: [] }, { id: 'b', text: '', images: [] }],
  })

  // 按钮位置：发送 与 删除 之间。
  const buttons = walk(stashRows()[0]).filter((node) => node.tagName === 'BUTTON').map((node) => String(node.className))
  assert.deepEqual(buttons, ['stash-send', 'stash-take-back', 'stash-remove'])
  assert.equal(takeBackOf(stashRows()[0]).textContent, '⇄', '互换图标（不是单向的 ↩）')
  assert.match(takeBackOf(stashRows()[0]).title, /^与主输入框互换/)
  // 两边都有内容 / 只有一边有内容时都可点；都空时禁用（第二个框空 + composer 空）。
  assert.equal(takeBackOf(stashRows()[0]).disabled, false)
  assert.equal(takeBackOf(stashRows()[1]).disabled, true)

  // 输入框为空：把暂存内容搬进 composer，这个框变空（框本身保留）。
  takeBackOf(stashRows()[0]).click()
  assert.equal(composer.value, '暂存里的提示词')
  assert.equal(inputOf(stashRows()[0]).value, '')
  // 框空了但输入框里有内容 → 放回按钮仍可点（再点一次就把草稿换回框里）。
  assert.equal(takeBackOf(stashRows()[0]).disabled, false)
  assert.equal(stashRows().length, 2, '放回不会删除暂存框')

  // 输入框里已经有草稿：两者互换（旧草稿进暂存框，接着还能改）。
  composer.value = '正在写的新草稿'
  dispatch({ type: 'promptStash', enabled: true, items: [{ id: 'a', text: '暂存里的提示词', images: [] }, { id: 'b', text: '', images: [] }] })
  takeBackOf(stashRows()[0]).click()
  assert.equal(composer.value, '暂存里的提示词')
  assert.equal(inputOf(stashRows()[0]).value, '正在写的新草稿')
  // 换回去也是互换（第二次点击把草稿换回来）。
  takeBackOf(stashRows()[0]).click()
  assert.equal(composer.value, '正在写的新草稿')
  assert.equal(inputOf(stashRows()[0]).value, '暂存里的提示词')

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('goal bar: renders the ongoing goal, switches pause/resume by activation, and edits inline', async () => {
  const script = getBundleScript('goal-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }

  dispatch({
    type: 'hydrate', status: 'ready', workspace: null,
    sessions: [{ sessionId: 'S-1', displayTitle: 'proj', running: false, updatedAt: 1, archived: false }],
    selectedSessionId: 'S-1', conversation: [],
  })

  const dock = context.document.getElementById('goalDock')
  const partOf = (row, className) => (row.childNodes || [])
    .find((node) => node && String(node.className || '').split(' ').indexOf(className) >= 0)
  const bar = () => dock.childNodes[0]
  const actions = () => partOf(bar(), 'goal-actions')
  const actionGlyphs = () => (actions().childNodes || []).map((node) => node.textContent)
  const actionAt = (index) => actions().childNodes[index]
  const messagesOf = (type) => posted.filter((message) => message && message.type === type)
  const statsFrame = (goalProjection, goalActivation) => ({
    type: 'stats', sessionId: 'S-1',
    stats: { goal: goalProjection, goalActivation },
  })
  const goalOf = (over = {}) => ({
    goal: { id: 'G-1', revision: 3, objective: '让 Bosch16 全量重下按新配置跑完', phase: 'active', maxGoalRounds: 10, ...over },
    roundsStarted: 1, createdAt: 1, updatedAt: 2,
  })

  // 没有任何目标：整条不渲染。
  assert.equal(dock.classList.contains('open'), false)
  assert.equal(dock.childNodes.length, 0)

  // 进行中且正在自动续行（armed）：标题 + 目标内容 + 暂停/编辑/清除。
  dispatch(statsFrame(goalOf(), 'armed'))
  assert.equal(dock.classList.contains('open'), true, 'active goal shows the strip')
  assert.equal(partOf(bar(), 'goal-label').textContent, '进行中的目标')
  assert.equal(partOf(bar(), 'goal-text').textContent, '让 Bosch16 全量重下按新配置跑完')
  assert.equal(bar().title, '让 Bosch16 全量重下按新配置跑完', 'hover shows the full objective')
  assert.deepEqual(actionGlyphs(), ['⏸', '✎', '🗑'])
  assert.equal(actionAt(0).title, '暂停目标')
  assert.equal(actionAt(2).title, '清除目标')

  // 点暂停：把变更交给宿主（带会话 id），请求在途期间按钮禁用。
  actionAt(0).click()
  assert.equal(messagesOf('goalPause').length, 1)
  assert.equal(messagesOf('goalPause')[0].sessionId, 'S-1')
  assert.equal(actionAt(0).disabled, true, '按钮在宿主回帧前禁用（避免重复提交同一 CAS）')

  // 宿主回来的新统计（已暂停）解除 pending，并把暂停换成恢复。
  dispatch(statsFrame(goalOf({ phase: 'paused' }), 'disarmed'))
  assert.equal(partOf(bar(), 'goal-label').textContent, '已暂停的目标')
  assert.deepEqual(actionGlyphs(), ['▶', '✎', '🗑'])
  assert.equal(actionAt(0).disabled, false)
  actionAt(0).click()
  assert.equal(messagesOf('goalResume').length, 1)

  // active 但未在自动续行（disarmed）：文案与按钮都按"未运行"来（与 Web UI 同口径）。
  dispatch(statsFrame(goalOf(), 'disarmed'))
  assert.equal(partOf(bar(), 'goal-label').textContent, '未运行的目标')
  assert.deepEqual(actionGlyphs(), ['▶', '✎', '🗑'])

  // activation 还没读到（宿主补读在途）：只给编辑/清除，不猜暂停还是恢复。
  dispatch(statsFrame(goalOf(), null))
  assert.equal(partOf(bar(), 'goal-label').textContent, '进行中的目标')
  assert.deepEqual(actionGlyphs(), ['✎', '🗑'])

  // 编辑：行内输入框带原目标；Enter 提交给宿主。
  dispatch(statsFrame(goalOf(), 'armed'))
  actionAt(1).click()
  const input = partOf(bar(), 'goal-input')
  assert.ok(input, '编辑态在同一行内出现输入框')
  assert.equal(input.value, '让 Bosch16 全量重下按新配置跑完')
  assert.deepEqual(actionGlyphs(), ['✓', '✕'])
  // 草稿为空时"保存"禁用（网页端同样不给保存空目标），写上内容后恢复可点。
  input.value = '   '
  input.dispatchEvent({ type: 'input' })
  assert.equal(actionAt(0).disabled, true, '空草稿不能保存')
  input.value = '改后的目标'
  input.dispatchEvent({ type: 'input' })
  assert.equal(actionAt(0).disabled, false)
  // 编辑期间来新统计帧：输入框不能重建（否则用户正在写的草稿会被冲掉）。
  dispatch(statsFrame(goalOf(), 'armed'))
  assert.equal(partOf(bar(), 'goal-input').value, '改后的目标', '输入草稿必须保住')
  partOf(bar(), 'goal-input').dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} })
  assert.equal(messagesOf('goalEdit').length, 1)
  assert.equal(messagesOf('goalEdit')[0].objective, '改后的目标')
  assert.equal(messagesOf('goalEdit')[0].sessionId, 'S-1')

  // Escape 取消编辑：回到展示行，且不发 RPC。
  dispatch(statsFrame(goalOf(), 'armed'))
  actionAt(1).click()
  partOf(bar(), 'goal-input').dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} })
  assert.equal(partOf(bar(), 'goal-label').textContent, '进行中的目标')
  assert.equal(messagesOf('goalEdit').length, 1, 'Escape 不发变更请求')

  // 宿主拒绝变更：错误内联显示在目标条上，按钮恢复可点。
  dispatch({ type: 'goalActionError', sessionId: 'S-1', message: 'stale revision (stale-revision)' })
  assert.equal(partOf(bar(), 'goal-error').textContent, 'stale revision (stale-revision)')
  assert.equal(actionAt(0).disabled, false)

  // 清除：交给宿主；随后的统计帧里没有目标 → 整条消失（错误也一并清掉）。
  actionAt(2).click()
  assert.equal(messagesOf('goalClear').length, 1)
  dispatch(statsFrame(null, null))
  assert.equal(dock.classList.contains('open'), false)
  assert.equal(dock.childNodes.length, 0)

  // 已完成的目标不渲染（与 Web UI 一致）。
  dispatch(statsFrame(goalOf({ phase: 'complete' }), 'disarmed'))
  assert.equal(dock.classList.contains('open'), false)

  // 英文界面：文案随语言切换（切换语言要重渲染目标条）。
  dispatch(statsFrame(goalOf(), 'armed'))
  dispatch({ type: 'language', value: 'en' })
  assert.equal(partOf(bar(), 'goal-label').textContent, 'Ongoing Goal')
  assert.equal(actionAt(0).title, 'Pause goal')

  await new Promise((resolve) => setTimeout(resolve, 250))
})
