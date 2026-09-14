'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { normalizePromptStashEntries } = require('./protocol.js')

/** 暂存文件的结构版本（将来改结构时据此迁移）。 */
const STASH_FILE_VERSION = 1

/** 暂存文件在存储目录里的文件名。 */
const STASH_FILE_NAME = 'prompt-stash.json'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function serialize(items) {
  return `${JSON.stringify({ version: STASH_FILE_VERSION, items }, null, 2)}\n`
}

/**
 * 悬浮提示词暂存框的持久化存储（**按工作区隔离**）。
 *
 * 为什么不用 `context.workspaceState`：VS Code 的状态 API 没有任何"内容变化"事件，
 * 而同一个工作区常常同时开着多个窗口（远程窗口 + 本地窗口、多个 VS Code 窗口），
 * 各自持有内存副本时后写会覆盖先写。改成工作区存储目录下的一个 JSON 文件后，
 * `fs.watch` 就能把"别的窗口改了"这件事通知到本窗口。
 *
 * - 作用域：文件位于 `context.storageUri`（VS Code 按**工作区**分配的存储目录），
 *   不同工作区各一份、互不干扰；同一工作区的多个窗口指向同一个文件，互相实时同步。
 *   没有打开任何文件夹时（`storageUri` 为空）退化到全局存储目录，此时空窗口之间共享一份。
 * - 写入：tmp + rename 原子替换，别的窗口不会读到半截 JSON。
 * - 自己的写入通过内容比对（`text`）排除，不会回调成"外部改动"。
 */
class PromptStashStore {
  /**
   * @param options.filePath - 暂存文件路径；缺省/空串时只存在内存里（不落盘）。
   * @param options.scope - 仅用于日志（`workspace` / `global` / `memory`）。
   * @param options.onLog - 日志回调。
   * @param options.fsModule - 可注入的 fs（测试用）。
   * @param options.watchDebounceMs - 文件事件去抖（默认 150ms，一次写盘常触发多个事件）。
   * @param options.holdEventLoop - true = 让监听与定时器把事件循环钉住
   *   （node:test 等"循环空就退出"的场景需要；扩展宿主里保持 false，不干扰宿主退出）。
   */
  constructor(options = {}) {
    this.filePath = typeof options.filePath === 'string' && options.filePath ? options.filePath : null
    this.scope = options.scope || (this.filePath ? 'workspace' : 'memory')
    this.onLog = typeof options.onLog === 'function' ? options.onLog : () => {}
    this.fs = options.fsModule || fs
    this.debounceMs = Number.isFinite(options.watchDebounceMs) ? options.watchDebounceMs : 150
    this.holdEventLoop = options.holdEventLoop === true
    /** 最近一次读/写过的文件文本：与磁盘一致即表示"没有外部改动"。 */
    this.text = null
    this.items = []
    this.watcher = null
    this.timer = null
    this.onChange = null
    this.closed = false
    this.reload()
  }

  /** 是否落盘（没有存储目录时暂存框仍可用，只是不跨重载保留）。 */
  get persistent() {
    return this.filePath !== null
  }

  /** 同步读取磁盘内容（激活时用一次；文件不存在/损坏都退化成空列表，绝不抛错）。 */
  reload() {
    const read = this.readFile()
    if (read.found) {
      this.text = read.text
      this.items = read.items
    }
    return this.items
  }

  /** 当前条目（`{id,text,images}` 数组）。 */
  load() {
    return this.items
  }

  isEmpty() {
    return this.items.length === 0
  }

  readFile() {
    if (!this.persistent) return { found: false, items: [], text: null }
    let raw
    try {
      raw = this.fs.readFileSync(this.filePath, 'utf8')
    } catch {
      return { found: false, items: [], text: null }
    }
    const text = String(raw)
    try {
      const parsed = JSON.parse(text)
      // 兼容早期可能存在的裸数组写法。
      const list = Array.isArray(parsed) ? parsed : parsed?.items
      return { found: true, items: normalizePromptStashEntries(Array.isArray(list) ? list : []), text }
    } catch (error) {
      this.onLog(`提示词暂存框文件解析失败，按空内容处理：${this.filePath}（${messageOf(error)}）`)
      return { found: true, items: [], text }
    }
  }

  /** 整份写入（原子替换）。返回规整后的条目；磁盘写失败只记日志，内存仍生效。 */
  save(items) {
    const next = normalizePromptStashEntries(items || [])
    const text = serialize(next)
    this.items = next
    // 先记下内容再写：watcher 事件到达时能认出这是自己写的，不会回调成外部改动。
    this.text = text
    if (!this.persistent) return next
    try {
      this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const temp = `${this.filePath}.tmp-${process.pid}`
      this.fs.writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600 })
      this.fs.renameSync(temp, this.filePath)
    } catch (error) {
      this.onLog(`写入提示词暂存框失败：${messageOf(error)}`)
    }
    return next
  }

  /**
   * 监听文件变化（跨窗口同步）。返回是否成功挂上监听。
   * @param onChange - 文件被**别的窗口**改动时回调，参数是新的条目数组。
   */
  watch(onChange) {
    this.onChange = typeof onChange === 'function' ? onChange : null
    if (!this.persistent || this.closed || this.watcher) return false
    if (typeof this.fs.watch !== 'function') return false
    const dir = path.dirname(this.filePath)
    const base = path.basename(this.filePath)
    try {
      // 监听目录而不是文件：rename 替换后文件句柄会变，直接盯文件在部分平台会失效。
      this.watcher = this.fs.watch(dir, { persistent: this.holdEventLoop }, (_event, filename) => {
        const name = filename ? String(filename) : ''
        // 只关心目标文件与它的临时文件，目录里其他变化（别的扩展文件）直接忽略。
        if (name && name !== base && !name.startsWith(`${base}.tmp`)) return
        this.scheduleCheck()
      })
    } catch (error) {
      this.watcher = null
      this.onLog(`监听提示词暂存框失败（跨窗口同步不可用）：${messageOf(error)}`)
      return false
    }
    if (typeof this.watcher?.on === 'function') {
      this.watcher.on('error', (error) => this.onLog(`提示词暂存框监听出错：${messageOf(error)}`))
    }
    return true
  }

  scheduleCheck() {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.check()
    }, this.debounceMs)
    // 不因为这个定时器把宿主/测试进程吊住（`holdEventLoop` 时为测试保留句柄）。
    if (!this.holdEventLoop && typeof this.timer.unref === 'function') this.timer.unref()
  }

  /**
   * 比对磁盘：内容与上次读/写的一致（含自己刚写的）则什么都不做。
   * @returns 是否发生了外部改动（并已回调观察者）。
   */
  check() {
    if (this.closed || !this.persistent) return false
    const read = this.readFile()
    // 文件被删（比如手工清理）：保持现状，等下一次写入重建，不把界面清空。
    if (!read.found) return false
    if (read.text === this.text) return false
    this.text = read.text
    this.items = read.items
    this.onChange?.(this.items)
    return true
  }

  dispose() {
    this.closed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch {
        // 关闭失败无所谓：进程退出时会一起释放。
      }
      this.watcher = null
    }
    this.onChange = null
  }
}

/**
 * 把 1.1.4 及以前"全局共享"的暂存内容一次性迁移到工作区文件。
 *
 * 只迁移一次（迁移标记记在 globalState），并在迁移后清掉旧的全局键——
 * 否则每打开一个新工作区都会凭空继承同一份内容，等于没隔离。
 *
 * @returns 是否真的搬运了内容。
 */
function migrateLegacyPromptStash(options = {}) {
  const { store, globalState, legacyKey, migratedKey, log = () => {} } = options
  if (!store || !globalState || !legacyKey || !migratedKey) return false
  if (globalState.get(migratedKey) === true) return false
  const legacy = normalizePromptStashEntries(globalState.get(legacyKey, []) || [])
  let migrated = false
  try {
    if (legacy.length > 0 && store.isEmpty()) {
      store.save(legacy)
      migrated = true
      log(`提示词暂存框：已把原先全局共享的 ${legacy.length} 个暂存槽迁移到当前工作区（${store.scope}）`)
    }
    void globalState.update(legacyKey, undefined)
    void globalState.update(migratedKey, true)
  } catch (error) {
    log(`提示词暂存框迁移失败：${messageOf(error)}`)
  }
  return migrated
}

module.exports = {
  PromptStashStore,
  migrateLegacyPromptStash,
  STASH_FILE_NAME,
  STASH_FILE_VERSION,
}
