'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PromptStashStore, migrateLegacyPromptStash, STASH_FILE_NAME } = require('../src/prompt-stash-store.js')

/** 每个用例一个临时目录（相当于 VS Code 的 `context.storageUri`）。 */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-vsc-stash-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** 一定时间内的竞速，避免监听没触发时把整个测试进程挂住。 */
function withTimeout(promise, ms, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
      timer.unref()
    }),
  ]).finally(() => clearTimeout(timer))
}

const image = { mediaType: 'image/png', data: 'QUJD', name: 'shot.png' }

test('save/load: 条目（含图片）完整往返，文件是带 version 的 JSON', (t) => {
  const dir = tempDir(t)
  const file = path.join(dir, STASH_FILE_NAME)
  const store = new PromptStashStore({ filePath: file })
  store.save([
    { id: 'a', text: '第一条', images: [image] },
    { id: 'b', text: '', images: [] },
  ])

  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(onDisk.version, 1)
  assert.deepEqual(onDisk.items.map((entry) => entry.id), ['a', 'b'])

  // 重新打开（新的窗口/重载）→ 内容还在，空槽也保留。
  const reopened = new PromptStashStore({ filePath: file })
  assert.deepEqual(reopened.load(), [
    { id: 'a', text: '第一条', images: [image] },
    { id: 'b', text: '', images: [] },
  ])
  // 没有残留的临时文件（原子写入）。
  assert.deepEqual(fs.readdirSync(dir), [STASH_FILE_NAME])
})

test('作用域: 不同工作区（不同存储目录）互不可见', (t) => {
  const left = path.join(tempDir(t), STASH_FILE_NAME)
  const right = path.join(tempDir(t), STASH_FILE_NAME)
  const a = new PromptStashStore({ filePath: left })
  const b = new PromptStashStore({ filePath: right })

  a.save([{ id: 'a1', text: '工作区 A 的草稿', images: [] }])
  assert.equal(a.load()[0].text, '工作区 A 的草稿')
  assert.deepEqual(b.load(), [], '另一个工作区不能看到 A 的暂存内容')

  b.save([{ id: 'b1', text: '工作区 B 的草稿', images: [] }])
  assert.equal(a.load()[0].text, '工作区 A 的草稿', 'B 的写入不会覆盖 A')
})

test('check(): 只有"别的窗口"写入才回调，自己的写入不回调', (t) => {
  const file = path.join(tempDir(t), STASH_FILE_NAME)
  const store = new PromptStashStore({ filePath: file })
  const seen = []
  store.onChange = (items) => seen.push(items)

  store.save([{ id: 'mine', text: '我写的', images: [] }])
  assert.equal(store.check(), false, '自己写的盘不该被当成外部改动')
  assert.deepEqual(seen, [])

  fs.writeFileSync(file, JSON.stringify({ version: 1, items: [{ id: 'other', text: '另一个窗口写的', images: [] }] }))
  assert.equal(store.check(), true)
  assert.deepEqual(seen.map((items) => items.map((entry) => entry.text)), [['另一个窗口写的']])
  assert.equal(store.load()[0].id, 'other')

  // 内容没变（同一个文件被重复 touch）→ 不再回调。
  assert.equal(store.check(), false)
  assert.equal(seen.length, 1)
})

test('watch(): 同一工作区的另一个窗口写入 → 本窗口收到通知', async (t) => {
  const file = path.join(tempDir(t), STASH_FILE_NAME)
  const store = new PromptStashStore({ filePath: file, watchDebounceMs: 20, holdEventLoop: true })
  t.after(() => store.dispose())

  let resolveChange
  const changed = new Promise((resolve) => { resolveChange = resolve })
  assert.equal(store.watch(() => resolveChange()), true, 'fs.watch 应该挂得上')

  fs.writeFileSync(file, JSON.stringify({ version: 1, items: [{ id: 'x', text: '跨窗口同步', images: [] }] }))
  await withTimeout(changed, 4000, '文件变化后 4s 内没有收到同步通知')
  assert.equal(store.load()[0].text, '跨窗口同步')
})

test('健壮性: 文件缺失可写、损坏不抛错、内存模式不落盘', (t) => {
  const dir = tempDir(t)
  const nested = path.join(dir, 'nested', 'deeper', STASH_FILE_NAME)
  const logs = []
  const fresh = new PromptStashStore({ filePath: nested, onLog: (line) => logs.push(line) })
  assert.deepEqual(fresh.load(), [], '文件不存在时是空列表')
  fresh.save([{ id: 'a', text: '新建', images: [] }])
  assert.equal(fresh.load()[0].text, '新建', '目录不存在时自动创建')

  const broken = path.join(dir, 'broken.json')
  fs.writeFileSync(broken, '{ not json')
  const brokenStore = new PromptStashStore({ filePath: broken, onLog: (line) => logs.push(line) })
  assert.deepEqual(brokenStore.load(), [])
  assert.equal(logs.length, 1)
  assert.match(logs[0], /解析失败/)

  const memory = new PromptStashStore({})
  assert.equal(memory.persistent, false)
  assert.deepEqual(memory.save([{ id: 'm', text: '内存', images: [] }]).map((entry) => entry.text), ['内存'])
  assert.equal(memory.watch(() => {}), false, '没有文件时不挂监听')
})

test('迁移: 旧版全局共享内容只搬一次，搬完清掉旧键', (t) => {
  const legacyKey = 'dsh-vsc.promptStash'
  const migratedKey = 'dsh-vsc.promptStashScoped'
  const legacyItems = [{ id: 'old', text: '旧的全局草稿', images: [image] }]
  const makeState = (initial) => {
    const values = new Map(Object.entries(initial))
    return {
      values,
      get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
      update: async (key, value) => { values.set(key, value) },
    }
  }

  // 第一个工作区：继承旧内容，并把旧键清掉 + 打上迁移标记。
  const first = path.join(tempDir(t), STASH_FILE_NAME)
  const firstState = makeState({ [legacyKey]: legacyItems })
  const firstStore = new PromptStashStore({ filePath: first })
  const logs = []
  assert.equal(migrateLegacyPromptStash({
    store: firstStore, globalState: firstState, legacyKey, migratedKey, log: (line) => logs.push(line),
  }), true)
  assert.equal(firstStore.load()[0].text, '旧的全局草稿')
  assert.equal(firstState.get(legacyKey), undefined)
  assert.equal(firstState.get(migratedKey), true)
  assert.match(logs[0], /迁移到当前工作区/)

  // 第二个工作区：迁移标记已在 → 不再继承（否则等于没隔离）。
  const secondStore = new PromptStashStore({ filePath: path.join(tempDir(t), STASH_FILE_NAME) })
  assert.equal(migrateLegacyPromptStash({
    store: secondStore, globalState: firstState, legacyKey, migratedKey,
  }), false)
  assert.deepEqual(secondStore.load(), [])

  // 本工作区已经有内容时，旧内容不覆盖它。
  const third = path.join(tempDir(t), STASH_FILE_NAME)
  const thirdStore = new PromptStashStore({ filePath: third })
  thirdStore.save([{ id: 'new', text: '本工作区已有', images: [] }])
  const thirdState = makeState({ [legacyKey]: legacyItems })
  assert.equal(migrateLegacyPromptStash({
    store: thirdStore, globalState: thirdState, legacyKey, migratedKey,
  }), false)
  assert.equal(thirdStore.load()[0].text, '本工作区已有')
})

test('dispose(): 停掉监听与定时器后不再回调', async (t) => {
  const file = path.join(tempDir(t), STASH_FILE_NAME)
  const store = new PromptStashStore({ filePath: file, watchDebounceMs: 10, holdEventLoop: true })
  const seen = []
  store.watch((items) => seen.push(items))
  store.dispose()
  fs.writeFileSync(file, JSON.stringify({ version: 1, items: [{ id: 'x', text: 'after dispose', images: [] }] }))
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.deepEqual(seen, [])
  assert.equal(store.check(), false)
})
