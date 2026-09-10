    function toolSummary(item) {
      var s = item.name || 'tool';
      if (item.arguments) {
        try {
          var args = JSON.parse(item.arguments);
          var keys = Object.keys(args);
          if (keys.length) {
            var first = args[keys[0]];
            var val = typeof first === 'string' ? first : JSON.stringify(first);
            if (val.length > 80) val = val.slice(0, 80) + '…';
            s += ' ' + val;
          }
        } catch (e) { /* keep raw name */ }
      }
      if (item.status === 'result') {
        var t = item.resultText || '';
        if (t.length > 120) t = t.slice(0, 120) + '…';
        s = '结果 ' + s + (t ? ': ' + t : '');
      }
      return s;
    }

    function itemSignature(item) {
      // 轻量签名：只比较长度/状态，不拼接完整文本。
      // 折叠产物对文本只会追加/替换为最终值，长度足以检测变化，避免每帧 O(全文)。
      return item.type + '|' + (item.id || '') + '|' + (item.text || '').length + '|' + (item.reasoning || '').length
        + '|' + (item.status || '') + '|' + (item.resultText || '').length + '|' + (item.arguments || '').length
        + '|' + (item.summary || '').length + '|' + (item.partial ? 1 : 0)
        + '|' + ((item.outcome && item.outcome.kind) || '') + '|' + ((item.outcome && item.outcome.text) || '').length;
    }

    function isNearBottom() {
      return (chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight) < 40;
    }

    function scheduleConversationRender() {
      if (conversationTimer) return;
      // 用户正在向上翻历史时降低重绘频率（150ms）而不是每 16ms 一帧，
      // 避免流式底部更新持续抢占布局/主线程，造成滚动卡顿；在底部时保持流畅。
      var delay = isNearBottom() ? 16 : 150;
      conversationTimer = setTimeout(function () {
        conversationTimer = 0;
        renderConversation();
      }, delay);
    }

    function flushConversationRender() {
      if (conversationTimer) {
        clearTimeout(conversationTimer);
        conversationTimer = 0;
      }
      renderConversation();
    }

    function renderConversation() {
      // 切换会话、显示模式或语言时重建整棵列表；流式更新复用节点，只重绘变化的条目。
      if (renderedSessionId !== state.selectedSessionId || renderedMode !== state.sessionDisplay || renderedLang !== state.language) {
        itemNodes.clear();
        chatEl.innerHTML = '';
        renderedSessionId = state.selectedSessionId;
        renderedMode = state.sessionDisplay;
        renderedLang = state.language;
      }
      var wasNearBottom = isNearBottom();

      if (state.hasMoreEarlier) {
        if (!earlierWrapEl) {
          earlierWrapEl = document.createElement('div');
          earlierWrapEl.className = 'load-earlier-wrap';
          var earlierBtn = document.createElement('button');
          earlierBtn.className = 'load-earlier-btn';
          earlierBtn.addEventListener('click', function () {
            if (state.loadingEarlier) return;
            state.loadingEarlier = true;
            renderConversation();
            post({ type: 'loadEarlier', sessionId: state.selectedSessionId });
          });
          earlierWrapEl.appendChild(earlierBtn);
        }
        var earlierBtnEl = earlierWrapEl.querySelector('.load-earlier-btn');
        earlierBtnEl.textContent = state.loadingEarlier ? t('loadingEarlier') : t('loadEarlier');
        earlierBtnEl.disabled = state.loadingEarlier;
        chatEl.insertBefore(earlierWrapEl, chatEl.firstChild);
      } else if (earlierWrapEl) {
        earlierWrapEl.remove();
        earlierWrapEl = null;
      }

      var items = state.conversation || [];
      // 简洁/详细会话的折叠已在宿主侧按各自模式完成：
      // 简洁模式只含用户消息/助手文本/命令反馈，这里不再基于详细列表二次过滤。
      var displayItems = items;

      if (!displayItems.length) {
        if (!items.length) {
          var session = currentSession();
          if (session && session.blank) {
            renderBlankSessionWelcome();
            return;
          }
          // 有更早历史时顶部已有“加载更早”按钮，不再显示“新会话已就绪”提示；
          // 同时清掉残留的空提示/旧消息节点，只保留按钮。
          if (!state.hasMoreEarlier) {
            if (!state.workspace) {
              if (state.status !== 'ready') {
                // dsh 未连接（例如关闭自动启动且没有手动运行实例）：
                // 提示点击状态点重试，而不是误导性地提供“添加到工作区”。
                chatEl.innerHTML = '<div class="empty">' + escapeHtml(t('emptyNoDsh')) + '</div>';
                return;
              }
              // 未添加工作区（已连接）：提示 + “将当前文件夹添加到 dsh 工作区”按钮。
              chatEl.innerHTML = '<div class="empty">' + escapeHtml(t('emptyNoWorkspace')) + '</div>'
                + '<div class="empty-actions"><button id="addWorkspaceBtn" class="primary">' + escapeHtml(t('addWorkspaceBtn')) + '</button></div>';
              var addWorkspaceBtn = document.getElementById('addWorkspaceBtn');
              if (addWorkspaceBtn) {
                addWorkspaceBtn.addEventListener('click', function () { post({ type: 'addWorkspace' }); });
              }
              return;
            }
            chatEl.innerHTML = '<div class="empty">' + escapeHtml(t('emptyReady')) + '</div>';
            return;
          }
          while (chatEl.lastChild && chatEl.lastChild !== earlierWrapEl) {
            chatEl.removeChild(chatEl.lastChild);
          }
          itemNodes.clear();
          return;
        }
        chatEl.innerHTML = '<div class="empty">' + escapeHtml(t('conciseHidden')) + '</div>';
        return;
      }

      // 清除残留的空状态/欢迎节点：切换会话时可能先渲染了“新会话已就绪”或
      // 空白新会话欢迎页，随后历史加载完成才追加消息，若不清理会一直留在顶部。
      var staleEmpty = chatEl.querySelector('.empty');
      if (staleEmpty) staleEmpty.remove();
      var staleEmptyActions = chatEl.querySelector('.empty-actions');
      if (staleEmptyActions) staleEmptyActions.remove();
      var staleWelcome = chatEl.querySelector('.mode-welcome');
      if (staleWelcome) staleWelcome.remove();

      // 节点已在 DOM 且顺序正确时不再重复 appendChild；一旦头部内容变化
      // （"加载更早"在头部插入新条目，或首条被替换/移除）就必须整体重建，
      // 否则新增条目会被 appendChild 追加到旧节点后面，DOM 顺序与折叠结果相反。
      var scrollAnchor = null;
      if (itemNodes.size > 0 && displayItems.length > 0) {
        var firstItem = displayItems[0];
        var firstKey = firstItem.id || (firstItem.type + '-0');
        var firstRec = itemNodes.get(firstKey);
        var expectedPrev = earlierWrapEl || null;
        var headOk = Boolean(firstRec && firstRec.node && firstRec.node.parentNode === chatEl
          && firstRec.node.previousSibling === expectedPrev);
        if (!headOk) {
          // 重建前记录视口顶部那一条，重建后把视线放回原处（加载更早时不跳走）。
          scrollAnchor = captureScrollAnchor();
          while (chatEl.lastChild && chatEl.lastChild !== earlierWrapEl) chatEl.removeChild(chatEl.lastChild);
          itemNodes.clear();
        }
      }

      var seen = new Set();
      var visibleCount = 0;
      for (var i = 0; i < displayItems.length; i++) {
        var item = displayItems[i];
        var key = item.id || (item.type + '-' + i);
        seen.add(key);
        var rec = itemNodes.get(key);
        if (!rec) {
          rec = { node: null, signature: '' };
          itemNodes.set(key, rec);
        }
        // 简洁会话的流式助手消息走独立轻量渲染：纯文本增量追加，
        // 不再每个 chunk 都整段 Markdown 重建；详细会话仍走 renderItem 全量重绘。
        if (state.sessionDisplay === 'concise' && item.type === 'assistant' && item.partial) {
          var conciseText = item.text || '';
          if (!conciseText.trim()) {
            // 尚无可见文本时不渲染空白流式泡，避免旧版“隐藏空助手”语义变化。
            if (rec.node) { rec.node.remove(); rec.node = null; }
            rec.conciseText = '';
            continue;
          }
          if (!rec.node) {
            rec.node = renderConciseStreamingItem(item);
            rec.conciseText = conciseText;
          } else if (conciseText !== rec.conciseText) {
            // 宿主侧折叠对 partial 文本只会向后追加（item.text += delta），
            // 因此直接按长度差取增量即可，不做 O(文本长度) 的前缀比对。
            if (conciseText.length > rec.conciseText.length) {
              appendConciseStreamText(rec, conciseText.slice(rec.conciseText.length));
            } else {
              var freshStream = renderConciseStreamingItem(item);
              rec.node.replaceWith(freshStream);
              rec.node = freshStream;
            }
            rec.conciseText = conciseText;
          }
          rec.signature = '';
          visibleCount++;
        } else {
          var sig = itemSignature(item);
          if (!rec.node || rec.signature !== sig) {
            var fresh = renderItem(item);
            if (rec.node) rec.node.replaceWith(fresh);
            rec.node = fresh;
            rec.signature = sig;
          }
          rec.conciseText = null;
          if (state.sessionDisplay !== 'concise'
            || item.type === 'command'
            || (item.type === 'user' && String(item.text || '').trim().length > 0)
            || (item.type === 'assistant' && String(item.text || '').trim().length > 0)) {
            visibleCount++;
          }
        }
        if (!rec.node.parentNode) chatEl.appendChild(rec.node);
      }
      for (var entry of itemNodes) {
        if (!seen.has(entry[0])) {
          entry[1].node.remove();
          itemNodes.delete(entry[0]);
        }
      }

      // 简洁会话：折叠产物中只有不可见条目（如空助手/纯工具回合）时，
      // 与旧版一致展示“简洁模式已隐藏…”提示，而不是留下空白聊天区。
      if (state.sessionDisplay === 'concise' && items.length > 0 && visibleCount === 0) {
        chatEl.innerHTML = '<div class="empty">' + escapeHtml(t('conciseHidden')) + '</div>';
        itemNodes.clear();
        return;
      }

      if (scrollAnchor) {
        restoreScrollAnchor(scrollAnchor);
      } else if (wasNearBottom) {
        chatEl.scrollTop = chatEl.scrollHeight;
      }
      // 未在底部时保持原滚动位置（节点复用不会重置滚动）。
    }

    /** 记录当前视口顶部对应的条目（重建 DOM 前后用它恢复视线位置）。 */
    function captureScrollAnchor() {
      var top = chatEl.scrollTop;
      var best = null;
      for (var entry of itemNodes) {
        var node = entry[1] && entry[1].node;
        if (!node || node.parentNode !== chatEl) continue;
        var offset = node.offsetTop;
        if (typeof offset !== 'number') return null;
        if (offset <= top + 1 && (!best || offset > best.offset)) best = { key: entry[0], offset: offset };
      }
      if (!best) return null;
      return { key: best.key, delta: best.offset - top };
    }

    /** 把重建前记录的条目放回原视线位置（条目已不在时退回底部对齐）。 */
    function restoreScrollAnchor(anchor) {
      var rec = itemNodes.get(anchor.key);
      var node = rec && rec.node;
      if (!node || typeof node.offsetTop !== 'number') return;
      chatEl.scrollTop = node.offsetTop - anchor.delta;
    }

    // 简洁会话流式助手消息的轻量节点：纯文本 + pre-wrap + 光标，
    // 不经过 Markdown 解析；回合结束后由 renderItem 全量替换为富文本。
    function renderConciseStreamingItem(item) {
      var wrap = document.createElement('div');
      wrap.className = 'msg assistant';
      var bubble = document.createElement('div');
      bubble.className = 'bubble stream-plain cursor';
      bubble.textContent = item.text || '';
      wrap.appendChild(bubble);
      return wrap;
    }

    function appendConciseStreamText(rec, delta) {
      if (!delta) return;
      var bubble = rec.node && rec.node.querySelector ? rec.node.querySelector('.bubble') : null;
      if (!bubble) return;
      bubble.appendChild(document.createTextNode(delta));
    }

    function toolIconClass(name) {
      var n = String(name || '').toLowerCase();
      var map = {
        write: '✍️', read: '📖', edit: '✏️', bash: '⌨️', terminal: '💻',
        glob: '🔍', grep: '🔍', todo: '✅', plan: '📋', web: '🌐',
        skill: '🧩', list: '📄'
      };
      return map[n] || '⚙️';
    }

    function anchorSummaryToggle(summaryEl) {
      // details 展开/收起会改变聊天区高度；浏览器滚动锚定可能把视线拉走。
      // 这里在点击时记住 summary 的视口位置，下一帧按实际位移补偿 scrollTop，
      // 使展开前后的点击位置保持不动（也覆盖 Context 等其它 details 摘要）。
      summaryEl.addEventListener('click', function () {
        var anchorTop = summaryEl.getBoundingClientRect().top;
        requestAnimationFrame(function () {
          var delta = summaryEl.getBoundingClientRect().top - anchorTop;
          if (Math.abs(delta) > 1) chatEl.scrollTop += delta;
        });
      });
    }

    function renderItem(item) {
      var wrap = document.createElement('div');
      wrap.className = 'msg ' + item.type;

      var bubble = document.createElement('div');
      bubble.className = 'bubble';
      var needBubble = true;

      if (item.type === 'assistant') {
        var hasText = !!(item.text && String(item.text).trim());
        var hasReasoning = !!(item.reasoning && String(item.reasoning).trim());
        needBubble = hasText || (item.partial && !hasReasoning);
        if (!hasText && !hasReasoning && !item.partial) {
          // 空消息（常为仅含工具调用、无文本/推理）不渲染空白气泡。
          wrap.style.display = 'none';
        }
        if (hasReasoning && state.sessionDisplay !== 'concise') {
          if (item.partial) {
            // 流式思考：左侧为输出状态（Think），右侧为单行流式内容（不换行、无横向滚动条、高度保持一行）。
            var live = document.createElement('div');
            live.className = 'reasoning-live';
            var statusEl = document.createElement('span');
            statusEl.className = 'reasoning-status';
            statusEl.textContent = '💭 Thinking';
            var sepEl = document.createElement('span');
            sepEl.className = 'reasoning-sep';
            sepEl.textContent = '·';
            var streamEl = document.createElement('span');
            streamEl.className = 'reasoning-stream';
            streamEl.textContent = item.reasoning;
            live.appendChild(statusEl);
            live.appendChild(sepEl);
            live.appendChild(streamEl);
            wrap.appendChild(live);
            // 内容不断向右增长，视窗固定在最新处（旧内容向左滚动越出视野）。
            setTimeout(function () { streamEl.scrollLeft = streamEl.scrollWidth; }, 0);
          } else {
            // 生成结束自动折叠为一行 "Think"，点击可展开完整思维链（与正式输出分开）。
            var rd = document.createElement('details');
            rd.className = 'reasoning-details';
            var rsum = document.createElement('summary');
            rsum.className = 'reasoning-title';
            var rlabel = document.createElement('span');
            rlabel.className = 'reasoning-label';
            rlabel.textContent = '💭 Think';
            rsum.appendChild(rlabel);
            var rprev = document.createElement('span');
            rprev.className = 'reasoning-preview';
            // 预览强制单行：换行折叠为空格，避免完成后的思考内容撑开多行。
            rprev.textContent = String(item.reasoning || '')
              .split(String.fromCharCode(10)).join(' ')
              .split(String.fromCharCode(13)).join(' ')
              .replace(/s+/g, ' ');
            rsum.appendChild(rprev);
            rd.appendChild(rsum);
            var rbody = document.createElement('pre');
            rbody.className = 'reasoning-body';
            rbody.textContent = item.reasoning;
            rd.appendChild(rbody);
            // 展开/收起时把 summary 锚定在点击前的视口位置：details 高度突变会让
            // 浏览器滚动锚定把视线整体拉走（长思考链的展开尤其明显），这里在
            // 下一帧按实际位移补偿回 scrollTop，保证展开前后点击处纹丝不动。
            anchorSummaryToggle(rsum);
            wrap.appendChild(rd);
          }
        }
        if (hasText) bubble.innerHTML += renderMarkdown(item.text);
        if (item.partial) bubble.classList.add('cursor');
      } else if (item.type === 'tool') {
        var rawToolName = item.name || 'tool';
        var toolName = escapeHtml(rawToolName);
        var toolArgFull = '';
        var toolArgShort = '';
        if (item.arguments) {
          try {
            var toolArgs = JSON.parse(item.arguments);
            toolArgFull = JSON.stringify(toolArgs, null, 2);
            var toolKeys = Object.keys(toolArgs);
            if (toolKeys.length) {
              var toolFirst = toolArgs[toolKeys[0]];
              var toolVal;
              if (typeof toolFirst === 'string') {
                toolVal = toolFirst;
                // 路径参数只显示文件名（basename），避免完整路径把时间线拉长。
                if (toolVal.indexOf('/') >= 0 || toolVal.indexOf(BS) >= 0) {
                  var segs = toolVal.split('/').join(BS).split(BS);
                  toolVal = segs[segs.length - 1] || toolVal;
                }
              } else {
                toolVal = JSON.stringify(toolFirst);
              }
              if (toolVal.length > 60) toolVal = toolVal.slice(0, 60) + '…';
              toolArgShort = toolVal;
            }
          } catch (e) { toolArgFull = item.arguments; }
        }
        var toolHead = '<summary class="tool-head"><span class="tool-icon">' + escapeHtml(toolIconClass(rawToolName)) + '</span><span class="tool-name">' + toolName + '</span>'
          + (toolArgShort ? '<span class="tool-arg">' + escapeHtml(toolArgShort) + '</span>' : '')
          + '</summary>';
        var toolBody = '';
        if (toolArgFull) toolBody += '<pre class="tool-args">' + escapeHtml(toolArgFull) + '</pre>';
        var toolDone = item.status === 'result' || !!item.resultText || !!item.isError;
        if (!toolDone) {
          toolBody += '<div class="tool-running">' + escapeHtml(t('toolRunning')) + '</div>';
        } else if (item.resultText) {
          toolBody += '<pre class="tool-result">' + escapeHtml(item.resultText) + '</pre>';
        } else if (item.isError) {
          toolBody += '<div class="tool-failed">' + escapeHtml(t('commandFailed')) + '</div>';
        } else {
          toolBody += '<div class="tool-done">' + escapeHtml(t('commandDone')) + '</div>';
        }
        bubble.innerHTML = '<details class="tool-details">' + toolHead + toolBody + '</details>';
      } else if (item.type === 'note') {
        bubble.textContent = item.text || '';
      } else if (item.type === 'command') {
        var cmdLine = '/' + (item.name || '?') + (item.args || '');
        var outcomeClass;
        var outcomeText;
        if (item.outcome) {
          outcomeClass = item.outcome.kind === 'error' ? 'command-error' : 'command-success';
          outcomeText = item.outcome.text || (item.outcome.kind === 'error' ? t('commandFailed') : t('commandDone'));
        } else {
          outcomeClass = 'command-running';
          outcomeText = t('commandRunning');
        }
        var outcomeHtml = '<div class="command-outcome ' + outcomeClass + '">' + escapeHtml(outcomeText) + '</div>';
        if (item.name === 'permission') {
          bubble.innerHTML = '<div class="command-inline"><span class="command-chip">' + escapeHtml(cmdLine) + '</span>' + outcomeHtml + '</div>';
        } else {
          bubble.innerHTML = '<div class="command-line">' + escapeHtml(cmdLine) + '</div>' + outcomeHtml;
        }
      } else if (item.type === 'context') {
        var ctxSummary = item.summary || (item.text || '').split('\n').find(function (line) { return line.trim().length > 0; }) || t('contextInjection');
        bubble.innerHTML = '<details class="context-details"><summary>' + escapeHtml(ctxSummary) + '</summary><pre>'
          + escapeHtml(item.text || '') + '</pre></details>';
        var ctxSummaryEl = bubble.querySelector('.context-details summary');
        if (ctxSummaryEl) anchorSummaryToggle(ctxSummaryEl);
      } else if (item.type === 'user' && item.images && item.images.length) {
        // 带图片的用户消息：先渲染图片缩略图，再渲染文本。
        var imgWrap = document.createElement('div');
        imgWrap.className = 'msg-images';
        for (var ii = 0; ii < item.images.length; ii++) {
          var ref = item.images[ii].attachment || {};
          var aid = ref.attachmentId || '';
          var slot = document.createElement('div');
          slot.className = 'msg-image';
          if (aid) slot.setAttribute('data-attachment-id', aid);
          var cached = attachmentCache[aid];
          if (cached && cached.data) {
            var im = document.createElement('img');
            im.src = 'data:' + (cached.mediaType || 'image/png') + ';base64,' + cached.data;
            im.alt = t('imageAttachment');
            slot.appendChild(im);
          } else {
            var ph = document.createElement('span');
            ph.className = 'img-placeholder';
            ph.textContent = aid ? t('imageLoading') : t('imageLoadFailed');
            slot.appendChild(ph);
            if (aid) requestAttachment(aid);
          }
          imgWrap.appendChild(slot);
        }
        bubble.appendChild(imgWrap);
        if (item.text) {
          var textDiv = document.createElement('div');
          textDiv.innerHTML = renderMarkdown(item.text);
          bubble.appendChild(textDiv);
        }
      } else if (item.type === 'produced') {
        needBubble = false;
        var prodWrap = document.createElement('div');
        prodWrap.className = 'produced';
        var pulabel = document.createElement('span');
        pulabel.className = 'produced-label';
        pulabel.textContent = t('producedLabel');
        prodWrap.appendChild(pulabel);
        var puchips = document.createElement('div');
        puchips.className = 'produced-list';
        var ppaths = item.paths || [];
        var pmax = 5;
        for (var pj = 0; pj < ppaths.length && pj < pmax; pj++) {
          (function (path) {
            var puchip = document.createElement('button');
            puchip.className = 'produced-chip';
            var psegs = path.split('/').join(String.fromCharCode(92)).split(String.fromCharCode(92));
            var pbase = psegs[psegs.length - 1] || path;
            puchip.textContent = pbase;
            puchip.title = path;
            puchip.addEventListener('click', function () { post({ type: 'openFile', path: path }); });
            puchips.appendChild(puchip);
          })(ppaths[pj]);
        }
        if (ppaths.length > pmax) {
          var pumore = document.createElement('span');
          pumore.className = 'produced-more';
          pumore.textContent = '+' + (ppaths.length - pmax);
          puchips.appendChild(pumore);
        }
        prodWrap.appendChild(puchips);
        wrap.appendChild(prodWrap);
      } else {
        bubble.innerHTML = renderMarkdown(item.text || '');
      }
      if (needBubble) wrap.appendChild(bubble);
      return wrap;
    }

    /** 与 dsh Web 端一致的目录名：去掉尾部斜杠后取最后一段（兼容 Windows 反斜杠）。 */
    function workspaceTitleOf(path) {
      var trimmed = String(path || '').replace(/[/\\]+$/, '');
      var cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
      return trimmed.slice(cut + 1);
    }

    /**
     * 会话显示名，规则与 dsh Web 端一致（sessions/service.ts 的 displayTitleOf）：
     * 宿主预计算的 displayTitle → title → 投影 title → cwd 目录名 → 原始 sessionId；
     * 空白会话显示本地化的"新会话"。
     */
    function sessionDisplayTitle(s) {
      if (!s) return '';
      if (typeof s.displayTitle === 'string' && s.displayTitle) return s.displayTitle;
      if (s.title) return s.title;
      var projectedTitle = s.projections && s.projections.values && s.projections.values.title;
      if (typeof projectedTitle === 'string' && projectedTitle) return projectedTitle;
      if (s.blank) return t('blankTitle');
      var base = workspaceTitleOf(s.cwd);
      if (base) return base;
      return String(s.sessionId || '');
    }

    function renderSessions() {
      var current = state.selectedSessionId;
      var sessions = state.sessions || [];
      var cur = null;
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].sessionId === current) { cur = sessions[i]; break; }
      }
      sessionTitleEl.textContent = cur ? sessionDisplayTitle(cur) : t('noSessions');
      renderDrawerList(sessions, current);
      moreOpenWebBtn.disabled = false;
    }

    /**
     * 会话谱系展平：**只有子代理会话（`origin:'subagent'`）挂在父会话下**并缩进，
     * fork/派生出来的会话（dsh `session/fork` 虽然也写 `parentSession`，但没有 origin）
     * 就是普通会话——不再区分、不再缩进、不再标注，按更新时间与其它会话一起排在顶层。
     * root 保持输入顺序；父会话不在列表里的"孤儿"降级为 root（不丢弃），环状引用用 visited 兜底。
     */
    function buildSessionLineage(sessions) {
      var byId = {};
      for (var i = 0; i < sessions.length; i++) byId[sessions[i].sessionId] = sessions[i];
      var children = {};
      var roots = [];
      for (var j = 0; j < sessions.length; j++) {
        var item = sessions[j];
        // 只有子代理会话参与嵌套；被"提升为普通会话"（插件视图内）的子代理也不参与。
        var parentId = (isSubagentSessionRow(item) && !item.promotedLocally) ? item.parentSessionId : null;
        if (parentId && byId[parentId]) {
          if (!children[parentId]) children[parentId] = [];
          children[parentId].push(item);
        } else {
          roots.push(item);
        }
      }
      var out = [];
      var visited = {};
      function walk(session, depth) {
        if (visited[session.sessionId]) return;
        visited[session.sessionId] = true;
        out.push({ session: session, depth: depth });
        var kids = children[session.sessionId] || [];
        for (var k = 0; k < kids.length; k++) walk(kids[k], depth + 1);
      }
      for (var r = 0; r < roots.length; r++) walk(roots[r], 0);
      return out;
    }

    /** dsh 的 `origin` 只有 `'subagent'` 一种取值（list.ts 的 listFields）：子代理会话不可 fork/重命名/归档。 */
    function isSubagentSessionRow(session) {
      return !!(session && session.origin === 'subagent');
    }

    /**
     * 会话行。depth > 0 只会出现在 `origin:'subagent'` 的子代理会话上：标"子代理会话"、
     * 仅可选中（不给 fork/重命名/归档）。fork/派生出来的会话与普通会话完全一样渲染。
     */
    function makeSessionRow(s, current, depth) {
      var subagent = isSubagentSessionRow(s);
      // 插件视图内的"提升为普通会话"（dsh 没有改谱系 API）：depth 已经被谱系展平置 0，
      // 这里只补标记与"恢复层级"入口。
      var promoted = s.promotedLocally === true;
      var item = document.createElement('div');
      item.className = 'drawer-item'
        + (depth > 0 ? ' drawer-child' : '')
        + (subagent ? ' drawer-subagent' : '')
        + (s.sessionId === current ? ' selected' : '')
        + (s.running ? ' running' : '');
      if (depth > 0) item.style.paddingLeft = (8 + depth * 14) + 'px';
      item.setAttribute('data-session-id', s.sessionId);
      var dot = document.createElement('span');
      dot.className = 'drawer-dot';
      item.appendChild(dot);
      var main = document.createElement('div');
      main.className = 'drawer-main';
      var titleEl = document.createElement('div');
      titleEl.className = 'drawer-title-text';
      // 不区分分支会话与普通会话：标题只用会话显示名（子代理标题为空时回退"子代理会话"）。
      titleEl.textContent = sessionDisplayTitle(s) || (subagent ? t('subagentSession') : String(s.sessionId || ''));
      main.appendChild(titleEl);
      var meta = document.createElement('div');
      meta.className = 'drawer-meta';
      var parts = [];
      if (subagent) parts.push(t('subagentSession'));
      if (promoted) parts.push(t('promotedSession'));
      if (s.archived) parts.push(t('archived'));
      // 本地"取消归档（仅插件视图）"过的会话：标出来（并给 meta 一个说明 tooltip），
      // 否则用户会疑惑"这个会话为什么 dsh 网页端看不到"。
      if (s.restoredLocally) {
        parts.push(t('restoredLocally'));
        meta.title = t('restoredLocallyTitle');
      }
      if (s.running) parts.push(t('running'));
      if (s.updatedAt) parts.push(relativeTime(s.updatedAt));
      meta.textContent = parts.join(' · ');
      main.appendChild(meta);
      item.appendChild(main);
      // 会话模式标签（如"标准模式""PTC 模式"）：只在面板宽度足够时显示（见 style.css 媒体查询）。
      var modeLabel = sessionModeLabel(sessionModeId(s));
      if (modeLabel) {
        var modeEl = document.createElement('span');
        modeEl.className = 'drawer-mode';
        modeEl.textContent = modeLabel;
        modeEl.title = t('sessionModeTitle', { name: modeLabel });
        item.appendChild(modeEl);
      }
      var actions = document.createElement('div');
      actions.className = 'drawer-actions';
      // 子行（分支会话/子代理会话）可提升为顶层行；已提升的可恢复层级显示。
      if (promoted || depth > 0) {
        actions.appendChild(makeDrawerAction(
          promoted ? 'demoteSession' : 'promoteSession',
          promoted ? '⇩' : '⇧',
          promoted ? t('demoteSession') : t('promoteSession')
        ));
      }
      if (!subagent) {
        actions.appendChild(makeDrawerAction('forkSession', '⧉', t('forkSession')));
        actions.appendChild(makeDrawerAction('renameSession', '✎', t('renameSession')));
        // 已归档会话提供"取消归档（仅插件视图）"；本地已恢复的提供反向操作
        // （注意：本地恢复过的会话宿主下发的 archived 是 false，所以只能看 restoredLocally）。
        if (s.restoredLocally) actions.appendChild(makeDrawerAction('unrestoreSession', '↪', t('unrestoreSession')));
        else if (s.archived) actions.appendChild(makeDrawerAction('restoreSession', '↩', t('restoreSession')));
        actions.appendChild(makeDrawerAction('closeSession', '✕', t('closeSession')));
      }
      if (actions.childNodes.length) item.appendChild(actions);
      item.addEventListener('click', function (ev) {
        var itemEl = ev.currentTarget;
        var sid = itemEl.getAttribute('data-session-id');
        var btn = (ev.target && ev.target.closest) ? ev.target.closest('button') : null;
        if (btn) {
          var kind = btn.getAttribute('data-action');
          if (kind === 'restoreSession') {
            post({ type: 'restoreSession', sessionId: sid });
          } else if (kind === 'forkSession') {
            showToast('正在 fork 会话…', '', true);
            post({ type: 'forkSession', sessionId: sid });
          } else if (kind === 'unrestoreSession') {
            post({ type: 'unrestoreSession', sessionId: sid });
          } else if (kind === 'promoteSession') {
            post({ type: 'promoteSession', sessionId: sid, promoted: true });
          } else if (kind === 'demoteSession') {
            post({ type: 'promoteSession', sessionId: sid, promoted: false });
          } else if (kind === 'renameSession') post({ type: 'renameSession', sessionId: sid });
          else if (kind === 'closeSession') openArchiveModal(sid);
          closeSessionDrawer();
          return;
        }
        if (sid && sid !== state.selectedSessionId) post({ type: 'selectSession', sessionId: sid });
        closeSessionDrawer();
      });
      return item;
    }

    function makeDrawerAction(kind, label, title) {
      var btn = document.createElement('button');
      btn.textContent = label;
      btn.setAttribute('data-action', kind);
      btn.title = title;
      return btn;
    }

    function relativeTime(ts) {
      var n = Number(ts);
      if (!n) return '';
      var diff = Date.now() - n;
      var min = Math.floor(diff / 60000);
      if (min < 1) return '刚刚';
      if (min < 60) return min + ' 分钟前';
      var hr = Math.floor(min / 60);
      if (hr < 24) return hr + ' 小时前';
      var day = Math.floor(hr / 24);
      if (day < 7) return day + ' 天前';
      var d = new Date(n);
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }

    function renderDrawerList(sessions, current) {
      drawerList.innerHTML = '';
      var query = (drawerSearch.value || '').trim().toLowerCase();
      // 已归档视图开关：按钮文案 = "点下去会发生什么"，状态与设置里的
      // `dsh-vsc.showArchivedSessions` 是同一个（默认 false＝归档会话不显示）。
      // 旧实现按"本地取消归档集合大小"推断，文案与真实状态相反，点到第二次就再也隐藏不了。
      // 再带上数量："显示已归档（13）"——用户点之前就知道会有多少条出现，
      // 避免归档行都排在列表末尾（时间序）导致"点了没反应"的错觉。
      var archivedShown = state.showArchivedSessions === true;
      var archivedCount = Number(state.archivedAvailable) || 0;
      var restoredCount = Number(state.restoredCount) || 0;
      var archivedToggleLabel = (archivedShown ? t('hideArchivedView') : t('showArchivedView'))
        + (archivedCount > 0 ? '（' + archivedCount + '）' : '');
      drawerArchivedToggle.hidden = false;
      drawerArchivedToggle.textContent = archivedToggleLabel;
      // 一条可切换的归档会话都没有、但存在"仅插件内显示"的会话时，开关本来就无事可做——
      // 把原因写进 tooltip，避免再次被当成"按钮坏了"。
      drawerArchivedToggle.title = (archivedCount === 0 && restoredCount > 0)
        ? archivedToggleLabel + t('archivedToggleAllRestored', { count: restoredCount })
        : archivedToggleLabel;
      // 会话谱系（同 dsh 网页端 flattenLineage）：带 parentSessionId 的会话缩进挂在父会话下，
      // 递归到任意深度——fork 出来的会话同样只写 parentSessionId（origin 为空），
      // 旧实现只渲染一层且把所有子行硬标成"子代理会话"，fork 出的 fork 更是整行消失。
      // 归档会话（且没有本地恢复）单独成组：显示时排在活动会话之后，并带"已归档（N）"分区标题，
      // 这样滚动到列表末尾就能看出哪些是归档的，而不是混在时间序里。
      var activeSessions = [];
      var archivedSessions = [];
      for (var si = 0; si < sessions.length; si++) {
        var session = sessions[si];
        if (session.archived && !session.restoredLocally) archivedSessions.push(session);
        else activeSessions.push(session);
      }
      var shown = 0;
      function appendGroup(list) {
        var lineage = buildSessionLineage(list);
        var count = 0;
        for (var i = 0; i < lineage.length; i++) {
          var s = lineage[i].session;
          var title = sessionDisplayTitle(s);
          if (query && title.toLowerCase().indexOf(query) < 0) continue;
          count++;
          drawerList.appendChild(makeSessionRow(s, current, lineage[i].depth));
        }
        return count;
      }
      shown += appendGroup(activeSessions);
      var archivedHeaderEl = null;
      if (archivedShown && archivedSessions.length) {
        archivedHeaderEl = document.createElement('div');
        archivedHeaderEl.className = 'drawer-section-title';
        archivedHeaderEl.textContent = t('archivedSection', { count: archivedSessions.length });
        drawerList.appendChild(archivedHeaderEl);
        shown += appendGroup(archivedSessions);
      }
      // 刚点开"显示已归档"：把抽屉滚到归档分区，让这次点击的效果立刻可见。
      if (archivedShown && !lastArchivedShown && archivedHeaderEl && typeof archivedHeaderEl.offsetTop === 'number') {
        if (drawerList.scrollTo) drawerList.scrollTo({ top: Math.max(0, archivedHeaderEl.offsetTop - 4) });
        else drawerList.scrollTop = Math.max(0, archivedHeaderEl.offsetTop - 4);
      }
      lastArchivedShown = archivedShown;
      var search = state.sessionSearch;
      var hits = (query && search && search.query === drawerSearch.value.trim()) ? (search.items || []) : [];
      if (hits.length) {
        var hitsTitle = document.createElement('div');
        hitsTitle.className = 'drawer-section-title';
        hitsTitle.textContent = t('searchResults');
        drawerList.appendChild(hitsTitle);
        for (var hi = 0; hi < hits.length; hi++) {
          (function (hit) {
            var known = null;
            for (var k = 0; k < sessions.length; k++) {
              if (sessions[k].sessionId === hit.sessionId) { known = sessions[k]; break; }
            }
            var row = document.createElement('div');
            row.className = 'drawer-item drawer-hit';
            var hitMain = document.createElement('div');
            hitMain.className = 'drawer-main';
            var hitTitle = document.createElement('div');
            hitTitle.className = 'drawer-title-text';
            hitTitle.textContent = known ? sessionDisplayTitle(known) : hit.sessionId;
            hitMain.appendChild(hitTitle);
            var snippet = document.createElement('div');
            snippet.className = 'drawer-meta drawer-snippet';
            snippet.textContent = hit.snippet || '';
            hitMain.appendChild(snippet);
            row.appendChild(hitMain);
            row.addEventListener('click', function () {
              if (hit.sessionId !== state.selectedSessionId) post({ type: 'selectSession', sessionId: hit.sessionId });
              closeSessionDrawer();
            });
            drawerList.appendChild(row);
          })(hits[hi]);
        }
      }
      if (!shown && !hits.length && !state.ungroupedOpen) {
        var empty = document.createElement('div');
        empty.className = 'drawer-empty';
        empty.textContent = t('noSessions');
        drawerList.appendChild(empty);
      }
      if (state.ungroupedOpen) renderUngroupedSection(query);
    }

    function renderUngroupedSection(query) {
      var sec = document.createElement('div');
      sec.className = 'drawer-section';
      var head = document.createElement('div');
      head.className = 'drawer-section-head';
      var headTitle = document.createElement('span');
      headTitle.textContent = t('ungroupedTitle');
      head.appendChild(headTitle);
      var items = state.ungroupedItems || [];
      if (query) {
        items = items.filter(function (s) {
          return sessionDisplayTitle(s).toLowerCase().indexOf(query) >= 0;
        });
      }
      if (!state.ungroupedError && items.length > 1) {
        var spacer = document.createElement('span');
        spacer.className = 'section-spacer';
        head.appendChild(spacer);
        var allBtn = document.createElement('button');
        allBtn.className = 'drawer-load-all';
        allBtn.textContent = t('loadUngroupedAll');
        allBtn.title = t('loadUngroupedAll');
        allBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          showToast(t('loadingUngrouped'), '', true);
          post({ type: 'attachUngroupedAll' });
        });
        head.appendChild(allBtn);
      }
      sec.appendChild(head);
      if (!items.length) {
        var empty = document.createElement('div');
        empty.className = 'drawer-empty';
        empty.textContent = state.ungroupedError
          ? t('ungroupedLoadFailed', { message: state.ungroupedError })
          : t('ungroupedEmpty');
        sec.appendChild(empty);
        drawerList.appendChild(sec);
        return;
      }
      for (var i = 0; i < items.length; i++) {
        (function (s) {
          var item = document.createElement('div');
          item.className = 'drawer-item ungrouped' + (s.running ? ' running' : '');
          item.setAttribute('data-session-id', s.sessionId);
          var dot = document.createElement('span');
          dot.className = 'drawer-dot';
          item.appendChild(dot);
          var main = document.createElement('div');
          main.className = 'drawer-main';
          var titleEl = document.createElement('div');
          titleEl.className = 'drawer-title-text';
          titleEl.textContent = sessionDisplayTitle(s);
          main.appendChild(titleEl);
          var meta = document.createElement('div');
          meta.className = 'drawer-meta';
          var parts = [];
          if (s.running) parts.push(t('running'));
          if (s.updatedAt) parts.push(relativeTime(s.updatedAt));
          meta.textContent = parts.join(' · ');
          main.appendChild(meta);
          item.appendChild(main);
          var actions = document.createElement('div');
          actions.className = 'drawer-actions';
          var loadBtn = makeDrawerAction('loadUngrouped', t('loadUngrouped'), t('loadUngrouped'));
          loadBtn.classList.add('primary');
          actions.appendChild(loadBtn);
          item.appendChild(actions);
          item.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
            if (!btn) return;
            if (btn.getAttribute('data-action') === 'loadUngrouped') {
              showToast(t('loadingUngrouped'), '', true);
              post({ type: 'attachUngrouped', sessionId: s.sessionId });
            }
          });
          sec.appendChild(item);
        })(items[i]);
      }
      drawerList.appendChild(sec);
    }

    function openSessionDrawer() {
      sessionsDrawer.classList.add('open');
      moreMenu.classList.remove('open');
      drawerSearch.value = '';
      renderSessions();
      if (state.ungroupedOpen) post({ type: 'getUngroupedSessions' });
      drawerSearch.focus();
    }

    function closeSessionDrawer() { sessionsDrawer.classList.remove('open'); }

    function toggleSessionDrawer() {
      if (sessionsDrawer.classList.contains('open')) closeSessionDrawer();
      else openSessionDrawer();
    }

    function openMoreMenu() {
      moreMenu.classList.add('open');
      sessionsDrawer.classList.remove('open');
      renderSessions();
    }

    function closeMoreMenu() { moreMenu.classList.remove('open'); }

    function showToast(text, kind, persist) {
      toastEl.className = 'toast open' + (kind ? ' ' + kind : '');
      toastEl.innerHTML = '';
      if (persist) {
        var sp = document.createElement('span');
        sp.className = 'spinner';
        toastEl.appendChild(sp);
      }
      var span = document.createElement('span');
      span.textContent = text;
      toastEl.appendChild(span);
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = 0; }
      if (!persist) {
        toastTimer = setTimeout(function () { toastEl.classList.remove('open'); toastTimer = 0; }, 1800);
      }
    }

    function hideToast() {
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = 0; }
      toastEl.classList.remove('open');
    }

    function renderStatus() {
      var status = state.status;
      $('statusDot').className = 'status-dot ' + status;
      var textMap = {
        discovering: t('status.discovering'),
        starting: t('status.starting'),
        ready: t('status.ready'),
        reconnecting: t('status.reconnecting'),
        stopped: t('status.stopped'),
        error: t('status.error')
      };
      $('statusText').textContent = textMap[status] || status;
      // stopped/error 状态可点击：重新探测 dsh web 实例。
      var retryable = status === 'stopped' || status === 'error';
      var badge = $('statusText').parentElement;
      badge.classList.toggle('retryable', retryable);
      badge.title = retryable ? t('statusRetry') : '';
      sendBtn.disabled = status !== 'ready';
      updatePromptStashButtons();
      modelBtn.disabled = status !== 'ready';
      modelSelectEl.disabled = status !== 'ready';
      effortSelectEl.disabled = status !== 'ready';
    }

    function currentSession() {
      var sessions = state.sessions || [];
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].sessionId === state.selectedSessionId) return sessions[i];
      }
      return null;
    }

    /**
     * 会话模式（agent preset）的显示名，用于抽屉行右侧的模式标签：
     * 宿主 `agentPresets/list` 的名字优先（自定义 preset 只有它有），其次是内置 id 的
     * 本地化短名（dsh 的 PTC 模式 id 实际是 `ptc`，历史映射里写作 `code`），最后退回原始 id。
     */
    function sessionModeLabel(id) {
      if (!id) return '';
      var presets = state.presets || [];
      for (var i = 0; i < presets.length; i++) {
        if (presets[i].id === id && presets[i].name) return presets[i].name;
      }
      var isEn = state.language === 'en';
      var builtInNames = {
        standard: isEn ? 'Standard' : '标准模式',
        ptc: isEn ? 'PTC Mode' : 'PTC 模式',
        code: isEn ? 'PTC Mode' : 'PTC 模式',
        minimal: isEn ? 'Minimal' : '极简模式',
        cordis: isEn ? 'Creative' : '创造模式',
      };
      return builtInNames[id] || String(id);
    }

    /** 会话行用的模式 id：宿主下发的 agentPreset → 投影值（hydrate 首帧可能只有投影）。 */
    function sessionModeId(session) {
      if (!session) return '';
      if (typeof session.agentPreset === 'string' && session.agentPreset) return session.agentPreset;
      var projected = session.projections && session.projections.values && session.projections.values.agentPreset;
      return typeof projected === 'string' ? projected : '';
    }

    function presetName(id) {
      var presets = state.presets || [];
      for (var i = 0; i < presets.length; i++) {
        if (presets[i].id === id) return presets[i].name || id;
      }
      return id || '选择…';
    }

    // 内置工作模式的名称/描述按界面语言本地化（插件自定义 preset 保留宿主返回的文案）。
    function builtInPresetText(id, lang) {
      var isEn = lang === 'en';
      var names = {
        standard: isEn ? 'Standard' : '标准模式',
        code: isEn ? 'PTC Mode' : 'PTC 模式',
        minimal: isEn ? 'Minimal' : '极简模式',
        cordis: isEn ? 'Creative' : '创造模式',
      };
      var descs = {
        standard: isEn
          ? 'Full-featured coding Agent with file editing, Shell, file/web search, Skills, planning, goals, subagents, and workflows.'
          : '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
        code: isEn
          ? 'All Standard capabilities, presenting tools through the Code Mode SDK so the model composes multi-step operations in a TypeScript program.'
          : '具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
        minimal: isEn
          ? 'A dual-tool coding Agent with only persistent bash and str_replace_editor.'
          : '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
        cordis: isEn
          ? 'For creating custom Agent presets: all Standard capabilities plus runtime inspection, plugin experiments, and preset authoring guidance.'
          : '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
      };
      if (names[id] === undefined && descs[id] === undefined) return null;
      return { name: names[id] || id, desc: descs[id] || '' };
    }

    function renderBlankSessionWelcome() {
      chatEl.innerHTML = '';
      var session = currentSession();
      var wrap = document.createElement('div');
      wrap.className = 'mode-welcome';
      // 空白新会话默认停留在"新会话"模式：先显示就绪提示，再提供工作模式选择。
      var hint = document.createElement('div');
      hint.className = 'mode-welcome-hint';
      hint.textContent = t('emptyReady');
      wrap.appendChild(hint);
      var title = document.createElement('div');
      title.className = 'mode-welcome-title';
      title.textContent = t('selectMode');
      var desc = document.createElement('div');
      desc.className = 'mode-welcome-desc';
      desc.textContent = t('selectModeDesc');
      wrap.appendChild(title);
      wrap.appendChild(desc);
      var list = document.createElement('div');
      list.className = 'preset-list';
      // 0.1.5-rc.2 起后端可关闭未命名新会话的模式选择（modeSelectionEnabled=false）：
      // 此时只显示"新会话已就绪"提示，不再给模式卡片。
      var presets = state.modeSelectionEnabled === false ? [] : (state.presets || []);
      for (var i = 0; i < presets.length; i++) {
        (function (preset) {
          var div = document.createElement('div');
          div.className = 'preset-item';
          if (session && session.agentPreset === preset.id) div.classList.add('selected');
          var localized = builtInPresetText(preset.id, state.language);
          var name = document.createElement('div');
          name.className = 'pname';
          name.textContent = localized ? localized.name : (preset.name || preset.id);
          var desc = document.createElement('div');
          desc.className = 'pdesc';
          desc.textContent = localized ? localized.desc : (preset.description || '');
          div.appendChild(name);
          div.appendChild(desc);
          div.addEventListener('click', function () {
            if (!state.selectedSessionId || !preset.id) return;
            // 乐观选中：立即重绘选中态，避免宿主往返期间“点了没反应”。
            var selected = currentSession();
            if (selected) selected.agentPreset = preset.id;
            renderBlankSessionWelcome();
            post({ type: 'selectAgentPreset', sessionId: state.selectedSessionId, agentPreset: preset.id });
          });
          list.appendChild(div);
        })(presets[i]);
      }
      if (!presets.length && state.modeSelectionEnabled !== false) {
        var loading = document.createElement('div');
        loading.className = 'hint';
        loading.textContent = t('loadingModes');
        list.appendChild(loading);
      }
      wrap.appendChild(list);
      chatEl.appendChild(wrap);
      chatEl.scrollTop = chatEl.scrollHeight;
    }
