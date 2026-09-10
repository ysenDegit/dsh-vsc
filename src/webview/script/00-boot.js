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
      modeSelectionEnabled: true,
      sessionSearch: null,
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
      showArchivedSessions: false,
      // 当前工作区里仍归档的会话数（宿主下发），用于按钮上的"显示已归档（N）"。
      archivedAvailable: 0,
      // 被"本地恢复显示"（仅插件内显示）的会话数：按钮无事可做时用来解释原因。
      restoredCount: 0,
      promptStashEnabled: true,
      promptStashItems: [],
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
    // 待发送文件（0.1.5 file 附件）：{ name, data(base64) } —— 发送时由宿主 upload 换 receiptId。
    var pendingFiles = [];
    // 会话图片附件缓存（LRU：最多 40 张，避免长会话浏览大量图片后内存无上限增长）。
    var attachmentCache = {};
    var attachmentCacheOrder = [];
    var ATTACHMENT_CACHE_LIMIT = 40;
    // 暂存框 DOM 行（{input,send,remove,images}）与内容持久化防抖定时器。
    var stashRows = [];
    // 每个暂存框最多直接显示几张图片缩略图（更多的显示 +N）。
    var STASH_THUMB_LIMIT = 3;
    // 上一次渲染时归档分区是否可见：用于"点显示已归档后自动滚到归档分区"。
    var lastArchivedShown = false;
    var stashPersistTimer = 0;
    function cacheAttachment(id, value) {
      if (!id) return;
      if (!Object.prototype.hasOwnProperty.call(attachmentCache, id)) attachmentCacheOrder.push(id);
      attachmentCache[id] = value;
      while (attachmentCacheOrder.length > ATTACHMENT_CACHE_LIMIT) {
        var evicted = attachmentCacheOrder.shift();
        delete attachmentCache[evicted];
      }
    }
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
    var moreRevealFolderBtn = $('moreRevealFolderBtn');
    var morePresetDirBtn = $('morePresetDirBtn');
    var drawerArchivedToggle = $('drawerArchivedToggle');
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
    var fileBtn = $('fileBtn');
    var attachFileInput = $('attachFileInput');
    var stashEl = $('promptStash');
    var stashAddBtn = $('stashAddBtn');
    var pendingFilesEl = $('pendingFiles');
    var jobsPanel = $('jobsPanel');
    var sessionBannerEl = $('sessionBanner');
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

