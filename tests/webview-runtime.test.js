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

test('session drawer: forked sessions render exactly like normal sessions; only subagents nest', async () => {
  const script = getBundleScript('lineage-nonce')
  const posted = []
  const listeners = []
  const context = vm.createContext(makeFakeDom(posted, listeners))
  vm.runInContext(script, context, { timeout: 10_000 })
  const dispatch = (message) => { for (const listener of listeners) listener({ data: message }) }

  // dsh 的会话列表里：fork 出来的会话只有 parentSessionId（origin 为空），
  // 子代理会话才有 origin:'subagent'；fork 可以再 fork，子代理也可以再派子代理。
  const sessions = [
    { sessionId: 'S-root', displayTitle: 'anchored-standard维护', running: false, blank: false, updatedAt: 1, archived: false },
    { sessionId: 'S-fork', displayTitle: '会话（fork 02:15）', parentSessionId: 'S-root', running: false, blank: false, updatedAt: 2, archived: false },
    { sessionId: 'S-fork2', displayTitle: '会话（fork 02:40）', parentSessionId: 'S-fork', running: false, blank: false, updatedAt: 3, archived: false },
    { sessionId: 'S-sub', displayTitle: 'subagent', parentSessionId: 'S-root', origin: 'subagent', running: true, blank: false, updatedAt: 4, archived: false },
    { sessionId: 'S-sub2', displayTitle: 'subagent-2', parentSessionId: 'S-sub', origin: 'subagent', running: false, blank: false, updatedAt: 5, archived: false },
  ]
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions, selectedSessionId: 'S-root', conversation: [] })

  const rows = context.document.getElementById('drawerList').childNodes
    .filter((node) => node && String(node.className || '').startsWith('drawer-item'))
  assert.deepEqual(
    rows.map((row) => row.getAttribute('data-session-id')),
    ['S-root', 'S-sub', 'S-sub2', 'S-fork', 'S-fork2'],
    'only subagents follow their parent; forked sessions stay top-level (and must never disappear)',
  )
  const metaOf = (row) => row.childNodes[1].childNodes[1].textContent
  const actionKinds = (row) => {
    const actions = (row.childNodes || []).find((node) => node && String(node.className) === 'drawer-actions')
    return actions ? actions.childNodes.map((btn) => btn.getAttribute('data-action')) : []
  }

  // 分支会话 = 普通会话：不缩进、不带任何"分支"标记、操作与顶层会话完全一致。
  for (const forkRow of [rows[3], rows[4]]) {
    assert.equal(forkRow.style.paddingLeft, undefined, 'a forked session must not be indented')
    assert.ok(!String(forkRow.className).includes('drawer-child'))
    assert.ok(!String(forkRow.className).includes('drawer-subagent'))
    assert.ok(!metaOf(forkRow).includes('分支会话'), 'forked sessions are no longer distinguished')
    assert.deepEqual(actionKinds(forkRow), ['forkSession', 'renameSession', 'closeSession'])
  }

  // 只有子代理会话嵌套（含子代理的子代理），标"子代理会话"且只给视图级提升操作。
  assert.match(metaOf(rows[1]), /^子代理会话/)
  assert.equal(rows[1].style.paddingLeft, '22px')
  assert.deepEqual(actionKinds(rows[1]), ['promoteSession'])
  assert.match(metaOf(rows[2]), /^子代理会话/)
  assert.equal(rows[2].style.paddingLeft, '36px', 'depth 2 indents deeper than depth 1')

  await new Promise((resolve) => setTimeout(resolve, 250))
})

test('session drawer: a subagent session can be promoted to a top-level row (plugin view) and restored', async () => {
  const script = getBundleScript('promote-nonce')
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

  const sessions = [
    { sessionId: 'S-root', displayTitle: 'root', running: false, blank: false, updatedAt: 1, archived: false },
    { sessionId: 'S-sub', displayTitle: 'subagent', parentSessionId: 'S-root', origin: 'subagent', running: false, blank: false, updatedAt: 2, archived: false },
  ]
  // dsh 的谱系不可改（header.parentSession 只在创建时写入），提升只是插件视图内的显示开关；
  // 分支会话已按普通会话顶层显示，所以只有子代理会话还需要这个开关。
  dispatch({ type: 'hydrate', status: 'ready', workspace: null, sessions, selectedSessionId: 'S-root', conversation: [] })
  assert.match(metaOf(rowsOf()[1]), /^子代理会话/)

  // 事件委托：点行本身 = 选中会话，点行内按钮 = 执行该动作。
  rowsOf()[1].click()
  assert.deepEqual(
    posted.filter((message) => message.type === 'selectSession').pop(),
    { type: 'selectSession', sessionId: 'S-sub' },
  )

  actionButton(rowsOf()[1], 'promoteSession').click()
  assert.deepEqual(
    posted.filter((message) => message.type === 'promoteSession').pop(),
    { type: 'promoteSession', sessionId: 'S-sub', promoted: true },
  )

  // 宿主落盘后回推的列表带 promotedLocally：该会话变成顶层行（无缩进），并给出"恢复层级"。
  dispatch({
    type: 'sessions', selectedSessionId: 'S-root',
    sessions: [sessions[0], { ...sessions[1], promotedLocally: true }],
  })
  const promotedRow = rowsOf()[1]
  assert.equal(promotedRow.style.paddingLeft, undefined, 'a promoted session must render as a top-level row')
  assert.ok(!String(promotedRow.className).includes('drawer-child'))
  assert.ok(metaOf(promotedRow).includes('已提升为普通会话'))
  assert.ok(actionButton(promotedRow, 'demoteSession'), 'a promoted row must offer "restore nesting"')

  actionButton(promotedRow, 'demoteSession').click()
  assert.deepEqual(
    posted.filter((message) => message.type === 'promoteSession').pop(),
    { type: 'promoteSession', sessionId: 'S-sub', promoted: false },
  )

  // 恢复层级后重新嵌套回父会话下面。
  dispatch({ type: 'sessions', selectedSessionId: 'S-root', sessions })
  assert.match(metaOf(rowsOf()[1]), /^子代理会话/)
  assert.equal(rowsOf()[1].style.paddingLeft, '22px')

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

  assert.equal(modeOf(rowsOf()[0]).textContent, '锚定标准模式', 'custom presets use the host catalog name')
  assert.equal(modeOf(rowsOf()[0]).title, '会话模式：锚定标准模式')
  assert.equal(modeOf(rowsOf()[1]).textContent, 'PTC 模式', 'built-in ids fall back to the localized short name')
  assert.equal(modeOf(rowsOf()[2]), null, 'sessions without an agent preset show no mode label')
  assert.equal(modeOf(rowsOf()[3]).textContent, '极简模式', 'the projection value alone is enough')

  // 界面语言切换后标签跟着变（内置短名本地化；宿主目录名原样保留）。
  dispatch({ type: 'language', value: 'en' })
  assert.equal(modeOf(rowsOf()[1]).textContent, 'PTC Mode')
  assert.equal(modeOf(rowsOf()[0]).textContent, '锚定标准模式')

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
