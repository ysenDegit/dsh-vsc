'use strict'

function extractText(content) {
  return (content || [])
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text || '')
    .join('\n')
}

function extractReasoning(content) {
  return (content || [])
    .filter((block) => block && block.type === 'reasoning')
    .map((block) => block.text || '')
    .join('\n')
}

function extractImages(content) {
  return (content || [])
    .filter((block) => block && block.type === 'image' && block.attachment)
    .map((block) => ({ attachment: block.attachment }))
}

function producedFromCallView(callView) {
  if (!callView) return []
  if (callView.card === 'diff') {
    return (callView.locations || []).map((location) => location.path).filter(Boolean)
  }
  if (callView.card === 'generic' && callView.kind === 'edit') {
    return (callView.locations || []).map((location) => location.path).filter(Boolean)
  }
  return []
}

function foldEvents(events, options = {}) {
  // 简洁会话与详细会话使用同一事件源、两套折叠产物：
  // - detailed（默认）：完整时间线（工具、思考、上下文注入、产物、note）。
  // - concise：只保留用户消息、助手文本、命令反馈；工具/思考/上下文/产物/note 一律不进入结果，
  //   避免“先折叠完整详情再在界面过滤”造成的无效构建与 IPC/渲染开销。
  const concise = options.mode === 'concise'
  const items = []
  const removedIndices = new Set()
  const partials = new Map() // key turn:step -> {item, key}
  const commandByIndex = new Map() // commandId -> items index（command/run 与 command/done 配对）
  let running = false
  // 当前回合“产物”文件（成功修改的文件路径，按首次出现顺序去重）。
  let turnProduced = []
  let turnProducedSeen = new Set()
  // 简洁模式下被隐藏的“详情类”事件标记：用于在可见列表为空时，
  // 仍然让 webview 显示“简洁模式已隐藏…”提示（与旧版行为一致）。
  let hadHiddenDetail = false

  for (const event of events) {
    const data = event.data || {}
    switch (event.type) {
      case 'turn/start':
        running = true
        turnProduced = []
        turnProducedSeen = new Set()
        break
      case 'turn/end': {
        running = false
        // 清理空 partial（例如只有 finish 错误块而没有文本输出的回合）。
        for (const slot of partials.values()) {
          slot.item.partial = false
          if (!slot.item.text && !slot.item.reasoning) removedIndices.add(slot.index)
        }
        partials.clear()
        if (concise && ['error', 'aborted', 'blocked', 'max-tokens'].includes(data.reason?.kind)) {
          hadHiddenDetail = true
        }
        if (!concise) {
          if (data.reason?.kind === 'error') {
            items.push({ type: 'note', text: `回合结束：${data.reason.error?.message ?? 'error'}` })
          } else if (data.reason?.kind === 'aborted') {
            items.push({ type: 'note', text: '回合已中止' })
          } else if (data.reason?.kind === 'blocked') {
            items.push({ type: 'note', text: '回合阻塞' })
          } else if (data.reason?.kind === 'max-tokens') {
            items.push({ type: 'note', text: '达到输出上限' })
          }
          // 回合结束时输出“产物”列表（与 dsh web 端一致）。
          if (turnProduced.length) {
            items.push({ type: 'produced', paths: turnProduced.slice(), id: 'produced-' + event.seq })
          }
        }
        turnProduced = []
        turnProducedSeen = new Set()
        break
      }
      case 'user/message': {
        const text = extractText(data.content)
        const images = extractImages(data.content)
        if (data.source?.kind === 'user') {
          // 简洁会话沿用原有渲染语义：无文本的用户消息（如图片-only）不进入列表。
          if (concise && !String(text || '').trim()) break
          items.push({ type: 'user', text, images, id: 'user-' + event.seq })
        } else {
          if (concise) {
            hadHiddenDetail = true
          } else {
            const sourceText = text || '（上下文注入）'
            const summary = sourceText.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? sourceText
            items.push({ type: 'context', text: sourceText, summary, id: 'context-' + event.seq })
          }
        }
        break
      }
      case 'assistant/chunk': {
        const key = `${data.turn}:${data.step}`
        let slot = partials.get(key)
        if (!slot) {
          const item = concise
            ? { type: 'assistant', text: '', partial: true, id: 'assistant-' + key }
            : { type: 'assistant', text: '', reasoning: '', partial: true, id: 'assistant-' + key }
          items.push(item)
          slot = { item, index: items.length - 1 }
          partials.set(key, slot)
        }
        const chunk = data.chunk || {}
        if (chunk.type === 'text-delta') slot.item.text += chunk.text || ''
        else if (chunk.type === 'reasoning-delta') {
          if (concise) hadHiddenDetail = true
          else slot.item.reasoning += chunk.text || ''
        }
        break
      }
      case 'assistant/message': {
        const key = `${data.turn}:${data.step}`
        const slot = partials.get(key)
        const finalItem = {
          type: 'assistant',
          text: extractText(data.message?.content),
          partial: false,
          id: slot ? slot.item.id : ('assistant-' + event.seq),
        }
        if (!concise) {
          finalItem.reasoning = extractReasoning(data.message?.content)
          finalItem.images = extractImages(data.message?.content)
        }
        // 简洁会话不携带空助手消息：无文本（如纯工具回合）时移除占位并停止。
        if (concise && !String(finalItem.text || '').trim()) {
          hadHiddenDetail = true
          if (slot) removedIndices.add(slot.index)
          partials.delete(key)
          break
        }
        if (slot) {
          items[slot.index] = finalItem
          partials.delete(key)
        } else {
          items.push(finalItem)
        }
        break
      }
      case 'tool/call': {
        if (concise) { hadHiddenDetail = true; break }
        const callView = event.view && event.view.for === 'call' ? event.view.view : null
        items.push({
          type: 'tool',
          id: 'tool-' + (data.callId || event.seq),
          callId: data.callId,
          name: data.name,
          arguments: data.arguments,
          status: 'call',
          resultText: '',
          callView,
        })
        break
      }
      case 'tool/result': {
        if (concise) { hadHiddenDetail = true; break }
        const text = extractText(data.message?.content)
        // dsh 的 tool/result 把 callId 挂在 data.message.callId 上（tool/call 的 data.callId 与之相等）；
        // 兼容历史/投影里的 source.callId 与 content[].toolCallId 形态。
        const callId = data.message?.callId ?? data.callId ?? data.message?.source?.callId ?? data.message?.content?.[0]?.toolCallId
        const isError = Boolean(data.error || data.message?.isError)
        const existing = items.find((item) => item.type === 'tool' && item.callId === callId)
        if (existing) {
          existing.status = 'result'
          existing.resultText = text
          existing.isError = isError
          if (!isError && existing.callView) {
            const producedPaths = producedFromCallView(existing.callView)
            for (const p of producedPaths) {
              if (!turnProducedSeen.has(p)) {
                turnProducedSeen.add(p)
                turnProduced.push(p)
              }
            }
          }
        } else {
          items.push({
            type: 'tool',
            id: 'tool-' + (callId ?? data.callId ?? event.seq),
            callId: callId ?? data.callId,
            name: 'tool',
            arguments: '',
            status: 'result',
            resultText: text,
            isError,
          })
        }
        break
      }
      case 'note':
        if (concise) { hadHiddenDetail = true; break }
        items.push({ type: 'note', text: data.text || '', id: 'note-' + event.seq })
        break
      case 'command/run': {
        const commandId = data.commandId || ('cmd-' + event.seq)
        items.push({
          type: 'command',
          id: 'command-' + commandId,
          commandId,
          name: data.name || '',
          args: data.args || '',
          status: 'run',
          outcome: null,
        })
        commandByIndex.set(commandId, items.length - 1)
        break
      }
      case 'command/done': {
        const commandId = data.commandId || ('cmd-' + event.seq)
        const outcome = { kind: data.kind, text: data.text || '' }
        const index = commandByIndex.get(commandId)
        if (index !== undefined && items[index] && items[index].type === 'command') {
          items[index].status = 'done'
          items[index].outcome = outcome
          commandByIndex.delete(commandId)
        } else {
          // 历史截断等场景下可能只有 done 没有 run：仍渲染为一条已结束的命令节点。
          items.push({
            type: 'command',
            id: 'command-' + commandId,
            commandId,
            name: '',
            args: '',
            status: 'done',
            outcome,
          })
        }
        break
      }
      default:
        // 未知事件保持不破坏折叠；seq 水位照常推进。
        break
    }
  }

  // 上下文注入默认隐藏，只保留最新一条（按事件顺序最后一条）。
  let lastContextIndex = -1
  for (let i = 0; i < items.length; i++) {
    if (items[i].type === 'context') lastContextIndex = i
  }

  // 清除被 assistant/message 替换的 partial 已在替换时处理；空 partial 在 turn/end 清理。
  const foldedItems = items.filter((item, index) => {
    if (removedIndices.has(index)) return false
    if (item.type === 'context' && index !== lastContextIndex) return false
    return true
  })
  // 简洁模式：没有可见条目但曾出现被隐藏的详情事件时，仍给 webview 一个
  // “有内容但被隐藏”的标记，避免误判为空会话（webview 据此显示简洁模式提示）。
  if (concise && hadHiddenDetail && foldedItems.length === 0) {
    foldedItems.push({ type: 'hidden-hint', id: 'hidden-hint' })
  }
  return {
    items: foldedItems,
    running,
  }
}


module.exports = { foldEvents, extractText, extractReasoning, extractImages }
