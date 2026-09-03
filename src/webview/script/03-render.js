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
              // 未添加工作区：提示 + “将当前文件夹添加到 dsh 工作区”按钮。
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

      // 节点已在 DOM 且顺序正确时不再重复 appendChild；“加载更早”会在头部插入新消息
      // （首节点不再是 expectedPrev），此时整体重建消息区（保留“加载更早”按钮）。
      if (itemNodes.size > 0 && displayItems.length > 0) {
        var firstItem = displayItems[0];
        var firstKey = firstItem.id || (firstItem.type + '-0');
        var firstRec = itemNodes.get(firstKey);
        if (firstRec && firstRec.node && firstRec.node.parentNode === chatEl) {
          var expectedPrev = earlierWrapEl || null;
          if (firstRec.node.previousSibling !== expectedPrev) {
            while (chatEl.lastChild && chatEl.lastChild !== earlierWrapEl) chatEl.removeChild(chatEl.lastChild);
            itemNodes.clear();
          }
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

      if (wasNearBottom) {
        chatEl.scrollTop = chatEl.scrollHeight;
      }
      // 未在底部时保持原滚动位置（节点复用不会重置滚动）。
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

    function sessionDisplayTitle(s) {
      if (!s) return '';
      if (s.title) return s.title;
      var projectedTitle = s.projections && s.projections.values && s.projections.values.title;
      if (typeof projectedTitle === 'string' && projectedTitle) return projectedTitle;
      if (s.blank) return t('blankTitle');
      var id = String(s.sessionId || '');
      var short = id.indexOf('session-') === 0 ? id.slice('session-'.length) : id;
      short = short.slice(0, 8);
      return short ? t('session') + ' ' + short : t('session');
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
      var shown = 0;
      for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        var title = sessionDisplayTitle(s);
        if (query && title.toLowerCase().indexOf(query) < 0) continue;
        shown++;
        var item = document.createElement('div');
        item.className = 'drawer-item'
          + (s.sessionId === current ? ' selected' : '')
          + (s.running ? ' running' : '');
        item.setAttribute('data-session-id', s.sessionId);
        var dot = document.createElement('span');
        dot.className = 'drawer-dot';
        item.appendChild(dot);
        var main = document.createElement('div');
        main.className = 'drawer-main';
        var titleEl = document.createElement('div');
        titleEl.className = 'drawer-title-text';
        titleEl.textContent = title;
        main.appendChild(titleEl);
        var meta = document.createElement('div');
        meta.className = 'drawer-meta';
        var parts = [];
        if (s.archived) parts.push(t('archived'));
        if (s.running) parts.push(t('running'));
        if (s.updatedAt) parts.push(relativeTime(s.updatedAt));
        meta.textContent = parts.join(' · ');
        main.appendChild(meta);
        item.appendChild(main);
        var actions = document.createElement('div');
        actions.className = 'drawer-actions';
        actions.appendChild(makeDrawerAction('forkSession', '⧉', t('forkSession')));
        actions.appendChild(makeDrawerAction('renameSession', '✎', t('renameSession')));
        actions.appendChild(makeDrawerAction('closeSession', '✕', t('closeSession')));
        item.appendChild(actions);
        item.addEventListener('click', function (ev) {
          var itemEl = ev.currentTarget;
          var sid = itemEl.getAttribute('data-session-id');
          var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
          if (btn) {
            var kind = btn.getAttribute('data-action');
            if (kind === 'forkSession') {
              showToast('正在 fork 会话…', '', true);
              post({ type: 'forkSession', sessionId: sid });
            } else if (kind === 'renameSession') post({ type: 'renameSession', sessionId: sid });
            else if (kind === 'closeSession') openArchiveModal(sid);
            closeSessionDrawer();
            return;
          }
          if (sid && sid !== state.selectedSessionId) post({ type: 'selectSession', sessionId: sid });
          closeSessionDrawer();
        });
        drawerList.appendChild(item);
      }
      if (!shown && !state.ungroupedOpen) {
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
      var presets = state.presets || [];
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
            post({ type: 'selectAgentPreset', sessionId: state.selectedSessionId, agentPreset: preset.id });
          });
          list.appendChild(div);
        })(presets[i]);
      }
      if (!presets.length) {
        var loading = document.createElement('div');
        loading.className = 'hint';
        loading.textContent = t('loadingModes');
        list.appendChild(loading);
      }
      wrap.appendChild(list);
      chatEl.appendChild(wrap);
      chatEl.scrollTop = chatEl.scrollHeight;
    }
