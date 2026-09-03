    var vscode = acquireVsCodeApi();
    var state = {
      status: 'stopped',
      workspace: null,
      sessions: [],
      selectedSessionId: null,
      conversation: [],
      running: false,
      fileList: [],
      presets: [],
      models: null,
      modelLoading: false,
      commands: [],
      commandsAvailable: false,
      sessionDisplay: 'concise',
      fontSize: 13,
      maxWidth: 1000,
      language: 'zh',
      enterToSend: false,
      showContextUsage: true,
      contextBarColor: 'var(--accent)',
      contextBarOpacity: 30,
      autoStart: true,
      autoOpenChat: true,
      showArchivedSessions: false,
      queueItems: [],
      hasMoreEarlier: false,
      loadingEarlier: false,
      ungroupedOpen: false,
      ungroupedItems: [],
      ungroupedError: null,
      pendingQuestion: null,
      pendingApproval: null,
      todos: [],
      permissions: null,
      questionSelections: {},
      questionCustom: {}
    };

    // 增量渲染缓存：item id -> { node, signature }；流式更新只重绘变化的条目。
    var itemNodes = new Map();
    var earlierWrapEl = null;
    var renderedSessionId = null;
    var renderedMode = null;
    var renderedLang = null;
    var conversationTimer = 0;
    // 设置弹窗当前激活标签页（settingsData 重渲染后恢复，用于"管理工作区"刷新）。
    var settingsActiveTab = 'display';
    // 待发送图片（剪贴板粘贴，base64）与会话图片附件缓存。
    var pendingImages = [];
    var attachmentCache = {};      // attachmentId -> { mediaType, data }
    var attachmentRequested = {};  // attachmentId -> true（避免重复请求）

    var $ = function (id) { return document.getElementById(id); };
    var chatEl = $('chat');
    var inputEl = $('composerInput');
    var composerInput = inputEl;
    var refreshBtn = $('refreshBtn');
    var sendBtn = $('sendBtn');
    var stopBtn = $('stopBtn');
    var filePicker = $('filePicker');
    var sessionTitleBtn = $('sessionTitleBtn');
    var sessionTitleEl = $('sessionTitle');
    var sessionsDrawer = $('sessionsDrawer');
    var drawerTitleEl = $('drawerTitle');
    var drawerNewBtn = $('drawerNewBtn');
    var drawerCloseBtn = $('drawerCloseBtn');
    var drawerSearch = $('drawerSearch');
    var drawerList = $('drawerList');
    var ungroupedToggleEl = $('ungroupedToggle');
    var ungroupedCheck = $('ungroupedCheck');
    var ungroupedToggleLabelEl = $('ungroupedToggleLabel');
    var moreBtn = $('moreBtn');
    var moreMenu = $('moreMenu');
    var moreOpenWebBtn = $('moreOpenWebBtn');
    var toastEl = $('toast');
    var toastTimer = 0;
    var commandPicker = $('commandPicker');
    var modelSelectEl = $('modelSelect');
    var effortSelectEl = $('effortSelect');
    var modelStatusEl = $('modelStatus');
    var statsBarEl = $('statsBar');
    var statsTextEl = $('statsText');
    var workIndicatorEl = $('workIndicator');
    var modelInfoEl = $('modelInfo');
    var queueDockEl = $('queueDock');
    var todoDockEl = $('todoDock');
    var todosCollapsed = false;
    var questionPanelEl = $('questionPanel');
    var approvalPanelEl = $('approvalPanel');
    var composerRowEl = $('composerRow');
    var imageBtn = $('imageBtn');
    var imageFileInput = $('imageFileInput');
    var permissionPopover = $('permissionGroupList');
    var permissionGroupTitleEl = $('permissionGroupTitle');
    var modelBtn = $('actionsBtn');
    var modelPopover = $('modelPopover');
    var settingsBtn = $('settingsBtn');
    var settingsModal = $('settingsModal');
    var settingsNav = $('settingsNav');
    var settingsContent = $('settingsContent');
    var settingsCloseBtn = $('settingsClose');
    var settingsDoneBtn = $('settingsDoneBtn');
    var settingsOpenDocBtn = $('settingsOpenDocBtn');
    var archiveModal = $('archiveModal');
    var archiveMessage = $('archiveMessage');
    var archiveCloseBtn = $('archiveClose');
    var archiveCancelBtn = $('archiveCancelBtn');
    var archiveConfirmBtn = $('archiveConfirmBtn');
    var pendingArchiveSessionId = null;

    function post(msg) { vscode.postMessage(msg); }

    function applyFontSize() {
      var size = Number(state.fontSize) || 13;
      if (size < 10) size = 10;
      if (size > 24) size = 24;
      document.documentElement.style.setProperty('--vscode-font-size', size + 'px');
      document.body.style.fontSize = size + 'px';
    }

    function applyMaxWidth() {
      var width = Number(state.maxWidth) || 0;
      document.documentElement.style.setProperty('--chat-max-width', width > 0 ? width + 'px' : 'none');
    }

