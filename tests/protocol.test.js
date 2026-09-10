'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const {
  goalBannerFingerprint,
  workspaceTitleOf,
  sessionDisplayTitleOf,
  buildQuestionOutcome,
  buildApprovalOutcome,
  buildEventRejection,
  isSubagentSession,
  normalizePromptStashEntries,
  mergePromptStashTexts,
  applySessionActivity,
} = require('../src/protocol.js')

test('workspaceTitleOf takes the last segment for both separators', () => {
  assert.equal(workspaceTitleOf('/home/me/projects/dsh-vsc/'), 'dsh-vsc')
  assert.equal(workspaceTitleOf('C:\\work\\my-app'), 'my-app')
  assert.equal(workspaceTitleOf('plain'), 'plain')
  assert.equal(workspaceTitleOf(''), '')
})

test('sessionDisplayTitleOf mirrors the dsh web chain (title → cwd basename → id)', () => {
  assert.equal(sessionDisplayTitleOf({ title: 'T', cwd: '/x/y', sessionId: 'session-1' }), 'T')
  assert.equal(
    sessionDisplayTitleOf({ projections: { values: { title: 'projected' } }, cwd: '/x/y', sessionId: 'session-1' }),
    'projected',
  )
  assert.equal(sessionDisplayTitleOf({ cwd: '/home/me/my-app', sessionId: 'session-1' }), 'my-app')
  assert.equal(sessionDisplayTitleOf({ sessionId: 'session-1' }), 'session-1')
  // 空白会话由 UI 本地化为"新会话"。
  assert.equal(sessionDisplayTitleOf({ blank: true, cwd: '/home/me/my-app', sessionId: 'session-1' }), '')
  assert.equal(sessionDisplayTitleOf(null), '')
})

test('waterfall outcomes use the 0.1.5 answer encodings', () => {
  const answers = [{ id: 'q1', selected: ['a'], custom: 'x' }]
  assert.deepEqual(buildQuestionOutcome(answers), { kind: 'result', value: { answers } })
  assert.deepEqual(buildApprovalOutcome('allowed-once'), { kind: 'result', value: 'allowed-once' })
  assert.deepEqual(buildEventRejection('nope', 'cancelled'), {
    kind: 'rejected',
    error: { name: 'Error', message: 'nope', code: 'cancelled', details: {} },
  })
})

test('isSubagentSession detects subagent rows', () => {
  assert.equal(isSubagentSession({ origin: 'subagent' }), true)
  assert.equal(isSubagentSession({ origin: 'user' }), false)
  assert.equal(isSubagentSession(null), false)
})

test('goalBannerFingerprint changes when the goal updates and is null without a goal', () => {
  const base = { goal: { objective: 'ship it', phase: 'active' }, roundsStarted: 2 }
  assert.equal(goalBannerFingerprint(base), goalBannerFingerprint({ goal: { objective: 'ship it', phase: 'active' }, roundsStarted: 2 }))
  assert.notEqual(goalBannerFingerprint(base), goalBannerFingerprint({ goal: { objective: 'ship it', phase: 'complete' }, roundsStarted: 3 }))
  assert.notEqual(goalBannerFingerprint(base), goalBannerFingerprint({ goal: { objective: 'other', phase: 'active' }, roundsStarted: 2 }))
  assert.equal(goalBannerFingerprint(null), null)
  assert.equal(goalBannerFingerprint({}), null)
})

test('normalizePromptStashEntries upgrades legacy strings, keeps empty slots, no count limit', () => {
  // 旧版纯字符串条目（1.1.2 早期只存文本）升级成 {id:'',text,images:[]}。
  assert.deepEqual(normalizePromptStashEntries(['a', '', 'c']), [
    { id: '', text: 'a', images: [] },
    { id: '', text: '', images: [] },
    { id: '', text: 'c', images: [] },
  ]);
  // 空文本是"已创建但没写内容"的暂存槽，必须保留（否则空框重载后消失）。
  assert.deepEqual(normalizePromptStashEntries([null, undefined]).map((entry) => entry.text), ['', '']);
  // 数量不设上限（用户要求取消 5 个的限制）。
  const many = Array.from({ length: 200 }, (_, i) => ({ id: 's' + i, text: 'p' + i }))
  assert.equal(normalizePromptStashEntries(many).length, 200)
  // 图片附件规整：缺 data/mediaType 的条目丢弃。
  const withImages = normalizePromptStashEntries([{
    id: 'a', text: 'x',
    images: [{ mediaType: 'image/png', data: 'QUJD', name: 'n.png' }, { mediaType: 'image/png' }, null, { data: 'x' }],
  }])
  assert.deepEqual(withImages[0].images, [{ mediaType: 'image/png', data: 'QUJD', name: 'n.png' }])
  // 只有单条文本长度兜底。
  assert.equal(normalizePromptStashEntries([{ id: 'a', text: 'x'.repeat(30000) }])[0].text.length, 20000)
  assert.deepEqual(normalizePromptStashEntries('not-an-array'), [])
})

test('mergePromptStashTexts updates text by id and keeps the host-side images', () => {
  const current = [
    { id: 'a', text: '旧', images: [{ mediaType: 'image/png', data: 'QUJD', name: '' }] },
    { id: 'b', text: 'b', images: [] },
  ]
  // webview 每次都上报完整 id 列表（顺序即显示顺序），未出现的条目视为已删除。
  const merged = mergePromptStashTexts(current, [{ id: 'a', text: '新' }, { id: 'b', text: 'b' }, { id: 'c', text: 'c' }])
  assert.equal(merged.length, 3)
  assert.equal(merged[0].text, '新')
  assert.equal(merged[0].images.length, 1, '打字防抖的文本更新不能丢掉图片')
  assert.deepEqual(merged[1], { id: 'b', text: 'b', images: [] })
  assert.deepEqual(merged[2], { id: 'c', text: 'c', images: [] }, '新框（未知 id）没有图片')
  assert.deepEqual(mergePromptStashTexts(current, [{ id: 'a', text: 'x' }]).length, 1, '未出现的条目视为已删除')
})

test('applySessionActivity merges plugin-observed activity and sorts by last modification', () => {
  const items = [
    { sessionId: 'A', updatedAt: 100 },
    { sessionId: 'B', updatedAt: 300 },
    { sessionId: 'C', updatedAt: 200 },
  ]
  // 没有活动信息时就是"按 updatedAt 降序"（dsh 自己的顺序也是这个，等于不变）。
  assert.deepEqual(applySessionActivity(items, new Map()).map((item) => item.sessionId), ['B', 'C', 'A'])

  // 插件观察到的活动时间（提示词/运行状态/新事件）把会话顶上去，并写回 updatedAt（相对时间随之更新）。
  const merged = applySessionActivity(items, new Map([['A', 500], ['C', 250]]))
  assert.deepEqual(merged.map((item) => item.sessionId), ['A', 'B', 'C'])
  assert.equal(merged[0].updatedAt, 500)
  assert.equal(merged[1].updatedAt, 300)
  assert.equal(merged[2].updatedAt, 250)

  // 活动时间比 dsh 的更旧时不回退。
  const noRegression = applySessionActivity(items, new Map([['B', 1]]))
  assert.equal(noRegression.find((item) => item.sessionId === 'B').updatedAt, 300)

  // 时间相同保持 dsh 原顺序（稳定排序，不抖动）。
  assert.deepEqual(
    applySessionActivity([{ sessionId: 'X', updatedAt: 5 }, { sessionId: 'Y', updatedAt: 5 }], new Map()).map((item) => item.sessionId),
    ['X', 'Y'],
  )

  // 普通对象也能当查询表；不改入参。
  const before = JSON.stringify(items)
  assert.equal(applySessionActivity(items, { A: 999 })[0].sessionId, 'A')
  assert.equal(JSON.stringify(items), before)
  assert.deepEqual(applySessionActivity(null, new Map()), [])
})
