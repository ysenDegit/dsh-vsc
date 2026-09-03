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
    drawerSearch.addEventListener('input', function () { renderDrawerList(state.sessions || [], state.selectedSessionId); });
    ungroupedCheck.addEventListener('change', function () {
      state.ungroupedOpen = ungroupedCheck.checked;
      if (state.ungroupedOpen) {
        state.ungroupedItems = [];
        state.ungroupedError = null;
        post({ type: 'getUngroupedSessions' });
      }
      renderSessions();
    });
    moreBtn.addEventListener('click', function () {
      if (moreMenu.classList.contains('open')) closeMoreMenu();
      else openMoreMenu();
    });
    moreOpenWebBtn.addEventListener('click', function () {
      post({ type: 'openDshWeb' });
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
    $('refreshBtn').addEventListener('click', function () { post({ type: 'refreshSessions' }); });
    inputEl.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
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
    });
    filePicker.addEventListener('click', function (event) { if (event.target === filePicker) closePicker(); });
    commandPicker.addEventListener('click', function (event) { if (event.target === commandPicker) closePicker(); });
