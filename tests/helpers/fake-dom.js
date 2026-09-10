'use strict'

/** 供 webview 运行时测试与调试脚本复用的最小假 DOM。 */

function makeElement(tag, id) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: id || '',
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } },
    dataset: {},
    // 真实一点的 classList：读写 `className` 字符串（webview 里既有 className 赋值也有 classList 调用）。
    classList: {
      _list() { return String(el.className || '').split(/\s+/).filter(Boolean) },
      _write(list) { el.className = list.join(' ') },
      add(name) { const list = this._list(); if (list.indexOf(name) < 0) { list.push(name); this._write(list) } },
      remove(name) { this._write(this._list().filter((item) => item !== name)) },
      toggle(name, force) {
        const has = this._list().indexOf(name) >= 0
        const want = force === undefined ? !has : Boolean(force)
        if (want) this.add(name); else this.remove(name)
        return want
      },
      contains(name) { return this._list().indexOf(name) >= 0 },
    },
    hidden: false,
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    title: '',
    placeholder: '',
    scrollTop: 0,
    scrollHeight: 0,
    scrollWidth: 0,
    clientHeight: 0,
    clientWidth: 0,
    files: [],
    _attrs: {},
    childNodes: [],
    parentNode: null,
    appendChild(child) { this.childNodes.push(child); if (child) child.parentNode = this; return child },
    insertBefore(child) { this.childNodes.unshift(child); if (child) child.parentNode = this; return child },
    removeChild(child) { const i = this.childNodes.indexOf(child); if (i >= 0) this.childNodes.splice(i, 1); return child },
    remove() { if (this.parentNode) this.parentNode.removeChild(this) },
    replaceWith() {},
    setAttribute(name, value) { this._attrs[String(name)] = String(value) },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, String(name)) ? this._attrs[String(name)] : null },
    removeAttribute(name) { delete this._attrs[String(name)] },
    contains() { return false },
    closest(selector) { return closestMatch(this, selector) },
    querySelector(selector) {
      this._queries = this._queries || {}
      if (!this._queries[selector]) this._queries[selector] = makeElement('div', String(selector))
      return this._queries[selector]
    },
    querySelectorAll() { return [] },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } },
    scrollIntoView() {},
    scrollTo() {},
    setSelectionRange() {},
    matches() { return false },
    get parentElement() { return this.parentNode },
    get nextSibling() {
      if (!this.parentNode) return null
      const i = this.parentNode.childNodes.indexOf(this)
      return i >= 0 && i + 1 < this.parentNode.childNodes.length ? this.parentNode.childNodes[i + 1] : null
    },
    get children() { return this.childNodes },
    get firstChild() { return this.childNodes[0] || null },
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null },
    get previousSibling() {
      if (!this.parentNode) return null
      const i = this.parentNode.childNodes.indexOf(this)
      return i > 0 ? this.parentNode.childNodes[i - 1] : null
    },
  }

  // 事件监听：真实子集（记录 handler + click()/dispatchEvent 派发 + **向上冒泡**），
  // 让运行时测试能真的"点按钮"并走事件委托路径，而不是只能干看 DOM。
  el._listeners = {}
  el.addEventListener = (type, handler) => {
    if (typeof handler !== 'function') return
    el._listeners[type] = el._listeners[type] || []
    el._listeners[type].push(handler)
  }
  el.removeEventListener = (type, handler) => {
    const list = el._listeners[type]
    if (!list) return
    const index = list.indexOf(handler)
    if (index >= 0) list.splice(index, 1)
  }
  el.dispatchEvent = (event) => {
    const type = (event && event.type) || ''
    if (event && event.target === undefined) event.target = el
    let node = el
    while (node) {
      const list = node._listeners[type]
      if (list) {
        for (const handler of list.slice()) {
          event.currentTarget = node
          handler(event)
        }
      }
      if (event._stopped || event.cancelBubble) break
      node = node.parentNode
    }
    return true
  }
  el.click = () => el.dispatchEvent({
    type: 'click',
    target: el,
    preventDefault() {},
    stopPropagation() { this._stopped = true },
  })
  el.focus = () => {}
  el.blur = () => {}

  // innerHTML 语义与真实 DOM 一致：赋值即清空子节点
  // （webview 到处用 `el.innerHTML = ''` 重建列表，不实现会让测试看到"删不掉"的假象）。
  let innerHtml = ''
  Object.defineProperty(el, 'innerHTML', {
    enumerable: true,
    get() { return innerHtml },
    set(value) {
      innerHtml = String(value === null || value === undefined ? '' : value)
      el.childNodes.length = 0
    },
  })
  return el
}

/** 极简选择器匹配：标签名 / .class / #id / [attr]（足够覆盖 webview 里的 closest 用法）。 */
function matchesSelector(node, selector) {
  const sel = String(selector || '').trim()
  if (!sel) return false
  if (sel.startsWith('.')) return String(node.className || '').split(/\s+/).indexOf(sel.slice(1)) >= 0
  if (sel.startsWith('#')) return node.id === sel.slice(1)
  if (sel.startsWith('[')) return node.getAttribute(sel.slice(1, sel.length - 1).split('=')[0]) !== null
  return node.tagName === sel.toUpperCase()
}

function closestMatch(node, selector) {
  let current = node
  while (current) {
    if (matchesSelector(current, selector)) return current
    current = current.parentNode
  }
  return null
}

function makeFakeDom(posted, listeners) {
  const byId = new Map()
  // document.activeElement 支持：focus() 记录当前焦点，用于验证"正在输入的暂存框不被回填覆盖"。
  const focusState = { active: null }
  const trackFocus = (element) => {
    element.focus = () => { focusState.active = element }
    element.blur = () => { if (focusState.active === element) focusState.active = null }
    return element
  }
  // 静态 HTML 里的元素都有一个父节点（真实 DOM 语义），
  // 代码会用到 $('statusText').parentElement 之类。
  const staticRoot = makeElement('div', 'static-root')
  const document = {
    body: makeElement('body'),
    documentElement: makeElement('html'),
    getElementById(id) {
      if (!byId.has(id)) {
        const element = trackFocus(makeElement('div', id))
        element.parentNode = staticRoot
        byId.set(id, element)
      }
      return byId.get(id)
    },
    get activeElement() { return focusState.active },
    createElement: (tag) => trackFocus(makeElement(tag)),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    createDocumentFragment: () => makeElement('fragment'),
    querySelector: (selector) => document.getElementById('query:' + selector),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  }
  return {
    document,
    window: {
      addEventListener(type, handler) { if (type === 'message') listeners.push(handler) },
      removeEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {} }),
    },
    navigator: { clipboard: { writeText: async () => {} } },
    acquireVsCodeApi: () => ({
      postMessage: (message) => { posted.push(message) },
      getState: () => undefined,
      setState: () => {},
    }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    FileReader: class FakeFileReader {
      readAsDataURL(file) {
        this.result = (file && file.__dataUrl) || 'data:image/png;base64,QUJD'
        setTimeout(() => { if (typeof this.onload === 'function') this.onload() }, 0)
      }
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }
}


module.exports = { makeElement, makeFakeDom, getBundleScript }

function getBundleScript(nonce) {
  const { getWebviewHtml } = require('../../src/webview.js')
  const html = getWebviewHtml(nonce)
  const match = new RegExp('<script nonce="' + nonce + '">([\\s\\S]*?)</script>', 'u').exec(html)
  if (!match) throw new Error('webview html must contain the inline script')
  return match[1]
}
