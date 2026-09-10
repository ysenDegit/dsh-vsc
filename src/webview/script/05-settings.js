    function renderSettingsData(data) {
      settingsContent.innerHTML = '';
      var versionSection = document.createElement('div');
      versionSection.className = 'settings-section';
      var versionTitle = document.createElement('h3');
      versionTitle.textContent = t('pluginVersion');
      versionSection.appendChild(versionTitle);
      var versionField = document.createElement('div');
      versionField.className = 'settings-field';
      var versionValue = document.createElement('span');
      versionValue.textContent = data.version ? ('v' + data.version) : '—';
      versionField.appendChild(versionValue);
      versionSection.appendChild(versionField);
      settingsContent.appendChild(versionSection);

      settingsNav.innerHTML = '';
      // 记住当前激活的设置标签页，刷新（settingsData 重渲染）后恢复，而不是重置回"显示"。
      function activateSettingsTab(key) {
        settingsActiveTab = key;
        for (var i = 0; i < settingsNav.children.length; i++) {
          settingsNav.children[i].classList.toggle('active', settingsNav.children[i].dataset.tab === key);
        }
        for (var j = 0; j < settingsContent.children.length; j++) {
          settingsContent.children[j].classList.toggle('active', settingsContent.children[j].dataset.tab === key);
        }
      }
      function makeSettingsPane(key, title) {
        var item = document.createElement('button');
        item.className = 'settings-nav-item';
        item.textContent = title;
        item.dataset.tab = key;
        var pane = document.createElement('div');
        pane.className = 'settings-pane';
        pane.dataset.tab = key;
        settingsNav.appendChild(item);
        settingsContent.appendChild(pane);
        item.addEventListener('click', function () { activateSettingsTab(key); });
        return pane;
      }

      var aboutPane = makeSettingsPane('about', t('tabAbout'));
      aboutPane.appendChild(versionSection);

      // dsh 服务地址：显示当前连接地址，点击在浏览器打开 dsh Web UI。
      var dshServiceSection = document.createElement('div');
      dshServiceSection.className = 'settings-section';
      var dshServiceTitle = document.createElement('h3');
      dshServiceTitle.textContent = t('dshServiceUrlSection');
      dshServiceSection.appendChild(dshServiceTitle);
      var dshServiceField = document.createElement('div');
      dshServiceField.className = 'settings-field';
      if (data.baseUrl) {
        var dshLink = document.createElement('a');
        // href 用带 token 的完整地址（背景色区别于纯文本）；点击仍走 openDshWeb 事件。
        dshLink.href = data.webUrl || data.baseUrl;
        dshLink.textContent = data.baseUrl;
        dshLink.id = 'dshWebLink';
        dshLink.title = t('dshWebOpenTitle');
        dshLink.addEventListener('click', function (event) {
          event.preventDefault();
          post({ type: 'openDshWeb' });
        });
        dshServiceField.appendChild(dshLink);
      } else {
        var dshNone = document.createElement('span');
        dshNone.className = 'field-status';
        dshNone.textContent = t('dshServiceUrlNone');
        dshServiceField.appendChild(dshNone);
      }
      dshServiceSection.appendChild(dshServiceField);
      aboutPane.appendChild(dshServiceSection);

      // dsh 未连接/设置提供者只读时仍展示本地显示设置（显示/常规），后端相关部分分别提示。
      if (data.connected === false) {
        var offlineHint = document.createElement('div');
        offlineHint.className = 'hint';
        offlineHint.textContent = t('settingsOffline');
        aboutPane.appendChild(offlineHint);
      } else if (!data.writable) {
        var hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = t('settingsReadonly');
        aboutPane.appendChild(hint);
      }
      var displayPane = makeSettingsPane('display', t('tabDisplay'));
      var generalPane = makeSettingsPane('general', t('tabGeneral'));
      var displaySection = document.createElement('div');
      displaySection.className = 'settings-section';
      var displayTitle = document.createElement('h3');
      displayTitle.textContent = t('sessionDisplaySection');
      displaySection.appendChild(displayTitle);
      var displayField = document.createElement('div');
      displayField.className = 'settings-field';
      var displayLabel = document.createElement('div');
      displayLabel.className = 'field-label';
      var displayName = document.createElement('span');
      displayName.textContent = t('sessionDisplayLabel');
      displayLabel.appendChild(displayName);
      displayField.appendChild(displayLabel);
      var displaySelect = document.createElement('select');
      displaySelect.id = 'sessionDisplaySelect';
      var conciseOpt = document.createElement('option');
      conciseOpt.value = 'concise';
      conciseOpt.textContent = t('concise');
      var detailedOpt = document.createElement('option');
      detailedOpt.value = 'detailed';
      detailedOpt.textContent = t('detailed');
      displaySelect.appendChild(conciseOpt);
      displaySelect.appendChild(detailedOpt);
      displaySelect.value = data.sessionDisplay || 'concise';
      displaySelect.addEventListener('change', function () {
        post({ type: 'setSessionDisplay', value: displaySelect.value });
      });
      displayField.appendChild(displaySelect);
      displaySection.appendChild(displayField);
      displayPane.appendChild(displaySection);

      var fontSizeSection = document.createElement('div');
      fontSizeSection.className = 'settings-section';
      var fontSizeTitle = document.createElement('h3');
      fontSizeTitle.textContent = t('fontSizeSection');
      fontSizeSection.appendChild(fontSizeTitle);
      var fontSizeField = document.createElement('div');
      fontSizeField.className = 'settings-field';
      var fontSizeLabel = document.createElement('div');
      fontSizeLabel.className = 'field-label';
      var fontSizeName = document.createElement('span');
      fontSizeName.textContent = t('fontSizeLabel');
      fontSizeLabel.appendChild(fontSizeName);
      fontSizeField.appendChild(fontSizeLabel);
      var fontSizeSelect = document.createElement('select');
      var fontSizes = [12, 13, 14, 15, 16, 18, 20];
      var currentFontSize = Number(data.fontSize) || 13;
      for (var fi = 0; fi < fontSizes.length; fi++) {
        (function (size) {
          var opt = document.createElement('option');
          opt.value = String(size);
          opt.textContent = size + ' px';
          if (size === currentFontSize) opt.selected = true;
          fontSizeSelect.appendChild(opt);
        })(fontSizes[fi]);
      }
      fontSizeSelect.addEventListener('change', function () {
        state.fontSize = Number(fontSizeSelect.value) || 13;
        applyFontSize();
        post({ type: 'setFontSize', value: state.fontSize });
      });
      fontSizeField.appendChild(fontSizeSelect);
      fontSizeSection.appendChild(fontSizeField);
      displayPane.appendChild(fontSizeSection);

      var maxWidthSection = document.createElement('div');
      maxWidthSection.className = 'settings-section';
      var maxWidthTitle = document.createElement('h3');
      maxWidthTitle.textContent = t('maxWidthSection');
      maxWidthSection.appendChild(maxWidthTitle);
      var maxWidthField = document.createElement('div');
      maxWidthField.className = 'settings-field';
      var maxWidthLabel = document.createElement('div');
      maxWidthLabel.className = 'field-label';
      var maxWidthName = document.createElement('span');
      maxWidthName.textContent = t('maxWidthLabel');
      maxWidthLabel.appendChild(maxWidthName);
      maxWidthField.appendChild(maxWidthLabel);
      var maxWidthSelect = document.createElement('select');
      var widths = [0, 800, 1000, 1200, 1600];
      var currentMaxWidth = Number(data.maxWidth) || 0;
      for (var wi = 0; wi < widths.length; wi++) {
        (function (width) {
          var opt = document.createElement('option');
          opt.value = String(width);
          opt.textContent = width === 0 ? t('unlimited') : width + ' px';
          if (width === currentMaxWidth) opt.selected = true;
          maxWidthSelect.appendChild(opt);
        })(widths[wi]);
      }
      maxWidthSelect.addEventListener('change', function () {
        post({ type: 'setMaxWidth', value: Number(maxWidthSelect.value) || 0 });
      });
      maxWidthField.appendChild(maxWidthSelect);
      maxWidthSection.appendChild(maxWidthField);
      displayPane.appendChild(maxWidthSection);

      var contextSection = document.createElement('div');
      contextSection.className = 'settings-section';
      var contextTitle = document.createElement('h3');
      contextTitle.textContent = t('contextUsageSection');
      contextSection.appendChild(contextTitle);
      var contextField = document.createElement('div');
      contextField.className = 'settings-field';
      var contextLabel = document.createElement('label');
      contextLabel.className = 'field-label';
      var contextCheck = document.createElement('input');
      contextCheck.type = 'checkbox';
      contextCheck.checked = data.showContextUsage !== false;
      var contextName = document.createElement('span');
      contextName.textContent = t('contextUsageLabel');
      contextLabel.appendChild(contextCheck);
      contextLabel.appendChild(contextName);
      contextField.appendChild(contextLabel);
      contextSection.appendChild(contextField);
      contextCheck.addEventListener('change', function () {
        post({ type: 'setShowContextUsage', value: contextCheck.checked });
      });

      var colorSection = document.createElement('div');
      colorSection.className = 'settings-subsection';
      var colorTitle = document.createElement('div');
      colorTitle.className = 'settings-subsection-title';
      colorTitle.textContent = t('contextColorSection');
      colorSection.appendChild(colorTitle);
      var colorField = document.createElement('div');
      colorField.className = 'settings-field';
      var colorLabel = document.createElement('label');
      colorLabel.className = 'field-label';
      var colorDefaultCheck = document.createElement('input');
      colorDefaultCheck.type = 'checkbox';
      var colorName = document.createElement('span');
      colorName.textContent = t('contextColorDefault');
      colorLabel.appendChild(colorDefaultCheck);
      colorLabel.appendChild(colorName);
      colorField.appendChild(colorLabel);
      var colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = '#89b4fa';
      colorField.appendChild(colorInput);
      colorSection.appendChild(colorField);
      var currentColor = data.contextBarColor || 'var(--accent)';
      var isDefaultColor = currentColor === 'var(--accent)' || currentColor === '';
      colorDefaultCheck.checked = isDefaultColor;
      colorInput.disabled = isDefaultColor;
      var hexMatch = /^#([0-9a-fA-F]{6})$/.exec(currentColor);
      if (hexMatch) colorInput.value = currentColor;
      colorDefaultCheck.addEventListener('change', function () {
        if (colorDefaultCheck.checked) {
          colorInput.disabled = true;
          post({ type: 'setContextBarColor', value: 'var(--accent)' });
        } else {
          colorInput.disabled = false;
          post({ type: 'setContextBarColor', value: colorInput.value });
        }
      });
      colorInput.addEventListener('input', function () {
        if (!colorDefaultCheck.checked) post({ type: 'setContextBarColor', value: colorInput.value });
      });
      contextSection.appendChild(colorSection);

      var opacitySection = document.createElement('div');
      opacitySection.className = 'settings-subsection';
      var opacityTitle = document.createElement('div');
      opacityTitle.className = 'settings-subsection-title';
      opacityTitle.textContent = t('contextOpacitySection');
      opacitySection.appendChild(opacityTitle);
      var opacityField = document.createElement('div');
      opacityField.className = 'settings-field';
      var opacityLabel = document.createElement('div');
      opacityLabel.className = 'field-label';
      var opacityName = document.createElement('span');
      opacityName.textContent = t('contextOpacityLabel');
      opacityLabel.appendChild(opacityName);
      var opacityValue = document.createElement('span');
      opacityValue.className = 'field-status';
      var currentOpacity = Number(data.contextBarOpacity) || 30;
      opacityValue.textContent = currentOpacity + '%';
      opacityLabel.appendChild(opacityValue);
      opacityField.appendChild(opacityLabel);
      var opacityInput = document.createElement('input');
      opacityInput.type = 'range';
      opacityInput.min = '0';
      opacityInput.max = '100';
      opacityInput.step = '5';
      opacityInput.value = String(currentOpacity);
      opacityField.appendChild(opacityInput);
      opacitySection.appendChild(opacityField);
      opacityInput.addEventListener('input', function () {
        var value = Number(opacityInput.value) || 0;
        opacityValue.textContent = value + '%';
        post({ type: 'setContextBarOpacity', value: value });
      });
      contextSection.appendChild(opacitySection);
      displayPane.appendChild(contextSection);

      var languageSection = document.createElement('div');
      languageSection.className = 'settings-section';
      var languageTitle = document.createElement('h3');
      languageTitle.textContent = t('languageSection');
      languageSection.appendChild(languageTitle);
      var languageField = document.createElement('div');
      languageField.className = 'settings-field';
      var languageLabel = document.createElement('div');
      languageLabel.className = 'field-label';
      var languageName = document.createElement('span');
      languageName.textContent = t('languageLabel');
      languageLabel.appendChild(languageName);
      languageField.appendChild(languageLabel);
      // 显示为可切换目标语言：中文界面显示 English，英文界面显示中文。
      var languageButton = document.createElement('button');
      languageButton.className = 'primary';
      languageButton.style.width = '100%';
      languageButton.textContent = state.language === 'en' ? t('languageZh') : t('languageEn');
      languageButton.title = t('languageSwitchTitle', {
        current: state.language === 'en' ? t('languageEn') : t('languageZh'),
        target: state.language === 'en' ? t('languageZh') : t('languageEn')
      });
      languageButton.addEventListener('click', function () {
        var next = state.language === 'en' ? 'zh' : 'en';
        state.language = next;
        applyLanguage();
        renderSettingsData(data);
        post({ type: 'setLanguage', value: next });
      });
      languageField.appendChild(languageButton);
      languageSection.appendChild(languageField);
      generalPane.appendChild(languageSection);

      var sendModeSection = document.createElement('div');
      sendModeSection.className = 'settings-section';
      var sendModeTitle = document.createElement('h3');
      sendModeTitle.textContent = t('sendModeSection');
      sendModeSection.appendChild(sendModeTitle);
      var sendModeField = document.createElement('div');
      sendModeField.className = 'settings-field';
      var sendModeLabel = document.createElement('div');
      sendModeLabel.className = 'field-label';
      var sendModeName = document.createElement('span');
      sendModeName.textContent = t('sendModeLabel');
      sendModeLabel.appendChild(sendModeName);
      sendModeField.appendChild(sendModeLabel);
      var sendModeSelect = document.createElement('select');
      var enterOpt = document.createElement('option');
      enterOpt.value = 'true';
      enterOpt.textContent = t('sendModeEnter');
      var shiftEnterOpt = document.createElement('option');
      shiftEnterOpt.value = 'false';
      shiftEnterOpt.textContent = t('sendModeShiftEnter');
      sendModeSelect.appendChild(enterOpt);
      sendModeSelect.appendChild(shiftEnterOpt);
      sendModeSelect.value = state.enterToSend ? 'true' : 'false';
      sendModeSelect.addEventListener('change', function () {
        var next = sendModeSelect.value === 'true';
        state.enterToSend = next;
        updateComposerPlaceholder();
        post({ type: 'setEnterToSend', value: next });
      });
      sendModeField.appendChild(sendModeSelect);
      sendModeSection.appendChild(sendModeField);
      generalPane.appendChild(sendModeSection);

      // 悬浮提示词暂存框（dsh-vsc.promptStash）：关闭只隐藏界面，已写内容保留。
      var stashSection = document.createElement('div');
      stashSection.className = 'settings-section';
      var stashTitle = document.createElement('h3');
      stashTitle.textContent = t('promptStashSection');
      stashSection.appendChild(stashTitle);
      var stashField = document.createElement('div');
      stashField.className = 'settings-field';
      var stashLabel = document.createElement('label');
      stashLabel.className = 'field-label';
      var stashCheck = document.createElement('input');
      stashCheck.type = 'checkbox';
      stashCheck.checked = data.promptStashEnabled !== false;
      var stashName = document.createElement('span');
      stashName.textContent = t('promptStashLabel');
      stashLabel.appendChild(stashCheck);
      stashLabel.appendChild(stashName);
      stashField.appendChild(stashLabel);
      stashSection.appendChild(stashField);
      var stashHint = document.createElement('div');
      stashHint.className = 'hint';
      stashHint.textContent = t('promptStashHint');
      stashSection.appendChild(stashHint);
      stashCheck.addEventListener('change', function () {
        state.promptStashEnabled = stashCheck.checked;
        renderPromptStash();
        post({ type: 'setPromptStash', value: stashCheck.checked });
      });
      generalPane.appendChild(stashSection);

      var startupSection = document.createElement('div');
      startupSection.className = 'settings-section';
      var startupTitle = document.createElement('h3');
      startupTitle.textContent = t('startupSection');
      startupSection.appendChild(startupTitle);

      var autoStartField = document.createElement('div');
      autoStartField.className = 'settings-field';
      var autoStartLabel = document.createElement('label');
      autoStartLabel.className = 'field-label';
      var autoStartCheck = document.createElement('input');
      autoStartCheck.type = 'checkbox';
      autoStartCheck.checked = data.autoStart !== false;
      var autoStartName = document.createElement('span');
      autoStartName.textContent = t('autoStartLabel');
      autoStartLabel.appendChild(autoStartCheck);
      autoStartLabel.appendChild(autoStartName);
      autoStartField.appendChild(autoStartLabel);
      // 勾选自动启动时提示 session 冲突风险；未勾选时给出推荐做法。
      var autoStartWarning = document.createElement('div');
      autoStartWarning.className = 'warn';
      autoStartWarning.textContent = t('autoStartWarning');
      autoStartWarning.hidden = data.autoStart === false;
      autoStartField.appendChild(autoStartWarning);
      startupSection.appendChild(autoStartField);
      var autoStartRecommended = document.createElement('div');
      autoStartRecommended.className = 'hint';
      autoStartRecommended.textContent = t('autoStartRecommended');
      startupSection.appendChild(autoStartRecommended);
      autoStartCheck.addEventListener('change', function () {
        autoStartWarning.hidden = !autoStartCheck.checked;
        post({ type: 'setAutoStart', value: autoStartCheck.checked });
      });

      generalPane.appendChild(startupSection);

      // 管理工作区：当前工作区信息 + 全部 dsh 工作区（重命名/删除/刷新/重新映射）。
      // 会话数显示为 "工作中+已归档"，例如 3（工作中）+4（已归档），工作中数字加粗。
      // 数量由宿主按可见会话口径计算（排除空白占位/子代理/已归档）后随 settingsData 下发。
      function sessionCountFragment(activeCount, archivedCount) {
        var frag = document.createDocumentFragment();
        frag.appendChild(document.createTextNode(t('workspaceSessionsLabel')));
        var activeB = document.createElement('b');
        activeB.textContent = String(activeCount);
        frag.appendChild(activeB);
        frag.appendChild(document.createTextNode(t('workspaceActiveSuffix')));
        frag.appendChild(document.createTextNode(t('workspaceCountSeparator')));
        frag.appendChild(document.createTextNode(String(archivedCount)));
        frag.appendChild(document.createTextNode(t('workspaceArchivedSuffix')));
        return frag;
      }
      // 管理工作区：仅在 dsh 已连接时展示（工作区数据由宿主下发）。
      if (data.connected !== false) {
        var workspacePane = makeSettingsPane('workspace', t('tabWorkspace'));
        var wsCurrentSection = document.createElement('div');
      wsCurrentSection.className = 'settings-section';
      var wsCurrentTitle = document.createElement('h3');
      wsCurrentTitle.textContent = t('workspaceCurrentSection');
      wsCurrentSection.appendChild(wsCurrentTitle);
      if (data.currentWorkspaceId) {
        var currentWs = null;
        var wsList = data.workspaces || [];
        for (var wi2 = 0; wi2 < wsList.length; wi2++) {
          if (wsList[wi2].workspaceId === data.currentWorkspaceId) { currentWs = wsList[wi2]; break; }
        }
        var curPathField = document.createElement('div');
        curPathField.className = 'settings-field';
        var curPathLabel = document.createElement('div');
        curPathLabel.className = 'field-label';
        var curPathName = document.createElement('span');
        curPathName.textContent = t('workspacePathLabel');
        curPathLabel.appendChild(curPathName);
        var curPathValue = document.createElement('span');
        curPathValue.className = 'field-status';
        curPathValue.textContent = data.currentFolderPath || (currentWs ? currentWs.path : '—');
        curPathLabel.appendChild(curPathValue);
        curPathField.appendChild(curPathLabel);
        wsCurrentSection.appendChild(curPathField);
        var curIdField = document.createElement('div');
        curIdField.className = 'settings-field';
        var curIdLabel = document.createElement('div');
        curIdLabel.className = 'field-label';
        var curIdName = document.createElement('span');
        curIdName.textContent = t('workspaceIdLabel');
        curIdLabel.appendChild(curIdName);
        var curIdValue = document.createElement('span');
        curIdValue.className = 'field-status';
        curIdValue.textContent = data.currentWorkspaceId;
        curIdLabel.appendChild(curIdValue);
        curIdField.appendChild(curIdLabel);
        wsCurrentSection.appendChild(curIdField);
        if (currentWs) {
          var curCountField = document.createElement('div');
          curCountField.className = 'settings-field';
          var curCountLabel = document.createElement('div');
          curCountLabel.className = 'field-label';
          var curCountName = document.createElement('span');
          curCountName.appendChild(sessionCountFragment(currentWs.activeCount || 0, currentWs.archivedCount || 0));
          curCountLabel.appendChild(curCountName);
          curCountField.appendChild(curCountLabel);
          wsCurrentSection.appendChild(curCountField);
        }
      } else {
        var wsNoneField = document.createElement('div');
        wsNoneField.className = 'settings-field';
        var wsNoneSpan = document.createElement('span');
        wsNoneSpan.className = 'field-status';
        wsNoneSpan.textContent = t('workspaceNone');
        wsNoneField.appendChild(wsNoneSpan);
        wsCurrentSection.appendChild(wsNoneField);
      }
      workspacePane.appendChild(wsCurrentSection);

      var wsAllSection = document.createElement('div');
      wsAllSection.className = 'settings-section';
      var wsAllTitleRow = document.createElement('div');
      wsAllTitleRow.className = 'settings-title-row';
      var wsAllTitle = document.createElement('h3');
      wsAllTitle.textContent = t('workspaceAllSection');
      wsAllTitleRow.appendChild(wsAllTitle);
      // "显示已归档会话"开关：与会话列表过滤联动（dsh-vsc.showArchivedSessions）。
      var wsArchLabel = document.createElement('label');
      wsArchLabel.className = 'ws-arch-label';
      var wsArchCheck = document.createElement('input');
      wsArchCheck.type = 'checkbox';
      wsArchCheck.checked = data.showArchivedSessions === true;
      var wsArchName = document.createElement('span');
      wsArchName.textContent = t('showArchivedSessionsLabel');
      wsArchLabel.appendChild(wsArchCheck);
      wsArchLabel.appendChild(wsArchName);
      wsAllTitleRow.appendChild(wsArchLabel);
      wsArchCheck.addEventListener('change', function () {
        post({ type: 'setShowArchivedSessions', value: wsArchCheck.checked });
      });
      // 批量清除"仅插件内显示"（本地取消归档）：旧版"隐藏已归档"按钮曾把全部归档会话写进本地集合，
      // 这里给一个一键恢复入口（只改插件视图）。
      var restoredCount = Number(data.restoredCount) || 0;
      if (restoredCount > 0) {
        var clearRestoredBtn = document.createElement('button');
        clearRestoredBtn.textContent = t('clearRestoredBtn', { count: restoredCount });
        clearRestoredBtn.title = t('clearRestoredHint');
        clearRestoredBtn.addEventListener('click', function () {
          post({ type: 'clearRestoredSessions' });
          clearRestoredBtn.disabled = true;
        });
        wsAllTitleRow.appendChild(clearRestoredBtn);
      }
      var wsRefreshBtn = document.createElement('button');
      wsRefreshBtn.textContent = t('workspaceRefreshBtn');
      wsRefreshBtn.addEventListener('click', function () { post({ type: 'workspaceRefresh' }); });
      wsAllTitleRow.appendChild(wsRefreshBtn);
      wsAllSection.appendChild(wsAllTitleRow);
      var wsList2 = data.workspaces || [];
      if (wsList2.length === 0) {
        var wsEmptyField = document.createElement('div');
        wsEmptyField.className = 'settings-field';
        var wsEmptySpan = document.createElement('span');
        wsEmptySpan.className = 'field-status';
        wsEmptySpan.textContent = t('workspaceNone');
        wsEmptyField.appendChild(wsEmptySpan);
        wsAllSection.appendChild(wsEmptyField);
      }
      for (var wsi = 0; wsi < wsList2.length; wsi++) {
        (function (ws) {
          var row = document.createElement('div');
          row.className = 'ws-row';
          var info = document.createElement('div');
          info.className = 'ws-info';
          var pathDiv = document.createElement('div');
          pathDiv.className = 'ws-path';
          pathDiv.textContent = ws.path;
          var metaDiv = document.createElement('div');
          metaDiv.className = 'ws-meta';
          metaDiv.appendChild(sessionCountFragment(ws.activeCount || 0, ws.archivedCount || 0));
          metaDiv.appendChild(document.createTextNode(' · ' + (ws.workspaceId === data.currentWorkspaceId ? '← ' + t('tabWorkspace') : ws.workspaceId)));
          info.appendChild(pathDiv);
          info.appendChild(metaDiv);
          row.appendChild(info);
          var renameInput = document.createElement('input');
          renameInput.className = 'ws-rename-input';
          renameInput.value = ws.title || '';
          renameInput.placeholder = ws.title || '';
          row.appendChild(renameInput);
          var renameBtn = document.createElement('button');
          renameBtn.textContent = t('workspaceRenameBtn');
          renameBtn.addEventListener('click', function () {
            post({ type: 'workspaceRename', workspaceId: ws.workspaceId, title: renameInput.value });
          });
          row.appendChild(renameBtn);
          var delBtn = document.createElement('button');
          delBtn.className = 'ws-del-btn';
          delBtn.textContent = t('workspaceDeleteBtn');
          delBtn.addEventListener('click', function () {
            post({ type: 'workspaceDelete', workspaceId: ws.workspaceId });
          });
          row.appendChild(delBtn);
          wsAllSection.appendChild(row);
        })(wsList2[wsi]);
      }
      workspacePane.appendChild(wsAllSection);
      }

      // 赞助页：微信/支付宝收款码（图片以 data URI 内嵌，见 src/webview.js）。
      var sponsorPane = makeSettingsPane('sponsor', t('tabSponsor'));
      var sponsorSection = document.createElement('div');
      sponsorSection.className = 'settings-section';
      var sponsorTitle = document.createElement('h3');
      sponsorTitle.textContent = t('sponsorSection');
      sponsorSection.appendChild(sponsorTitle);
      var sponsorSlogan = document.createElement('div');
      sponsorSlogan.className = 'sponsor-slogan';
      sponsorSlogan.textContent = t('sponsorSlogan');
      sponsorSection.appendChild(sponsorSlogan);
      var sponsorHint = document.createElement('div');
      sponsorHint.className = 'hint';
      sponsorHint.textContent = t('sponsorHint');
      sponsorSection.appendChild(sponsorHint);
      var sponsorRow = document.createElement('div');
      sponsorRow.className = 'sponsor-row';
      var sponsorCodes = [
        { key: 'wechat', label: t('sponsorWechat') },
        { key: 'alipay', label: t('sponsorAlipay') },
      ];
      var sponsorData = (typeof DSH_SPONSOR === 'object' && DSH_SPONSOR) ? DSH_SPONSOR : {};
      for (var sci = 0; sci < sponsorCodes.length; sci++) {
        (function (code) {
          var box = document.createElement('div');
          box.className = 'sponsor-code';
          box.title = t('sponsorZoomHint');
          var src = sponsorData[code.key] || '';
          if (src) {
            var img = document.createElement('img');
            img.src = src;
            img.alt = code.label;
            box.appendChild(img);
            // 点一下放大到 2 倍，方便手机扫码（再点恢复）。
            box.addEventListener('click', function () { box.classList.toggle('zoomed'); });
          } else {
            var missing = document.createElement('div');
            missing.className = 'field-status';
            missing.textContent = t('sponsorMissing');
            box.appendChild(missing);
          }
          var caption = document.createElement('div');
          caption.className = 'sponsor-label';
          caption.textContent = code.label;
          box.appendChild(caption);
          sponsorRow.appendChild(box);
        })(sponsorCodes[sci]);
      }
      sponsorSection.appendChild(sponsorRow);
      sponsorPane.appendChild(sponsorSection);

      var webNoticeSection = document.createElement('div');
      webNoticeSection.className = 'settings-section';
      var webNotice = document.createElement('div');
      webNotice.className = 'hint';
      webNotice.textContent = t('settingsWebNotice');
      webNoticeSection.appendChild(webNotice);
      aboutPane.appendChild(webNoticeSection);
      // 离线时没有“管理工作区”页签，避免残留的选中级指向不存在的面板。
      if (data.connected === false && settingsActiveTab === 'workspace') settingsActiveTab = 'about';
      activateSettingsTab(settingsActiveTab);
    }
