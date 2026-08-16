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

function foldEvents(events) {
  const items = []
  const removedIndices = new Set()
  const partials = new Map() // key turn:step -> {item, key}
  let running = false

  for (const event of events) {
    const data = event.data || {}
    switch (event.type) {
      case 'turn/start':
        running = true
        break
      case 'turn/end': {
        running = false
        // 清理空 partial（例如只有 finish 错误块而没有文本输出的回合）。
        for (const slot of partials.values()) {
          slot.item.partial = false
          if (!slot.item.text && !slot.item.reasoning) removedIndices.add(slot.index)
        }
        partials.clear()
        if (data.reason?.kind === 'error') {
          items.push({ type: 'note', text: `回合结束：${data.reason.error?.message ?? 'error'}` })
        } else if (data.reason?.kind === 'aborted') {
          items.push({ type: 'note', text: '回合已中止' })
        } else if (data.reason?.kind === 'blocked') {
          items.push({ type: 'note', text: '回合阻塞' })
        } else if (data.reason?.kind === 'max-tokens') {
          items.push({ type: 'note', text: '达到输出上限' })
        }
        break
      }
      case 'user/message': {
        const text = extractText(data.content)
        if (data.source?.kind === 'user') {
          items.push({ type: 'user', text, id: 'user-' + event.seq })
        } else {
          const sourceText = text || '（上下文注入）'
          const summary = sourceText.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? sourceText
          items.push({ type: 'context', text: sourceText, summary, id: 'context-' + event.seq })
        }
        break
      }
      case 'assistant/chunk': {
        const key = `${data.turn}:${data.step}`
        let slot = partials.get(key)
        if (!slot) {
          const item = { type: 'assistant', text: '', reasoning: '', partial: true, id: 'assistant-' + key }
          items.push(item)
          slot = { item, index: items.length - 1 }
          partials.set(key, slot)
        }
        const chunk = data.chunk || {}
        if (chunk.type === 'text-delta') slot.item.text += chunk.text || ''
        else if (chunk.type === 'reasoning-delta') slot.item.reasoning += chunk.text || ''
        break
      }
      case 'assistant/message': {
        const key = `${data.turn}:${data.step}`
        const slot = partials.get(key)
        const finalItem = {
          type: 'assistant',
          text: extractText(data.message?.content),
          reasoning: extractReasoning(data.message?.content),
          partial: false,
          id: slot ? slot.item.id : ('assistant-' + event.seq),
        }
        if (slot) {
          items[slot.index] = finalItem
          partials.delete(key)
        } else {
          items.push(finalItem)
        }
        break
      }
      case 'tool/call':
        items.push({
          type: 'tool',
          id: 'tool-' + (data.callId || event.seq),
          callId: data.callId,
          name: data.name,
          arguments: data.arguments,
          status: 'call',
          resultText: '',
        })
        break
      case 'tool/result': {
        const text = extractText(data.message?.content)
        const callId = data.message?.source?.callId || data.message?.content?.[0]?.toolCallId
        const existing = items.find((item) => item.type === 'tool' && item.callId === callId)
        if (existing) {
          existing.status = 'result'
          existing.resultText = text
          existing.isError = Boolean(data.error)
        } else {
          items.push({
            type: 'tool',
            id: 'tool-' + (callId ?? data.callId ?? event.seq),
            callId: callId ?? data.callId,
            name: 'tool',
            arguments: '',
            status: 'result',
            resultText: text,
            isError: Boolean(data.error),
          })
        }
        break
      }
      case 'note':
        items.push({ type: 'note', text: data.text || '', id: 'note-' + event.seq })
        break
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
  return {
    items: items.filter((item, index) => {
      if (removedIndices.has(index)) return false
      if (item.type === 'context' && index !== lastContextIndex) return false
      return true
    }),
    running,
  }
}


module.exports = { foldEvents, extractText, extractReasoning }
