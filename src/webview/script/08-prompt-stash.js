    // ===== 悬浮提示词暂存框（数量不设上限，支持图片）=====
    // 位置：composer 上方右侧的悬浮层（绝对定位，不占聊天区布局）。
    // 形态：竖直高度固定、不自动换行，只显示能显示出来的内容；行内可带图片缩略图。
    // 交互：composer 行里的 ＋ 增加暂存槽（输入框里的文字与待发送图片会一起存进新框并清空）；
    //       每槽右侧按钮把该槽内容（文字 + 图片）直接发进当前会话，发送后删除该框。
    // 持久化：文本防抖 300ms 上报（只带 {id,text}），新增/删除/图片变化时整份上报
    //        （images:true），宿主写 globalState；关掉开关只隐藏界面、不清空内容。

    /** 暂存框条目的稳定 id（宿主按 id 合并文本更新、保留自己那份图片）。 */
    function newStashId() {
      return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    /** 图片附件规整（与 composer 的 pendingImages 同形状）。 */
    function normalizeStashImages(images) {
      var out = [];
      if (!images) return out;
      for (var i = 0; i < images.length; i++) {
        var image = images[i];
        if (!image || typeof image !== 'object') continue;
        if (!image.data || !image.mediaType) continue;
        out.push({
          mediaType: String(image.mediaType),
          data: String(image.data),
          name: image.name ? String(image.name) : '',
        });
      }
      return out;
    }

    /** 宿主下发的条目 → `{id,text,images}`（兼容早期的纯字符串条目）。 */
    function normalizePromptStashItems(items) {
      var out = [];
      if (!items) return out;
      for (var i = 0; i < items.length; i++) {
        var value = items[i];
        var entry = (value && typeof value === 'object') ? value : { text: value };
        out.push({
          id: (typeof entry.id === 'string' && entry.id) ? entry.id : newStashId(),
          text: entry.text === null || entry.text === undefined ? '' : String(entry.text),
          images: normalizeStashImages(entry.images),
        });
      }
      return out;
    }

    function promptStashOn() { return state.promptStashEnabled !== false; }

    function stashBlocked() {
      return !!(state.pendingQuestion || state.pendingApproval);
    }

    function stashEntryAt(index) {
      return state.promptStashItems[index] || null;
    }

    function renderPromptStash(force) {
      var enabled = promptStashOn();
      updateStashAddButton();
      // 功能开关变化时输入框占位符也要跟着加/去掉 Ctrl+Shift+Enter 提示。
      updateComposerPlaceholder();
      if (!stashEl) return;
      var hide = !enabled || stashBlocked() || state.promptStashItems.length === 0;
      stashEl.hidden = hide;
      if (hide) {
        if (stashRows.length) { stashEl.innerHTML = ''; stashRows = []; }
        return;
      }
      if (force || stashRows.length !== state.promptStashItems.length) buildPromptStashRows();
      for (var i = 0; i < stashRows.length; i++) {
        var row = stashRows[i];
        var entry = stashEntryAt(i) || { text: '', images: [] };
        // 正在输入的框不回填：宿主 hydrate 里的值可能落后于本地防抖。
        if (document.activeElement !== row.input) row.input.value = entry.text || '';
        row.input.placeholder = t('promptStashPlaceholder', { index: i + 1 });
        row.input.title = t('promptStashInputTitle');
        row.send.textContent = t('send');
        row.send.title = t('promptStashSendTitle');
        row.remove.title = t('promptStashRemoveTitle');
        renderStashRowImages(row, entry, i);
      }
      updatePromptStashButtons();
    }

    /** 行内图片缩略图（最多 STASH_THUMB_LIMIT 张，多出的显示 +N；每张可单独移除）。 */
    function renderStashRowImages(row, entry, index) {
      var images = entry.images || [];
      row.images.innerHTML = '';
      if (images.length === 0) {
        row.images.hidden = true;
        return;
      }
      row.images.hidden = false;
      var shown = Math.min(images.length, STASH_THUMB_LIMIT);
      for (var i = 0; i < shown; i++) {
        (function (imageIndex) {
          var image = images[imageIndex];
          var box = document.createElement('span');
          box.className = 'stash-thumb';
          var im = document.createElement('img');
          im.src = 'data:' + image.mediaType + ';base64,' + image.data;
          im.alt = image.name || t('imageAttachment');
          box.appendChild(im);
          var rm = document.createElement('button');
          rm.textContent = '×';
          rm.title = t('imageRemove');
          rm.addEventListener('click', function () { removePromptStashImage(index, imageIndex); });
          box.appendChild(rm);
          row.images.appendChild(box);
        })(i);
      }
      if (images.length > shown) {
        var more = document.createElement('span');
        more.className = 'stash-thumb-more';
        more.textContent = '+' + (images.length - shown);
        more.title = t('promptStashImagesTitle', { count: images.length });
        row.images.appendChild(more);
      }
      row.images.title = t('promptStashImagesTitle', { count: images.length });
    }

    function buildPromptStashRows() {
      stashEl.innerHTML = '';
      stashRows = [];
      for (var i = 0; i < state.promptStashItems.length; i++) {
        (function (index) {
          var row = document.createElement('div');
          row.className = 'stash-row';
          var images = document.createElement('span');
          images.className = 'stash-thumbs';
          var input = document.createElement('input');
          input.type = 'text';
          input.className = 'stash-input';
          input.value = (stashEntryAt(index) || {}).text || '';
          input.addEventListener('input', function () {
            var entry = stashEntryAt(index);
            if (entry) entry.text = input.value;
            updatePromptStashButtons();
            schedulePromptStashPersist();
          });
          // 单行框里 Enter 没有换行语义：直接当作"发送这一条"。
          input.addEventListener('keydown', function (event) {
            // 中文/日文输入法组字中的 Enter 是"确认候选词"，不能当成发送。
            if (!event || event.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              sendPromptStashItem(index);
            }
          });
          var send = document.createElement('button');
          send.className = 'stash-send';
          send.textContent = t('send');
          send.addEventListener('click', function () { sendPromptStashItem(index); });
          var remove = document.createElement('button');
          remove.className = 'stash-remove';
          remove.textContent = '×';
          remove.addEventListener('click', function () { removePromptStashItem(index); });
          row.appendChild(images);
          row.appendChild(input);
          row.appendChild(send);
          row.appendChild(remove);
          stashEl.appendChild(row);
          stashRows.push({ input: input, send: send, remove: remove, images: images });
        })(i);
      }
    }

    function updatePromptStashButtons() {
      for (var i = 0; i < stashRows.length; i++) {
        var entry = stashEntryAt(i) || { text: '', images: [] };
        var hasContent = String(entry.text || '').trim() !== '' || (entry.images || []).length > 0;
        // 空槽 / dsh 未就绪时不可发送（与 composer 发送按钮同样的前置条件）。
        stashRows[i].send.disabled = state.status !== 'ready' || !hasContent;
      }
    }

    /** ＋ 按钮：文案随"输入框里有没有待发送的文字"变化（有文字＝把文字存进新暂存框）。 */
    function updateStashAddButton() {
      if (!stashAddBtn) return;
      stashAddBtn.hidden = !promptStashOn();
      // 暂存框数量不设上限：按钮始终可用（关闭功能时才隐藏）。
      stashAddBtn.disabled = false;
      stashAddBtn.title = (String(inputEl.value || '').trim() ? t('promptStashAddFromInput') : t('promptStashAdd'))
        + t('promptStashShortcutHint');
    }

    /**
     * ＋：新建一个暂存框。输入框里的文字与**待发送图片**会一起存进新框并清空两处
     * （多行文本原样保存，单行框只是显示不下换行；发送时发的是存下来的原文），
     * composer 里没有内容时就是新建一个空框。
     */
    function addPromptStashBox() {
      if (!promptStashOn()) return;
      var draft = String(inputEl.value || '');
      var images = pendingImages.slice();
      state.promptStashItems.push({ id: newStashId(), text: draft, images: images });
      if (draft.trim() !== '') {
        inputEl.value = '';
        inputEl.style.height = 'auto';
        closePicker();
      }
      if (images.length) {
        pendingImages = [];
        renderPendingImages();
      }
      renderPromptStash(true);
      persistPromptStash(true);
      var last = stashRows[stashRows.length - 1];
      if (last && last.input.focus) last.input.focus();
    }

    /**
     * Ctrl/Cmd+Shift+Enter：把输入框里正在写的内容（文字 + 待发送图片）暂存到一个新暂存框。
     * 输入框既没有文字也没有图片时返回 false（快捷键不凭空造空框，也不吞掉按键）。
     * @returns 是否真的暂存了（调用方据此决定 preventDefault）。
     */
    function stashComposerDraft() {
      if (!promptStashOn()) return false;
      if (String(inputEl.value || '').trim() === '' && pendingImages.length === 0) return false;
      addPromptStashBox();
      // 键盘流程是"存下当前这条、接着写吓一条"：焦点留在输入框（＋ 按钮则聚焦新框）。
      if (inputEl.focus) inputEl.focus();
      return true;
    }

    function removePromptStashItem(index) {
      if (index < 0 || index >= state.promptStashItems.length) return;
      state.promptStashItems.splice(index, 1);
      renderPromptStash(true);
      persistPromptStash(true);
    }

    /** 从某个暂存框里移除一张图片（图片没了但文字还在时保留该框）。 */
    function removePromptStashImage(index, imageIndex) {
      var entry = stashEntryAt(index);
      if (!entry || !entry.images || imageIndex < 0 || imageIndex >= entry.images.length) return;
      entry.images.splice(imageIndex, 1);
      renderPromptStash(true);
      persistPromptStash(true);
    }

    function sendPromptStashItem(index) {
      var entry = stashEntryAt(index);
      if (!entry) return;
      var text = String(entry.text || '').trim();
      var images = entry.images || [];
      if ((!text && images.length === 0) || state.status !== 'ready') return;
      // 直接走 composer 的发送通道：文字与图片一起提交（附时区，与手动发送完全一致）。
      var payload = { type: 'send', text: text, clientTimeZone: clientTimeZoneName() };
      if (images.length) payload.images = images.slice();
      post(payload);
      // 发送后删除该暂存框（用户要求）：剩下的框上移并重新编号。
      state.promptStashItems.splice(index, 1);
      renderPromptStash(true);
      persistPromptStash(true);
      // 框已消失，焦点会掉到 body：收回到输入框，避免"接着打字没有任何反应"。
      if (inputEl.focus) inputEl.focus();
    }

    /**
     * 上报暂存框内容。
     * @param includeImages - false（默认，打字防抖）：只发 `{id,text}`，宿主按 id 合并文本、
     *   保留图片，避免每次停顿都把 base64 图片搬一遍；
     *   true（新增/删除/图片增删、发送后删除）：整份条目，宿主整份替换。
     */
    function persistPromptStash(includeImages) {
      if (stashPersistTimer) { clearTimeout(stashPersistTimer); stashPersistTimer = 0; }
      var items = [];
      for (var i = 0; i < state.promptStashItems.length; i++) {
        var entry = state.promptStashItems[i];
        items.push(includeImages
          ? { id: entry.id, text: entry.text, images: entry.images }
          : { id: entry.id, text: entry.text });
      }
      post({ type: 'promptStashUpdate', items: items, images: includeImages === true });
    }

    function schedulePromptStashPersist() {
      if (stashPersistTimer) clearTimeout(stashPersistTimer);
      stashPersistTimer = setTimeout(function () {
        stashPersistTimer = 0;
        persistPromptStash(false);
      }, 300);
    }
