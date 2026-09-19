    function closePicker() {
      filePicker.classList.remove('open');
      commandPicker.classList.remove('open');
    }

    function closeModelPopover() {
      modelPopover.classList.remove('open');
    }

    function toggleModelPopover() {
      modelPopover.classList.toggle('open');
    }

    function renderFilePicker(query) {
      filePicker.innerHTML = '';
      var files = state.fileList || [];
      var q = (query || '').toLowerCase();
      var shown = 0;
      for (var i = 0; i < files.length && shown < 80; i++) {
        var path = files[i];
        var base = path.split('/').pop().toLowerCase();
        if (q && base.indexOf(q) === -1 && path.toLowerCase().indexOf(q) === -1) continue;
        shown++;
        (function (filePath) {
          var div = document.createElement('div');
          div.className = 'item';
          div.textContent = filePath;
          div.addEventListener('click', function () {
            replaceAtToken(filePath);
          });
          filePicker.appendChild(div);
        })(path);
      }
      if (!shown) {
        filePicker.innerHTML = '<div class="hint" style="padding:6px">没有匹配的文件</div>';
      }
      filePicker.classList.add('open');
      commandPicker.classList.remove('open');
    }

    function renderCommandPicker(query) {
      commandPicker.innerHTML = '';
      var commands = state.commands || [];
      var q = (query || '').toLowerCase();
      var shown = 0;
      for (var i = 0; i < commands.length && shown < 60; i++) {
        var cmd = commands[i];
        if (q && String(cmd.name || '').toLowerCase().indexOf(q) !== 0) continue;
        shown++;
        (function (command) {
          var div = document.createElement('div');
          div.className = 'item';
          var name = document.createElement('div');
          name.textContent = '/' + command.name + (command.hint ? ' ' + command.hint : '');
          var desc = document.createElement('div');
          desc.className = 'desc';
          desc.textContent = command.description || '';
          div.appendChild(name);
          div.appendChild(desc);
          div.addEventListener('click', function () {
            replaceCommandToken(command.name);
          });
          commandPicker.appendChild(div);
        })(cmd);
      }
      if (!shown) {
        commandPicker.innerHTML = '<div class="hint" style="padding:6px">没有匹配的命令</div>';
      }
      commandPicker.classList.add('open');
      filePicker.classList.remove('open');
    }

    function replaceAtToken(filePath) {
      var value = inputEl.value;
      var atIdx = value.lastIndexOf('@');
      var before = atIdx >= 0 ? value.slice(0, atIdx) : value;
      inputEl.value = before + '@' + filePath + ' ';
      inputEl.focus();
      closePicker();
      autoResize();
    }

    function replaceCommandToken(commandName) {
      inputEl.value = '/' + commandName + ' ';
      inputEl.focus();
      closePicker();
      autoResize();
    }

    function detectPicker() {
      var value = inputEl.value;
      closePicker();
      if (value.charAt(0) === '/') {
        var spaceIdx = value.indexOf(' ');
        var query = spaceIdx === -1 ? value.slice(1) : value.slice(1, spaceIdx);
        if (query !== '' && spaceIdx !== -1) return; // 已进入参数输入，菜单收起
        renderCommandPicker(query);
        return;
      }
      var atIdx = value.lastIndexOf('@');
      if (atIdx >= 0) {
        var afterAt = value.slice(atIdx + 1);
        if (afterAt.indexOf(' ') === -1) {
          if (!state.fileList.length) post({ type: 'pickFiles' });
          renderFilePicker(afterAt);
          return;
        }
      }
    }

    function autoResize() {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    }

    function renderAll() {
      // 初始加载即按配置语言渲染按钮/占位符，而不是等用户切换语言才生效。
      applyLanguage();
      renderStatus();
      renderSessions();
      renderConversation();
      renderModels();
      renderQueue();
      renderQuestion();
      renderApproval();
      updateQuestionUi();
    }

    function sendMessage() {
      var text = inputEl.value.trim();
      if (!text && pendingImages.length === 0 && pendingFiles.length === 0) return;
      if (state.status !== 'ready') return;
      if ((pendingImages.length > 0 || pendingFiles.length > 0) && text.charAt(0) === '/') {
        var token = text.split(/s+/)[0];
        var known = null;
        var cmds = state.commands || [];
        for (var ci = 0; ci < cmds.length; ci++) {
          if (cmds[ci].name === token) { known = cmds[ci]; break; }
        }
        if (known && !known.acceptsImages) {
          showComposerNotice(t('imageCommandRefuse'));
          return;
        }
      }
      post({
        type: 'send',
        text: text,
        images: pendingImages.slice(),
        files: pendingFiles.slice(),
        clientTimeZone: clientTimeZoneName(),
      });
      inputEl.value = '';
      inputEl.style.height = 'auto';
      updateStashAddButton();
      pendingImages = [];
      pendingFiles = [];
      renderPendingImages();
      renderPendingFiles();
      closePicker();
    }

    function clientTimeZoneName() {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      } catch (e) {
        return undefined;
      }
    }

    function showComposerNotice(text) {
      var notice = $('composerNotice');
      if (!notice) return;
      notice.textContent = text;
      notice.hidden = false;
      clearTimeout(showComposerNotice._timer);
      showComposerNotice._timer = setTimeout(function () { notice.hidden = true; }, 3000);
    }

    function renderSendLabel() {
      var labelEl = sendBtn.querySelector('.send-label');
      var countEl = sendBtn.querySelector('.send-count');
      if (labelEl) labelEl.textContent = t('send');
      if (countEl) {
        var total = pendingImages.length + pendingFiles.length;
        countEl.hidden = total === 0;
        countEl.textContent = String(total);
      }
      sendBtn.title = t('send');
    }

    function renderPendingImages() {
      var rail = $('pendingImages');
      if (!rail) return;
      rail.innerHTML = '';
      renderSendLabel();
      if (pendingImages.length === 0) { rail.hidden = true; return; }
      rail.hidden = false;
      for (var i = 0; i < pendingImages.length; i++) {
        (function (img, index) {
          var box = document.createElement('div');
          box.className = 'pending-img';
          var im = document.createElement('img');
          im.src = 'data:' + img.mediaType + ';base64,' + img.data;
          im.alt = img.name || t('imageAttachment');
          var rm = document.createElement('button');
          rm.textContent = '×';
          rm.title = t('imageRemove');
          rm.addEventListener('click', function () {
            pendingImages.splice(index, 1);
            renderPendingImages();
          });
          box.appendChild(im);
          box.appendChild(rm);
          rail.appendChild(box);
        })(pendingImages[i], i);
      }
    }

    function readImageFiles(files) {
      var added = 0;
      var total = 0;
      for (var j = 0; j < files.length; j++) (function (file) {
        total++;
        var reader = new FileReader();
        reader.onload = function () {
          var dataUrl = String(reader.result || '');
          var m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
          if (!m) return;
          pendingImages.push({ mediaType: m[1], data: m[2], name: file.name || '' });
          added++;
          renderPendingImages();
          if (added === total) showComposerNotice(t('imagePicked', { count: String(added) }));
        };
        reader.onerror = function () { showComposerNotice(t('imageReadFailed')); };
        reader.readAsDataURL(file);
      })(files[j]);
    }

    function renderPendingFiles() {
      if (!pendingFilesEl) return;
      pendingFilesEl.innerHTML = '';
      if (pendingFiles.length === 0) { pendingFilesEl.hidden = true; return; }
      pendingFilesEl.hidden = false;
      for (var i = 0; i < pendingFiles.length; i++) {
        (function (entry, index) {
          var box = document.createElement('div');
          box.className = 'pending-file';
          var name = document.createElement('span');
          name.className = 'pending-file-name';
          name.textContent = entry.name || t('attachFile');
          var rm = document.createElement('button');
          rm.textContent = '×';
          rm.title = t('imageRemove');
          rm.addEventListener('click', function () {
            pendingFiles.splice(index, 1);
            renderPendingFiles();
          });
          box.appendChild(name);
          box.appendChild(rm);
          pendingFilesEl.appendChild(box);
        })(pendingFiles[i], i);
      }
    }

    /** 读取待发送文件为 base64（宿主发送前用 file-upload 的 upload 端点换 receiptId）。 */
    function readAttachFiles(files) {
      for (var j = 0; j < files.length; j++) (function (file) {
        var reader = new FileReader();
        reader.onload = function () {
          var dataUrl = String(reader.result || '');
          var m = /^data:([^;,]*);base64,(.+)$/.exec(dataUrl);
          if (!m) return;
          pendingFiles.push({ name: file.name || '', data: m[2] });
          renderPendingFiles();
          showComposerNotice(t('attachedFiles', { count: String(pendingFiles.length) }));
        };
        reader.onerror = function () {
          showComposerNotice(t('filePickFailed', { message: file.name || '' }));
        };
        reader.readAsDataURL(file);
      })(files[j]);
    }

    function imageFilesFrom(data) {
      var out = [];
      var items = data && data.items;
      if (items) {
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (it.kind === 'file' && it.type && it.type.indexOf('image/') === 0 && typeof it.getAsFile === 'function') {
            var f = it.getAsFile();
            if (f) out.push(f);
          }
        }
      }
      if (out.length === 0 && data && data.files) {
        for (var k = 0; k < data.files.length; k++) {
          var cf = data.files[k];
          if (cf && cf.type && cf.type.indexOf('image/') === 0) out.push(cf);
        }
      }
      return out;
    }

    function onComposerPaste(e) {
      var files = imageFilesFrom(e.clipboardData);
      if (files.length === 0) {
        // 诊断：记录剪贴板内容形态，便于定位远程环境拿不到图片的问题。
        var itemKinds = [];
        var cbd = e.clipboardData;
        if (cbd && cbd.items) {
          for (var di = 0; di < cbd.items.length; di++) {
            itemKinds.push(cbd.items[di].kind + ':' + cbd.items[di].type);
          }
        }
        post({ type: 'log', message: '[image] 粘贴未发现图片文件，clipboardData.items=' + (itemKinds.join(',') || '(空)') });
        // 部分 webview/远程环境剪贴板 items 不含文件：走 Clipboard API 兜底。
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.read === 'function') {
          navigator.clipboard.read().then(function (clipboardItems) {
            for (var n = 0; n < clipboardItems.length; n++) {
              var types = clipboardItems[n].types || [];
              for (var ti = 0; ti < types.length; ti++) {
                if (types[ti].indexOf('image/') === 0) {
                  clipboardItems[n].getType(types[ti]).then(function (blob) {
                    if (blob) readImageFiles([blob]);
                  }).catch(function () {});
                  return;
                }
              }
            }
          }).catch(function (err) {
            post({ type: 'log', message: '[image] navigator.clipboard.read 失败: ' + String(err) });
          });
        } else {
          post({ type: 'log', message: '[image] navigator.clipboard 不可用' });
        }
        return;
      }
      e.preventDefault();
      readImageFiles(files);
    }

    function requestAttachment(attachmentId) {
      if (!attachmentId || attachmentRequested[attachmentId]) return;
      attachmentRequested[attachmentId] = true;
      if (state.selectedSessionId) {
        post({ type: 'loadAttachment', sessionId: state.selectedSessionId, attachmentId: attachmentId });
      }
    }

    function fillImageSlot(slot, msg) {
      slot.innerHTML = '';
      if (msg.error || !msg.data) {
        var ph = document.createElement('span');
        ph.className = 'img-placeholder';
        ph.textContent = msg.error ? t('imageLoadFailed') : t('imageLoading');
        slot.appendChild(ph);
        return;
      }
      var im = document.createElement('img');
      im.src = 'data:' + (msg.mediaType || 'image/png') + ';base64,' + msg.data;
      im.alt = t('imageAttachment');
      slot.appendChild(im);
    }

    function workingPhase() {
      if (!state.running) return 'idle';
      var items = state.conversation || [];
      for (var i = items.length - 1; i >= 0; i--) {
        var item = items[i];
        if (item.type === 'tool' && item.status === 'call') return 'tool';
        if (item.type === 'assistant' && item.partial) {
          if (typeof item.text === 'string' && item.text.trim().length > 0) return 'output';
          if (typeof item.reasoning === 'string' && item.reasoning.trim().length > 0) return 'thinking';
        }
      }
      return 'thinking';
    }

    function updateWorkingBar() {
      // 会话显示模式（简洁/详细）均显示左下角工作状态（working）。
      workIndicatorEl.style.display = 'inline-flex';
      workIndicatorEl.className = 'work-indicator ' + workingPhase();
    }

    function renderQueue() {
      queueDockEl.innerHTML = '';
      var items = state.queueItems || [];
      if (!items.length) {
        queueDockEl.classList.remove('open');
        return;
      }
      queueDockEl.classList.add('open');
      for (var i = 0; i < items.length; i++) {
        (function (item) {
          var row = document.createElement('div');
          row.className = 'queue-item';
          var label = document.createElement('span');
          label.className = 'queue-label';
          label.textContent = t('queued');
          var text = document.createElement('span');
          text.className = 'queue-text';
          text.textContent = item.text || '';
          var edit = document.createElement('button');
          edit.className = 'queue-action';
          edit.textContent = '✎';
          edit.title = t('queueEdit');
          edit.addEventListener('click', function () {
            post({ type: 'queueEdit', sessionId: state.selectedSessionId, itemId: item.id });
          });
          var steer = document.createElement('button');
          steer.className = 'queue-action';
          steer.textContent = '⏭';
          steer.title = t('queueSteer');
          steer.addEventListener('click', function () {
            post({ type: 'queueSteer', sessionId: state.selectedSessionId, itemId: item.id });
          });
          var remove = document.createElement('button');
          remove.className = 'queue-remove';
          remove.textContent = '✕';
          remove.title = t('queueRemove');
          remove.addEventListener('click', function () {
            post({ type: 'queueRemove', sessionId: state.selectedSessionId, itemId: item.id });
          });
          row.appendChild(label);
          row.appendChild(text);
          row.appendChild(edit);
          row.appendChild(steer);
          row.appendChild(remove);
          queueDockEl.appendChild(row);
        })(items[i]);
      }
    }

    function renderTodos() {
      var todos = state.todos || [];
      if (!todos.length) {
        todoDockEl.classList.remove('open');
        return;
      }
      todoDockEl.classList.add('open');
      var done = 0;
      var active = 0;
      var pending = 0;
      for (var i = 0; i < todos.length; i++) {
        if (todos[i].status === 'completed') done++;
        else if (todos[i].status === 'in_progress') active++;
        else pending++;
      }
      var progressParts = [];
      if (done) progressParts.push(t('todoDone', { n: done }));
      if (active) progressParts.push(t('todoActive', { n: active }));
      if (pending) progressParts.push(t('todoPending', { n: pending }));
      todoDockEl.innerHTML = '';
      var header = document.createElement('div');
      header.className = 'todo-header';
      var title = document.createElement('span');
      title.className = 'todo-title';
      title.textContent = t('todoTitle');
      var progress = document.createElement('span');
      progress.className = 'todo-progress';
      progress.textContent = progressParts.join(' · ');
      var toggle = document.createElement('span');
      toggle.className = 'todo-toggle';
      toggle.textContent = todosCollapsed ? '▸' : '▾';
      header.appendChild(title);
      header.appendChild(toggle);
      header.appendChild(progress);
      header.addEventListener('click', function () {
        todosCollapsed = !todosCollapsed;
        toggle.textContent = todosCollapsed ? '▸' : '▾';
        todoDockEl.classList.toggle('collapsed', todosCollapsed);
      });
      todoDockEl.appendChild(header);
      var list = document.createElement('div');
      list.className = 'todo-list';
      for (var j = 0; j < todos.length; j++) {
        (function (todo) {
          var item = document.createElement('div');
          item.className = 'todo-item';
          var dot = document.createElement('span');
          dot.className = 'todo-status ' + (todo.status || 'pending');
          var content = document.createElement('span');
          content.textContent = todo.content || '';
          item.appendChild(dot);
          item.appendChild(content);
          list.appendChild(item);
        })(todos[j]);
      }
      todoDockEl.classList.toggle('collapsed', todosCollapsed);
      todoDockEl.appendChild(list);
    }

    /** 当前权限名；未知时返回空串（**不要返回占位文案**：调用方用它判断"有没有权限可显示"，
     *  返回本地化字符串会让英文界面拿到中文、也让判断失效）。 */
    function currentPermissionLabel() {
      var permissions = state.permissions;
      if (!permissions || !permissions.options) return '';
      for (var i = 0; i < permissions.options.length; i++) {
        if (permissions.options[i].value === permissions.currentValue) {
          return permissions.options[i].name || permissions.options[i].value || '';
        }
      }
      return '';
    }

    function updatePermissionUi() {
      // 权限已集成到动作弹层；底部模型信息一并显示当前权限。
      updateModelInfo();
    }

    function closePermissionPopover() { /* 权限已集成到动作弹层，无独立弹层 */ }

    function togglePermissionPopover() { /* 权限已集成到动作弹层，无独立弹层 */ }

    function renderPermissions() {
      var permissions = state.permissions;
      if (!permissions || !Array.isArray(permissions.options) || !permissions.options.length) {
        permissionPopover.innerHTML = '';
        updatePermissionUi();
        return;
      }
      updatePermissionUi();
      permissionPopover.innerHTML = '';
      for (var i = 0; i < permissions.options.length; i++) {
        (function (option) {
          var item = document.createElement('button');
          item.className = 'mode-item' + (option.value === permissions.currentValue ? ' selected' : '');
          if (state.running) item.disabled = true;
          var nameSpan = document.createElement('span');
          nameSpan.className = 'mode-name';
          nameSpan.textContent = option.name || option.value;
          if (option.value === permissions.currentValue) {
            var check = document.createElement('span');
            check.className = 'mode-check';
            check.textContent = '✓';
            nameSpan.appendChild(check);
          }
          item.appendChild(nameSpan);
          var desc = document.createElement('div');
          desc.className = 'mode-desc';
          desc.textContent = option.description || '';
          item.appendChild(desc);
          item.title = option.description || '';
          item.addEventListener('click', function () {
            post({ type: 'permissionSelect', sessionId: state.selectedSessionId, preset: option.value });
            closeModelPopover();
            // 不乐观更新 currentValue：以 dsh 随后广播的 permissions 投影为唯一确认。
          });
          permissionPopover.appendChild(item);
        })(permissions.options[i]);
      }
    }

    function renderApproval() {
      approvalPanelEl.innerHTML = '';
      var approval = state.pendingApproval;
      if (!approval) return;
      var header = document.createElement('div');
      header.className = 'q-header';
      var title = document.createElement('span');
      title.textContent = t('toolApproval');
      header.appendChild(title);
      var spacer = document.createElement('span');
      spacer.className = 'spacer';
      header.appendChild(spacer);
      var close = document.createElement('button');
      close.textContent = '✕';
      close.title = t('reject');
      close.addEventListener('click', function () {
        post({
          type: 'approvalAnswer', sessionId: state.selectedSessionId,
          eventId: approval.eventId, rpcId: approval.eventId, approvalId: approval.approvalId, outcome: 'rejected',
        });
      });
      header.appendChild(close);
      approvalPanelEl.appendChild(header);

      var tool = document.createElement('div');
      tool.className = 'a-tool';
      tool.textContent = t('tool') + '：' + (approval.toolName || t('unknown'));
      approvalPanelEl.appendChild(tool);
      if (approval.reason) {
        var reason = document.createElement('div');
        reason.className = 'a-reason';
        reason.textContent = approval.reason;
        approvalPanelEl.appendChild(reason);
      }

      var actions = document.createElement('div');
      actions.className = 'q-actions';
      var reject = document.createElement('button');
      reject.textContent = t('reject');
      reject.addEventListener('click', function () {
        post({
          type: 'approvalAnswer', sessionId: state.selectedSessionId,
          eventId: approval.eventId, rpcId: approval.eventId, approvalId: approval.approvalId, outcome: 'rejected',
        });
      });
      actions.appendChild(reject);
      var allow = document.createElement('button');
      allow.className = 'primary';
      allow.textContent = t('allowOnce');
      allow.addEventListener('click', function () {
        post({
          type: 'approvalAnswer', sessionId: state.selectedSessionId,
          eventId: approval.eventId, rpcId: approval.eventId, approvalId: approval.approvalId, outcome: 'allowed-once',
        });
      });
      actions.appendChild(allow);
      approvalPanelEl.appendChild(actions);
    }

    function resetQuestionDrafts() {
      state.questionSelections = {};
      state.questionCustom = {};
      state.questionSkipped = {};
      state.questionIndex = 0;
      state.questionError = null;
    }

    /**
     * 换了一个提问请求（事件 id 变了）就重置分页与草稿，并从第一题开始。
     * 这样"同一会话连续提问"不会带着上一次的选择进入新面板。
     */
    function syncQuestionDrafts(pending) {
      if (!pending || !pending.eventId) return;
      if (state.questionKey === pending.eventId) return;
      resetQuestionDrafts();
      state.questionKey = pending.eventId;
    }

    function questionOnPage(pending) {
      var questions = (pending && pending.questions) || [];
      var index = Number(state.questionIndex) || 0;
      if (index < 0) index = 0;
      if (index > questions.length - 1) index = questions.length - 1;
      return questions[index] || null;
    }

    function goToQuestion(index) {
      state.questionIndex = index;
      state.questionError = null;
      renderQuestion();
    }

    /** 该题是否已有回答（选了选项或写了自定义回答）——与 web 端 answered() 同口径。 */
    function questionAnswered(q) {
      return (state.questionSelections[q.id] || []).length > 0
        || (state.questionCustom[q.id] || '').trim() !== '';
    }

    /** 该题是否"已处理"（有回答或被显式跳过）——与 web 端 completed() 同口径。 */
    function questionCompleted(q) {
      return questionAnswered(q) || state.questionSkipped[q.id] === true;
    }

    /** "（推荐）"/"(recommended)" 这类后缀拆成徽标（与 web 端 parseRecommendedLabel 同规则，
     *  提交时仍用**原始 label**，不改回答值）。 */
    function parseRecommendedLabel(label) {
      var text = String(label === null || label === undefined ? '' : label);
      var suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
      return suffix.test(text)
        ? { label: text.replace(suffix, ''), recommended: true }
        : { label: text, recommended: false };
    }

    /** "下一题"/"提交回答"：当前题没处理就停在原地提示（与 web 端 error.unanswered 一致）。 */
    function continueQuestionFlow() {
      var pending = state.pendingQuestion;
      if (!pending) return;
      var questions = pending.questions || [];
      var q = questionOnPage(pending);
      if (!q) return;
      if (!questionCompleted(q)) {
        state.questionError = t('questionUnanswered');
        renderQuestion();
        return;
      }
      state.questionError = null;
      if (state.questionIndex < questions.length - 1) {
        goToQuestion(state.questionIndex + 1);
        return;
      }
      submitQuestionAnswers();
    }

    /** "跳过本题"：标记跳过并前进；最后一题跳过 = 直接提交（与 web 端 skipQuestion 一致）。 */
    function skipCurrentQuestion() {
      var pending = state.pendingQuestion;
      if (!pending) return;
      var questions = pending.questions || [];
      var q = questionOnPage(pending);
      if (!q) return;
      state.questionSkipped[q.id] = true;
      state.questionSelections[q.id] = [];
      state.questionCustom[q.id] = '';
      state.questionError = null;
      if (state.questionIndex < questions.length - 1) {
        goToQuestion(state.questionIndex + 1);
        return;
      }
      submitQuestionAnswers();
    }

    function isPlanReviewQuestion(q) {
      if (!q || !q.intent || q.intent.kind !== 'plan-review') return false;
      if (q.multiSelect) return false;
      if (!q.detail || !Array.isArray(q.options)) return false;
      var approve = q.intent.approve;
      var hasApprove = false;
      var otherCount = 0;
      for (var i = 0; i < q.options.length; i++) {
        if (q.options[i].label === approve) hasApprove = true;
        else otherCount++;
      }
      return hasApprove && otherCount === 1;
    }

    function questionOptionValue(q, index) {
      var labels = (state.questionSelections[q.id] || []);
      return labels.indexOf(q.options[index].label) >= 0;
    }

    function toggleQuestionOption(q, index) {
      var label = q.options[index].label;
      var labels = (state.questionSelections[q.id] || []).slice();
      var pos = labels.indexOf(label);
      if (q.multiSelect) {
        if (pos >= 0) labels.splice(pos, 1);
        else labels.push(label);
      } else {
        if (pos >= 0) labels = [];
        else labels = [label];
      }
      state.questionSelections[q.id] = labels;
      state.questionSkipped[q.id] = false;
      if (!q.multiSelect) {
        // 单选：选择选项后清掉该题已输入的自定义回答（与 web 端互斥语义一致）。
        state.questionCustom[q.id] = '';
      }
      state.questionError = null;
      // 单选且不是最后一题：选完自动翻到下一题（与 web 端一致），多选留在本页继续勾。
      var questions = (state.pendingQuestion && state.pendingQuestion.questions) || [];
      if (!q.multiSelect && state.questionIndex < questions.length - 1) {
        goToQuestion(state.questionIndex + 1);
        return;
      }
      renderQuestion();
    }

    /** 单题的回答载荷（跳过的题给显式空回答，与 web 端一致）。 */
    function questionAnswerOf(q) {
      var skipped = state.questionSkipped[q.id] === true;
      var custom = (state.questionCustom[q.id] || '').trim();
      var selected = state.questionSelections[q.id] || [];
      if (skipped) return { id: q.id, selected: [] };
      if (!Array.isArray(q.options) || q.options.length === 0) {
        return { id: q.id, selected: [], custom: custom };
      }
      var answer = { id: q.id };
      // 单选 + 自定义回答：以自定义内容为准（与 web 端一致）。
      answer.selected = (!q.multiSelect && custom) ? [] : selected;
      if (custom) answer.custom = custom;
      return answer;
    }

    function submitQuestionAnswers() {
      var pending = state.pendingQuestion;
      if (!pending) return;
      var questions = pending.questions || [];
      // 逐题校验：哪一题还没处理（既没回答也没跳过）就跳到那一页并提示
      //（与 web 端 error.incomplete 的表现一致）。
      for (var i = 0; i < questions.length; i++) {
        if (questionCompleted(questions[i])) continue;
        state.questionIndex = i;
        state.questionError = t('questionIncomplete', { index: i + 1 });
        renderQuestion();
        return;
      }
      state.questionError = null;
      var answers = [];
      for (var j = 0; j < questions.length; j++) answers.push(questionAnswerOf(questions[j]));
      // dsh 的 waterfall 事件 id 字段就是 eventId（宿主快照里也是 eventId）：
      // 之前只发 rpcId（快照里没有这个字段 → undefined）导致宿主静默丢弃、面板点了没反应。
      // 保留 rpcId 作为兼容别名；**不在本地清空**，等宿主回发 pending=null 再收起，
      // 这样提交失败时面板还在、可以重试。
      post({ type: 'questionAnswer', sessionId: state.selectedSessionId, eventId: pending.eventId, rpcId: pending.eventId, answers: answers });
    }

    function cancelPendingQuestion() {
      var pending = state.pendingQuestion;
      if (!pending) return;
      post({ type: 'questionCancel', sessionId: state.selectedSessionId, eventId: pending.eventId, rpcId: pending.eventId });
      state.pendingQuestion = null;
      resetQuestionDrafts();
      renderQuestion();
      updateQuestionUi();
    }

    function appendPlanReviewPanel(pending, q) {
      var approve = q.intent.approve;
      var otherLabel = '';
      for (var i = 0; i < q.options.length; i++) {
        if (q.options[i].label !== approve) otherLabel = q.options[i].label;
      }
      var header = document.createElement('div');
      header.className = 'q-header';
      var title = document.createElement('span');
      title.textContent = t('planReview');
      header.appendChild(title);
      var spacer = document.createElement('span');
      spacer.className = 'spacer';
      header.appendChild(spacer);
      var close = document.createElement('button');
      close.textContent = '✕';
      close.title = t('chatAboutIt');
      close.addEventListener('click', cancelPendingQuestion);
      header.appendChild(close);
      questionPanelEl.appendChild(header);

      var question = document.createElement('div');
      question.className = 'q-question';
      question.textContent = q.question;
      questionPanelEl.appendChild(question);

      var detail = document.createElement('div');
      // 计划评审的正文（整份计划 markdown）单独给一个更高的高度上限，便于通读。
      detail.className = 'q-detail q-detail-plan';
      detail.innerHTML = renderMarkdown(q.detail || '');
      questionPanelEl.appendChild(detail);

      var actions = document.createElement('div');
      actions.className = 'q-actions';
      var chat = document.createElement('button');
      chat.textContent = t('chatAboutIt');
      chat.addEventListener('click', cancelPendingQuestion);
      actions.appendChild(chat);
      var refuse = document.createElement('button');
      refuse.textContent = otherLabel || t('reject');
      refuse.addEventListener('click', function () {
        post({
          type: 'questionAnswer', sessionId: state.selectedSessionId,
          eventId: pending.eventId, rpcId: pending.eventId,
          answers: [{ id: q.id, selected: [otherLabel] }],
        });
      });
      actions.appendChild(refuse);
      var approveBtn = document.createElement('button');
      approveBtn.className = 'primary';
      approveBtn.textContent = approve;
      approveBtn.addEventListener('click', function () {
        post({
          type: 'questionAnswer', sessionId: state.selectedSessionId,
          eventId: pending.eventId, rpcId: pending.eventId,
          answers: [{ id: q.id, selected: [approve] }],
        });
      });
      actions.appendChild(approveBtn);
      questionPanelEl.appendChild(actions);
    }

    function appendGenericQuestion(pending, q) {
      var block = document.createElement('div');
      block.className = 'q-block';
      if (q.header) {
        // 分组/主题标签（如"数据集目录"）：小字放在问句上方，与 web 端一致。
        var qh = document.createElement('div');
        qh.className = 'q-section';
        qh.textContent = q.header;
        block.appendChild(qh);
      }
      var qt = document.createElement('div');
      qt.className = 'q-question';
      qt.textContent = q.question;
      block.appendChild(qt);
      if (q.detail) {
        var qd = document.createElement('div');
        qd.className = 'q-detail';
        qd.innerHTML = renderMarkdown(q.detail);
        block.appendChild(qd);
      }
      if (Array.isArray(q.options) && q.options.length > 0) {
        var opts = document.createElement('div');
        opts.className = 'q-options';
        for (var i = 0; i < q.options.length; i++) {
          (function (index) {
            var label = q.options[index].label;
            var desc = q.options[index].description;
            var parsed = parseRecommendedLabel(label);
            var btn = document.createElement('button');
            btn.className = 'q-option' + (questionOptionValue(q, index) ? ' selected' : '');
            // 提交用的是**原始 label**（推荐后缀只是显示层的事）。
            btn.setAttribute('data-label', String(label));
            var idxEl = document.createElement('span');
            idxEl.className = 'q-option-idx';
            idxEl.textContent = String(index + 1);
            var mainEl = document.createElement('span');
            mainEl.className = 'q-option-main';
            var labelEl = document.createElement('span');
            labelEl.className = 'q-option-label';
            labelEl.textContent = parsed.label;
            mainEl.appendChild(labelEl);
            if (parsed.recommended) {
              var badge = document.createElement('span');
              badge.className = 'q-option-badge';
              badge.textContent = t('questionRecommended');
              mainEl.appendChild(badge);
            }
            if (desc) {
              // 说明单独一行（网页端也是这种两行排布），长说明才读得下去。
              var descEl = document.createElement('span');
              descEl.className = 'q-option-desc';
              descEl.textContent = String(desc);
              mainEl.appendChild(descEl);
            }
            btn.appendChild(idxEl);
            btn.appendChild(mainEl);
            btn.addEventListener('click', function () { toggleQuestionOption(q, index); });
            opts.appendChild(btn);
          })(i);
        }
        block.appendChild(opts);
        // 与 web 端一致：有选项的问题也允许用户自行输入回答；
        // 单选时自定义回答优先于所选选项，多选时两者共存。
        var customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.className = 'q-custom-input';
        customInput.placeholder = t('questionCustomOptional');
        customInput.value = state.questionCustom[q.id] || '';
        customInput.addEventListener('input', function () {
          state.questionCustom[q.id] = customInput.value;
          state.questionSkipped[q.id] = false;
          if (!q.multiSelect && customInput.value.trim() !== '') {
            state.questionSelections[q.id] = [];
            var optionBtns = block.querySelectorAll('.q-option');
            for (var bi = 0; bi < optionBtns.length; bi++) optionBtns[bi].classList.remove('selected');
          }
        });
        // 回车 = 下一题/提交（与 web 端一致）；中文输入法组字中的回车不算。
        customInput.addEventListener('keydown', function (event) {
          if (!event || event.isComposing) return;
          if (event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          continueQuestionFlow();
        });
        block.appendChild(customInput);
      } else {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'q-custom-input';
        input.placeholder = t('questionCustom');
        input.value = state.questionCustom[q.id] || '';
        input.addEventListener('input', function () {
          state.questionCustom[q.id] = input.value;
          state.questionSkipped[q.id] = false;
        });
        input.addEventListener('keydown', function (event) {
          if (!event || event.isComposing) return;
          if (event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          continueQuestionFlow();
        });
        block.appendChild(input);
      }
      questionPanelEl.appendChild(block);
    }

    /** 多问题时的翻页 + 跳过/下一题（最后一题是"提交回答"）。 */
    function appendQuestionNav(pending) {
      var questions = pending.questions || [];
      var total = questions.length;
      var last = state.questionIndex >= total - 1;
      var nav = document.createElement('div');
      nav.className = 'q-actions q-nav';
      var pager = document.createElement('div');
      pager.className = 'q-pager';
      var prev = document.createElement('button');
      prev.className = 'q-pager-btn q-prev';
      prev.textContent = '‹';
      prev.title = t('questionPrev');
      prev.disabled = state.questionIndex <= 0;
      prev.addEventListener('click', function () { goToQuestion(state.questionIndex - 1); });
      var page = document.createElement('span');
      page.className = 'q-page';
      page.textContent = t('questionPage', { index: state.questionIndex + 1, total: total });
      var next = document.createElement('button');
      next.className = 'q-pager-btn q-next-page';
      next.textContent = '›';
      next.title = t('questionNext');
      next.disabled = last;
      next.addEventListener('click', function () { goToQuestion(state.questionIndex + 1); });
      pager.appendChild(prev);
      pager.appendChild(page);
      pager.appendChild(next);
      nav.appendChild(pager);
      var spacer = document.createElement('span');
      spacer.className = 'spacer';
      nav.appendChild(spacer);
      var skip = document.createElement('button');
      skip.className = 'q-skip';
      skip.textContent = t('questionSkip');
      skip.title = t('questionSkipTitle');
      skip.addEventListener('click', skipCurrentQuestion);
      nav.appendChild(skip);
      var cont = document.createElement('button');
      cont.className = 'primary q-continue';
      cont.textContent = last ? t('submitAnswer') : t('questionNext');
      cont.addEventListener('click', continueQuestionFlow);
      nav.appendChild(cont);
      questionPanelEl.appendChild(nav);
    }

    function renderQuestion() {
      questionPanelEl.innerHTML = '';
      var pending = state.pendingQuestion;
      if (!pending || !pending.questions || !pending.questions.length) {
        return;
      }
      syncQuestionDrafts(pending);
      if (pending.questions.length === 1 && isPlanReviewQuestion(pending.questions[0])) {
        appendPlanReviewPanel(pending, pending.questions[0]);
        return;
      }
      var header = document.createElement('div');
      header.className = 'q-header';
      var title = document.createElement('span');
      title.textContent = t('waitingAnswer');
      header.appendChild(title);
      var spacer = document.createElement('span');
      spacer.className = 'spacer';
      header.appendChild(spacer);
      var close = document.createElement('button');
      close.textContent = '✕';
      close.title = t('closeAndCancel');
      close.addEventListener('click', cancelPendingQuestion);
      header.appendChild(close);
      questionPanelEl.appendChild(header);
      if (state.questionError) {
        var error = document.createElement('div');
        error.className = 'q-error';
        error.textContent = state.questionError;
        questionPanelEl.appendChild(error);
      }
      if (pending.questions.length > 1) {
        // **一页一题**（与 dsh Web UI 的多层提问一致）：只渲染当前这一题 + 翻页/跳过/下一题。
        var current = questionOnPage(pending);
        if (current) appendGenericQuestion(pending, current);
        appendQuestionNav(pending);
        return;
      }
      appendGenericQuestion(pending, pending.questions[0]);
      var actions = document.createElement('div');
      actions.className = 'q-actions';
      var submit = document.createElement('button');
      submit.className = 'primary';
      submit.textContent = t('submitAnswer');
      submit.addEventListener('click', submitQuestionAnswers);
      actions.appendChild(submit);
      questionPanelEl.appendChild(actions);
    }

    function updateQuestionUi() {
      var hasQuestion = !!(state.pendingQuestion && state.pendingQuestion.questions && state.pendingQuestion.questions.length);
      var hasApproval = !!state.pendingApproval;
      // 问题优先于审批展示；审批面板仅在无待处理问题时出现。
      questionPanelEl.style.display = hasQuestion ? 'block' : 'none';
      approvalPanelEl.style.display = (!hasQuestion && hasApproval) ? 'block' : 'none';
      composerRowEl.style.display = (hasQuestion || hasApproval) ? 'none' : 'flex';
      closePicker();
      closeModelPopover();
      if (hasQuestion || hasApproval) workIndicatorEl.style.display = 'none';
      else updateWorkingBar();
      // 待回答问题/审批时 composer 行整行隐藏，悬浮暂存层一并收起，避免遮挡面板。
      renderPromptStash();
    }

    function setRunning(running) {
      state.running = running;
      stopBtn.style.display = running ? 'inline-block' : 'none';
      updateWorkingBar();
      updatePermissionUi();
    }

    function currentModelSelection() {
      var models = state.models;
      if (!models || !models.current) return null;
      return models.current;
    }

    // 模型显示名：优先 group 里的展示名，回退到模型 id。
    function modelDisplayName(current, groups) {
      var provider = current.provider;
      var modelId = current.model;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].id !== provider) continue;
        var groupModels = groups[i].models || [];
        for (var j = 0; j < groupModels.length; j++) {
          if (groupModels[j].id === modelId) {
            return groupModels[j].name || groupModels[j].id;
          }
        }
        break;
      }
      return modelId;
    }

    // 推理强度显示名：effort 的展示名（如 Max），找不到时回退到 id。
    function effortDisplayName(current, groups) {
      var effortId = current.reasoningEffort;
      if (!effortId) return '';
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].id !== current.provider) continue;
        var groupModels = groups[i].models || [];
        for (var j = 0; j < groupModels.length; j++) {
          if (groupModels[j].id !== current.model) continue;
          var reasoning = groupModels[j].reasoning;
          if (!reasoning || !Array.isArray(reasoning.efforts)) return effortId;
          for (var ei = 0; ei < reasoning.efforts.length; ei++) {
            if (reasoning.efforts[ei].id === effortId) {
              return reasoning.efforts[ei].name || reasoning.efforts[ei].id;
            }
          }
          return effortId;
        }
        break;
      }
      return effortId;
    }

    // 统计行右下角：模型名 | 推理强度（无推理强度时只显示模型名）。
    function updateModelInfo() {
      var models = state.models;
      var parts = [];
      if (models && models.current) {
        var groups = models.groups || [];
        var name = modelDisplayName(models.current, groups);
        var effort = effortDisplayName(models.current, groups);
        parts.push(effort ? name + ' | ' + effort : name);
      }
      var perm = currentPermissionLabel();
      if (perm) parts.push(perm);
      modelInfoEl.textContent = parts.join(' | ');
      modelInfoEl.title = modelInfoEl.textContent;
    }

    function renderModelButton() {
      var models = state.models;
      var label = t('modelFallback');
      if (models && models.current) {
        var groups = models.groups || [];
        var name = modelDisplayName(models.current, groups);
        label = name || models.current.model || label;
        if (models.current.reasoningEffort) label += ' · ' + models.current.reasoningEffort;
      }
      modelBtn.title = t('modelTitle', { label: label });
      updateModelInfo();
    }

    function renderModels() {
      var models = state.models;
      renderModelButton();
      modelSelectEl.innerHTML = '';
      effortSelectEl.innerHTML = '';
      modelStatusEl.textContent = '';
      if (!models) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = models === null ? t('modelsLoading') : t('modelsEmpty');
        modelSelectEl.appendChild(empty);
        var emptyEffort = document.createElement('option');
        emptyEffort.value = '';
        emptyEffort.textContent = '—';
        effortSelectEl.appendChild(emptyEffort);
        return;
      }
      var groups = models.groups || [];
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        var optgroup = document.createElement('optgroup');
        optgroup.label = g.name || g.id;
        var groupModels = g.models || [];
        for (var j = 0; j < groupModels.length; j++) {
          var m = groupModels[j];
          var opt = document.createElement('option');
          opt.value = g.id + '::' + m.id;
          opt.textContent = m.name || m.id;
          if (models.current && models.current.provider === g.id && models.current.model === m.id) opt.selected = true;
          optgroup.appendChild(opt);
        }
        modelSelectEl.appendChild(optgroup);
      }
      if (!groups.length) {
        var empty2 = document.createElement('option');
        empty2.value = '';
        empty2.textContent = t('modelsEmpty');
        modelSelectEl.appendChild(empty2);
      }

      var reasoning = null;
      if (models.current) {
        for (var gi = 0; gi < groups.length; gi++) {
          if (groups[gi].id === models.current.provider) {
            var gms = groups[gi].models || [];
            for (var gj = 0; gj < gms.length; gj++) {
              if (gms[gj].id === models.current.model) reasoning = gms[gj].reasoning;
            }
          }
        }
      }
      if (reasoning) {
        var defEffort = reasoning.defaultEffort;
        var defOpt = document.createElement('option');
        defOpt.value = '__default__';
        defOpt.textContent = defEffort === undefined ? 'Default' : ('Default (' + defEffort + ')');
        defOpt.selected = models.current && !models.current.reasoningEffort;
        effortSelectEl.appendChild(defOpt);
        var efforts = reasoning.efforts || [];
        for (var ei = 0; ei < efforts.length; ei++) {
          var e = efforts[ei];
          var eopt = document.createElement('option');
          eopt.value = e.id;
          eopt.textContent = e.name || e.id;
          eopt.selected = models.current && models.current.reasoningEffort === e.id;
          effortSelectEl.appendChild(eopt);
        }
      } else {
        var noEffort = document.createElement('option');
        noEffort.value = '';
        noEffort.textContent = '—';
        effortSelectEl.appendChild(noEffort);
      }

      if (models.error) modelStatusEl.textContent = models.error;
      else if (models.routable === false) modelStatusEl.textContent = t('modelRouteUnavailable');
      else if (models.current) modelStatusEl.textContent = '';
      renderModelButton();
    }

    function formatTokens(n) {
      n = Number(n) || 0;
      if (n < 1000) return String(n);
      if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'K';
      return (n / 1000000).toFixed(n < 10000000 ? 1 : 0) + 'M';
    }

    function contextPressurePercent(stats) {
      var pressure = stats && stats.contextPressure;
      if (!pressure || !pressure.contextWindow) return null;
      var used = pressure.projectedTokens;
      if (used === undefined) used = pressure.pressureTokens;
      if (used === undefined && stats.contextBreakdown) {
        used = (Number(stats.contextBreakdown.systemTokens) || 0)
          + (Number(stats.contextBreakdown.toolsTokens) || 0)
          + (Number(stats.contextBreakdown.messageTokens) || 0);
      }
      if (used === undefined) return null;
      return Math.min(100, Math.round(Number(used) / Number(pressure.contextWindow) * 100));
    }

    function updateContextBar(stats) {
      if (!state.showContextUsage) {
        inputEl.style.backgroundImage = '';
        inputEl.title = '';
        return;
      }
      var pct = contextPressurePercent(stats);
      if (pct === null) {
        inputEl.style.backgroundImage = '';
        inputEl.title = t('stats.ctxNone');
        return;
      }
      // 输入框背景按占用比例填充，颜色与透明度均取设置值（默认 var(--accent)/30%）。
      var barColor = state.contextBarColor || 'var(--accent)';
      var opacity = Math.min(100, Math.max(0, Number(state.contextBarOpacity) || 30));
      inputEl.style.backgroundImage = 'linear-gradient(to right, color-mix(in srgb, ' + barColor + ' ' + opacity + '%, transparent) ' + pct + '%, transparent ' + pct + '%)';
      inputEl.title = t('stats.ctx', { pct: pct });
    }

    function renderStats(stats) {
      updateContextBar(stats);
      var usage = stats && stats.tokenUsage;
      var parts = [];
      if (usage) {
        var billedInput = (Number(usage.uncachedInputTokens) || 0)
          + (Number(usage.cacheReadTokens) || 0)
          + (Number(usage.cacheWriteTokens) || 0);
        var output = Number(usage.outputTokens) || 0;
        if (billedInput > 0) {
          var cacheHit = Math.round((Number(usage.cacheReadTokens) || 0) / billedInput * 100);
          parts.push(t('stats.cacheHit', { pct: cacheHit }));
          parts.push(t('stats.inputOutput', { input: formatTokens(billedInput), output: formatTokens(output) }));
        }
      }
      var jobs = (stats && stats.jobs) || [];
      var activeJobs = 0;
      for (var ji = 0; ji < jobs.length; ji++) {
        if (jobs[ji] && (jobs[ji].status === 'running' || jobs[ji].status === 'stopping')) activeJobs++;
      }
      if (activeJobs > 0) parts.push(t('stats.jobs', { count: activeJobs }));
      statsTextEl.textContent = parts.join(' | ');
      renderTodos();
      renderPermissions();
      renderSessionBanner(stats);
      renderJobs(stats);
    }

    /**
     * 计划模式横幅（0.1.5 的 plan 投影）。
     * 用户要求删除此前的"目标"横幅（goal 投影）：这里只保留计划模式提示，且不再有关闭按钮。
     */
    function renderSessionBanner(stats) {
      if (!sessionBannerEl) return;
      var plan = stats && stats.plan;
      var parts = [];
      if (plan && plan.active) parts.push(t('planTitle'));
      else if (plan && plan.pending) parts.push(t('planTitle') + '…');
      if (!parts.length) {
        sessionBannerEl.hidden = true;
        sessionBannerEl.innerHTML = '';
        return;
      }
      sessionBannerEl.hidden = false;
      sessionBannerEl.innerHTML = '';
      var text = document.createElement('span');
      text.className = 'session-banner-text';
      text.textContent = parts.join(' · ');
      sessionBannerEl.appendChild(text);
    }

    /** 后台任务面板：统计行里的任务数字可点开查看详情。 */
    function renderJobs(stats) {
      if (!jobsPanel) return;
      var jobs = (stats && stats.jobs) || [];
      state.jobs = jobs;
      jobsPanel.innerHTML = '';
      var title = document.createElement('div');
      title.className = 'cp-group-title';
      title.textContent = t('jobsTitle');
      jobsPanel.appendChild(title);
      if (!jobs.length) {
        var empty = document.createElement('div');
        empty.className = 'hint';
        empty.textContent = t('jobsEmpty');
        jobsPanel.appendChild(empty);
        return;
      }
      for (var i = 0; i < jobs.length; i++) {
        (function (job) {
          var row = document.createElement('div');
          row.className = 'jobs-row';
          var label = document.createElement('div');
          label.className = 'jobs-label';
          label.textContent = job.label || job.kind || job.id;
          var status = document.createElement('span');
          status.className = 'jobs-status jobs-status-' + String(job.status || '');
          status.textContent = String(job.status || '');
          row.appendChild(label);
          row.appendChild(status);
          if (job.detail) {
            var detail = document.createElement('div');
            detail.className = 'jobs-detail';
            detail.textContent = String(job.detail);
            row.appendChild(detail);
          }
          jobsPanel.appendChild(row);
        })(jobs[i]);
      }
    }

    function toggleJobsPanel() {
      if (!jobsPanel) return;
      jobsPanel.hidden = !jobsPanel.hidden;
    }

    /** 刷新按钮的进行中状态：禁用 + 旋转。 */
    function setRefreshing(active) {
      refreshBtn.disabled = !!active;
      refreshBtn.classList.toggle('spinning', !!active);
    }

    function openSettingsModal() {
      post({ type: 'settingsOpen' });
      settingsModal.classList.add('open');
    }

    function closeSettingsModal() {
      settingsModal.classList.remove('open');
    }

    function sessionTitle(sessionId) {
      var sessions = state.sessions || [];
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].sessionId === sessionId) return sessionDisplayTitle(sessions[i]);
      }
      if (!sessionId) return '';
      var short = String(sessionId).indexOf('session-') === 0 ? String(sessionId).slice('session-'.length).slice(0, 8) : String(sessionId).slice(0, 8);
      return short ? t('session') + ' ' + short : t('session');
    }

    function openArchiveModal(sessionId) {
      if (!sessionId) return;
      pendingArchiveSessionId = sessionId;
      archiveMessage.textContent = t('archiveMessage', { title: sessionTitle(sessionId) });
      archiveModal.classList.add('open');
    }

    function closeArchiveModal() {
      archiveModal.classList.remove('open');
      pendingArchiveSessionId = null;
    }
