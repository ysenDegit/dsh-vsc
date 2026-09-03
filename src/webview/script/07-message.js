    // 切换/清空选中会话时，立即丢弃上一会话的会话级 UI 状态，
    // 避免新会话消息未到达前闪出旧会话内容，或归档/删除后仍显示旧数据。
    function clearSessionState() {
      state.conversation = [];
      state.queueItems = [];
      state.hasMoreEarlier = false;
      state.loadingEarlier = false;
      state.pendingQuestion = null;
      state.pendingApproval = null;
      state.todos = [];
      state.permissions = null;
      state.models = null;
      state.commands = [];
      state.commandsAvailable = false;
      setRunning(false);
    }

    window.addEventListener('message', function (event) {
      var msg = event.data;
      switch (msg.type) {
        case 'hydrate':
          state.status = msg.status;
          state.workspace = msg.workspace;
          state.sessions = msg.sessions || [];
          // hydrate 总是携带 selectedSessionId（可能是 null）；显式更新，
          // 否则“无会话/已删除工作区”时 webview 会残留上一次选择。
          if (msg.selectedSessionId !== undefined) state.selectedSessionId = msg.selectedSessionId;
          state.conversation = msg.conversation || [];
          state.sessionDisplay = msg.sessionDisplay || 'concise';
          state.fontSize = Number(msg.fontSize) || 13;
          var maxWidthVal = Number(msg.maxWidth);
          state.maxWidth = Number.isFinite(maxWidthVal) && maxWidthVal >= 0 ? maxWidthVal : 1000;
          state.language = msg.language === 'en' ? 'en' : 'zh';
          state.enterToSend = msg.enterToSend === true;
          state.showContextUsage = msg.showContextUsage !== false;
          state.contextBarColor = msg.contextBarColor || 'var(--accent)';
          var opacityVal = Number(msg.contextBarOpacity);
          state.contextBarOpacity = Number.isFinite(opacityVal) && opacityVal >= 0 && opacityVal <= 100 ? opacityVal : 30;
          state.autoStart = msg.autoStart !== false;
          state.autoOpenChat = msg.autoOpenChat !== false;
          state.showArchivedSessions = msg.showArchivedSessions === true;
          applyFontSize();
          applyMaxWidth();
          updateContextBar(null);
          state.queueItems = msg.queue || [];
          state.hasMoreEarlier = msg.hasMoreEarlier || false;
          state.loadingEarlier = false;
          state.pendingQuestion = msg.question || null;
          state.pendingApproval = msg.approval || null;
          state.todos = msg.todos || [];
          state.permissions = msg.permissions || null;
          resetQuestionDrafts();
          setRunning(msg.running || false);
          renderAll();
          // 首帧即渲染统计行/权限按钮/TODO 面板：hydrate 自带统计快照，
          // 不依赖后续 stats 消息（可能因启动竞态丢失或晚到）。
          renderStats(msg.stats || null);
          if (state.selectedSessionId) {
            post({ type: 'modelsOpen', sessionId: state.selectedSessionId });
            post({ type: 'commandsOpen', sessionId: state.selectedSessionId });
          }
          break;
        case 'serviceStatus':
          state.status = msg.status;
          renderStatus();
          if (msg.status === 'ready') post({ type: 'ready' });
          break;
        case 'workspace':
          state.workspace = msg.workspace;
          break;
        case 'sessions': {
          var previousSessionId = state.selectedSessionId;
          state.sessions = msg.sessions || [];
          // sessions 总是携带 selectedSessionId（可为 null）；显式更新以支持清空。
          if (msg.selectedSessionId !== undefined) state.selectedSessionId = msg.selectedSessionId;
          if (state.selectedSessionId !== previousSessionId) clearSessionState();
          renderSessions();
          renderConversation();
          // 启动竞态兜底：若模型/命令目录从未成功加载（首帧 hydrate 早于会话就绪），
          // 在会话快照刷新时补发打开请求，而不是等用户切换会话。
          var needModels = !state.models && !!state.selectedSessionId;
          var needCommands = !state.commandsAvailable && !!state.selectedSessionId;
          if (state.selectedSessionId &&
              (state.selectedSessionId !== previousSessionId || needModels || needCommands)) {
            post({ type: 'modelsOpen', sessionId: state.selectedSessionId });
            post({ type: 'commandsOpen', sessionId: state.selectedSessionId });
          }
          break;
        }
        case 'presets':
          state.presets = msg.presets || [];
          renderConversation();
          break;
        case 'models':
          if (msg.sessionId === state.selectedSessionId) {
            state.models = msg.models || null;
            renderModels();
          }
          break;
        case 'stats':
          if (msg.sessionId === state.selectedSessionId) {
            if (msg.stats) {
              state.todos = msg.stats.todos || [];
              state.permissions = msg.stats.permissions || null;
            }
            renderStats(msg.stats || null);
          }
          break;
        case 'settingsData':
          renderSettingsData(msg.data || { writable: false });
          break;
        case 'sessionDisplay':
          state.sessionDisplay = msg.value || 'concise';
          updateWorkingBar();
          renderConversation();
          break;
        case 'fontSize':
          state.fontSize = Number(msg.value) || 13;
          applyFontSize();
          break;
        case 'maxWidth':
          state.maxWidth = Number(msg.value) >= 0 ? Number(msg.value) : 0;
          applyMaxWidth();
          break;
        case 'showContextUsage':
          state.showContextUsage = msg.value !== false;
          updateContextBar(null);
          break;
        case 'contextBarColor':
          state.contextBarColor = msg.value || 'var(--accent)';
          updateContextBar(null);
          break;
        case 'contextBarOpacity':
          state.contextBarOpacity = Number(msg.value) >= 0 ? Math.min(100, Number(msg.value)) : 30;
          updateContextBar(null);
          break;
        case 'language':
          state.language = msg.value === 'en' ? 'en' : 'zh';
          applyLanguage();
          break;
        case 'enterToSend':
          state.enterToSend = msg.value === true;
          composerInput.placeholder = state.enterToSend ? t('composerPlaceholder') : t('composerPlaceholderAlt');
          break;
        case 'autoStart':
          state.autoStart = msg.value !== false;
          break;
        case 'autoOpenChat':
          state.autoOpenChat = msg.value !== false;
          break;
        case 'showArchivedSessions':
          state.showArchivedSessions = msg.value === true;
          break;
        case 'conversation':
          // 只处理当前选中会话的帧。这里绝不使用帧里携带的 selectedSessionId 反向覆盖
          // 用户的最新选择：旧会话在切换后仍可能有在途会话帧（运行中高频出现），
          // 一旦晚到会把选中会话“偷”回去，表现为切换失败、需要反复点选。
          // 同时也不在每次流式 chunk 时重建 Sessions 抽屉（renderSessions 会整棵
          // 重建 drawerList），否则运行中的高频刷新会在点击过程中替换 DOM 节点，
          // 导致 click 事件丢失，进一步放大“多次点选才能切换”的问题。
          if (msg.sessionId !== state.selectedSessionId) break;
          var wasRunning = state.running;
          state.conversation = msg.conversation || [];
          state.hasMoreEarlier = msg.hasMoreEarlier || false;
          state.loadingEarlier = false;
          setRunning(msg.running || false);
          // 流式 chunk 合并渲染（~16ms 一帧）；回合结束时立即刷新。
          if (wasRunning && !state.running) flushConversationRender();
          else scheduleConversationRender();
          break;
        case 'selectedSession':
          state.selectedSessionId = msg.sessionId;
          break;
        case 'filePickList':
          state.fileList = msg.files || [];
          if (inputEl.value.indexOf('@') >= 0) {
            var atIdx = inputEl.value.lastIndexOf('@');
            renderFilePicker(inputEl.value.slice(atIdx + 1));
          } else {
            renderFilePicker('');
          }
          break;
        case 'commands':
          if (msg.sessionId === state.selectedSessionId) {
            state.commands = msg.items || [];
            state.commandsAvailable = msg.available;
            if (inputEl.value.charAt(0) === '/') {
              var sp = inputEl.value.indexOf(' ');
              renderCommandPicker(sp === -1 ? inputEl.value.slice(1) : inputEl.value.slice(1, sp));
            }
          }
          break;
        case 'attachmentData':
          if (msg.attachmentId) {
            if (!msg.error) attachmentCache[msg.attachmentId] = { mediaType: msg.mediaType, data: msg.data };
            var imgSlots = document.querySelectorAll('.msg-image[data-attachment-id="' + msg.attachmentId + '"]');
            for (var si = 0; si < imgSlots.length; si++) fillImageSlot(imgSlots[si], msg);
          }
          break;
        case 'queue':
          if (msg.sessionId === state.selectedSessionId) {
            state.queueItems = msg.items || [];
            renderQueue();
          }
          break;
        case 'question':
          if (msg.sessionId === state.selectedSessionId) {
            state.pendingQuestion = msg.pending || null;
            resetQuestionDrafts();
            renderQuestion();
            updateQuestionUi();
          }
          break;
        case 'approval':
          if (msg.sessionId === state.selectedSessionId) {
            state.pendingApproval = msg.pending || null;
            renderApproval();
            updateQuestionUi();
          }
          break;
        case 'notice':
          // 状态栏提示可忽略，保持界面安静
          break;
        case 'forkDone':
          showToast('fork 完成：' + (msg.title || '新会话'), 'ok', false);
          break;
        case 'forkError':
          showToast(msg.message || 'fork 失败', 'error', false);
          break;
        case 'ungroupedSessions':
          state.ungroupedItems = msg.items || [];
          state.ungroupedError = msg.error || null;
          renderSessions();
          break;
        case 'ungroupedAttachDone':
          hideToast();
          if (msg.ok) {
            showToast(msg.title
              ? t('ungroupedLoadedOne', { title: msg.title })
              : t('ungroupedLoaded', { count: 1 }), 'ok', false);
          } else {
            showToast(t('ungroupedLoadFailed', { message: msg.message || '' }), 'error', false);
          }
          break;
        case 'ungroupedAttachAllDone':
          hideToast();
          if (msg.failed > 0) {
            showToast(t('ungroupedLoadFailed', { message: msg.message || (msg.done + ' ok / ' + msg.failed + ' failed') }), 'error', false);
          } else {
            showToast(t('ungroupedLoaded', { count: msg.done }), 'ok', false);
          }
          break;
      }
    });

    post({ type: 'ready' });
