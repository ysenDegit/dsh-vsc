    // Events
    sendBtn.addEventListener('click', sendMessage);
    // 输入框粘贴图片 → 加入待发送列表（vision 支持）。
    inputEl.addEventListener('paste', onComposerPaste);
    // 📷 选择图片：本地文件对话框（本机/远程都可靠，不依赖剪贴板）。
    imageBtn.addEventListener('click', function () {
      imageBtn.title = t('imagePick');
      imageFileInput.value = '';
      imageFileInput.click();
    });
    imageFileInput.addEventListener('change', function () {
      if (imageFileInput.files && imageFileInput.files.length) {
        readImageFiles(imageFileInput.files);
        imageFileInput.value = '';
      }
    });
    // 📎 添加文件：本机/远程都走 webview 的 <input type=file>，内容以 base64 上传给 dsh。
    fileBtn.addEventListener('click', function () {
      attachFileInput.value = '';
      attachFileInput.click();
    });
    attachFileInput.addEventListener('change', function () {
      if (attachFileInput.files && attachFileInput.files.length) {
        readAttachFiles(attachFileInput.files);
        attachFileInput.value = '';
      }
    });
    // ＋ 增加一个悬浮提示词暂存框（无数量上限；输入框有文字时把文字存进新框）。
    stashAddBtn.addEventListener('click', function () { addPromptStashBox(); });
    // 统计行里的后台任务数：点开查看详情。
    statsTextEl.addEventListener('click', function () {
      if ((state.jobs || []).length) toggleJobsPanel();
    });
    stopBtn.addEventListener('click', function () { post({ type: 'cancel' }); });
    // 状态徽标（stopped/error 时）点击 → 重新探测 dsh web 实例。
    $('statusText').parentElement.addEventListener('click', function () {
      var s = state.status;
      if (s === 'stopped' || s === 'error') post({ type: 'retryConnect' });
    });
    settingsBtn.addEventListener('click', openSettingsModal);
    settingsCloseBtn.addEventListener('click', closeSettingsModal);
    settingsDoneBtn.addEventListener('click', closeSettingsModal);
    settingsOpenDocBtn.addEventListener('click', function () { post({ type: 'settingsOpenDocument' }); });
    sessionTitleBtn.addEventListener('click', toggleSessionDrawer);
    drawerCloseBtn.addEventListener('click', closeSessionDrawer);
    drawerNewBtn.addEventListener('click', function () {
      post({ type: 'newSession' });
      closeSessionDrawer();
    });
    var searchTimer = 0;
    drawerSearch.addEventListener('input', function () {
      renderDrawerList(state.sessions || [], state.selectedSessionId);
      // 内容搜索走 dsh session/search（标题过滤仍是本地即时结果）。
      if (searchTimer) clearTimeout(searchTimer);
      var query = (drawerSearch.value || '').trim();
      if (query.length < 2) {
        state.sessionSearch = null;
        renderDrawerList(state.sessions || [], state.selectedSessionId);
        return;
      }
      searchTimer = setTimeout(function () {
        searchTimer = 0;
        post({ type: 'sessionSearch', query: query });
      }, 300);
    });
    ungroupedCheck.addEventListener('change', function () {
      state.ungroupedOpen = ungroupedCheck.checked;
      if (state.ungroupedOpen) {
        state.ungroupedItems = [];
        state.ungroupedError = null;
        post({ type: 'getUngroupedSessions' });
      }
      renderSessions();
    });
    // 已归档视图：一律忽略宿主归档集合 / 恢复显示（dsh 无 unarchive API，仅插件视图）。
    // 已归档视图开关：显示中 → 隐藏；隐藏中 → 显示（反复点击都有效，状态与设置项共用）。
    drawerArchivedToggle.addEventListener('click', function () {
      post({ type: 'setShowArchivedSessions', value: state.showArchivedSessions !== true });
    });
    moreBtn.addEventListener('click', function () {
      if (moreMenu.classList.contains('open')) closeMoreMenu();
      else openMoreMenu();
    });
    moreOpenWebBtn.addEventListener('click', function () {
      post({ type: 'openDshWeb' });
      closeMoreMenu();
    });
    moreRevealFolderBtn.addEventListener('click', function () {
      post({ type: 'openWorkspaceFolder' });
      closeMoreMenu();
    });
    morePresetDirBtn.addEventListener('click', function () {
      post({ type: 'openPresetDirectory' });
      closeMoreMenu();
    });
    archiveCloseBtn.addEventListener('click', closeArchiveModal);
    archiveCancelBtn.addEventListener('click', closeArchiveModal);
    archiveConfirmBtn.addEventListener('click', function () {
      var sessionId = pendingArchiveSessionId;
      closeArchiveModal();
      if (!sessionId) return;
      post({ type: 'closeSession', sessionId: sessionId });
    });
    modelBtn.addEventListener('click', function () {
      toggleModelPopover();
    });
    document.addEventListener('click', function (event) {
      var t = event.target;
      if (jobsPanel && !jobsPanel.hidden && !jobsPanel.contains(t) && !statsTextEl.contains(t)) jobsPanel.hidden = true;
      if (!modelBtn.contains(t) && !modelPopover.contains(t)) closeModelPopover();
      if (!sessionsDrawer.contains(t) && !sessionTitleBtn.contains(t)) closeSessionDrawer();
      if (!moreMenu.contains(t) && !moreBtn.contains(t)) closeMoreMenu();
    });
    modelSelectEl.addEventListener('change', function () {
      var val = modelSelectEl.value;
      if (!val) return;
      var parts = val.split('::');
      if (parts.length !== 2) return;
      post({ type: 'modelSelect', provider: parts[0], model: parts[1] });
    });
    effortSelectEl.addEventListener('change', function () {
      var cur = currentModelSelection();
      if (!cur) return;
      var effort = effortSelectEl.value;
      if (effort === '') return;
      if (effort === '__default__') effort = undefined;
      post({ type: 'modelSelect', provider: cur.provider, model: cur.model, effort: effort });
    });
    // 顶部刷新按钮 = 轻量全量刷新（会话/模型/命令/工作模式/设置），不重载会话历史。
    $('refreshBtn').addEventListener('click', function () {
      if (refreshBtn.disabled) return;
      post({ type: 'refreshAll' });
    });
    inputEl.addEventListener('keydown', function (event) {
      // 输入法组字（isComposing）中的 Enter 是"确认候选词"，不是发送/暂存。
      if (event.isComposing) return;
      if (event.key !== 'Enter') return;
      // Ctrl+Shift+Enter（macOS 上 Cmd+Shift+Enter）：把输入框内容暂存到暂存框
      // （功能开启且输入框非空时）。必须在下面"Shift+Enter 发送"之前判定，否则默认发送方式下会被当成发送。
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && stashComposerDraft()) {
        event.preventDefault();
        return;
      }
      // enterToSend=true：Enter 发送、Shift+Enter 换行（默认行为，不拦截）。
      // enterToSend=false：Shift+Enter 发送、Enter 换行（默认行为，不拦截）。
      var sendOnEnter = state.enterToSend === true;
      if (sendOnEnter ? !event.shiftKey : event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    inputEl.addEventListener('input', function () {
      autoResize();
      detectPicker();
      // ＋ 的提示文案随"输入框有没有文字"变化。
      updateStashAddButton();
    });
    filePicker.addEventListener('click', function (event) { if (event.target === filePicker) closePicker(); });
    commandPicker.addEventListener('click', function (event) { if (event.target === commandPicker) closePicker(); });
