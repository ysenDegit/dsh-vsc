'use strict'

function getWebviewHtml(nonce) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; script-src 'nonce-${nonce}';">
  <title>DeepSeek Harness Chat</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, #1e1e2e);
      --fg: var(--vscode-foreground, #cdd6f4);
      --muted: var(--vscode-descriptionForeground, #6c7086);
      --border: var(--vscode-panel-border, #313244);
      --input-bg: var(--vscode-input-background, #181825);
      --input-fg: var(--vscode-input-foreground, #cdd6f4);
      --accent: var(--vscode-focusBorder, #89b4fa);
      --button-bg: var(--vscode-button-background, #89b4fa);
      --button-fg: var(--vscode-button-foreground, #11111b);
      --error: var(--vscode-errorForeground, #f38ba8);
      --hover: var(--vscode-list-hoverBackground, #313244);
      --code-bg: var(--vscode-textCodeBlock-background, #11111b);
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #app { display: flex; flex-direction: column; height: 100%; }

    /* Status badge (top integrated bar) */
    .status-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); flex: 0 0 auto; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #6c7086; }
    .status-dot.ready { background: #a6e3a1; }
    .status-dot.starting, .status-dot.discovering { background: #f9e2af; }
    .status-dot.error { background: #f38ba8; }
    .status-dot.stopped { background: #6c7086; }
    .status-dot.reconnecting { background: #f9e2af; }

    button {
      background: transparent; color: var(--fg); border: 1px solid var(--border);
      border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px;
      font-family: inherit;
    }
    button:hover { background: var(--hover); }
    button.primary { background: var(--button-bg); color: var(--button-fg); border-color: transparent; }
    button.primary:hover { filter: brightness(0.9); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }

    /* Session strip */
    .sessions-wrap {
      display: flex; align-items: center; gap: 6px; padding: 6px 10px;
      border-bottom: 1px solid var(--border); flex: 0 0 auto; min-width: 0;
    }
    .sessions-wrap button { flex: 0 0 auto; height: 26px; padding: 0 8px; }
    #sessionSelect {
      flex: 1; min-width: 0; background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px;
      font: inherit; font-size: 12px;
    }
    .mode-row {
      display: flex; align-items: center; gap: 6px; padding: 6px 10px;
      border-bottom: 1px solid var(--border); flex: 0 0 auto;
      font-size: 12px; color: var(--muted);
    }
    .mode-row .mode-button {
      flex: 1; min-width: 0; background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px;
      font: inherit; font-size: 12px; cursor: pointer; height: auto;
    }
    .mode-welcome { max-width: 420px; margin: 0 auto; text-align: left; }
    .mode-welcome-title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
    .mode-welcome-desc { color: var(--muted); font-size: 12px; margin-bottom: 10px; }
    .mode-welcome .preset-list { max-height: none; }

    /* Chat area */
    .chat { flex: 1 1 auto; overflow-y: auto; padding: 12px 10px; }
    .empty { color: var(--muted); text-align: center; margin-top: 40px; line-height: 1.8; }
    .load-earlier-wrap { text-align: center; margin: 4px 0 8px; }
    .load-earlier-btn { font-size: 12px; padding: 4px 10px; }
    .msg { margin-bottom: 14px; max-width: 100%; }
    .msg .meta { font-size: 11px; color: var(--muted); margin-bottom: 3px; display: flex; gap: 6px; align-items: center; }
    .msg.user .meta { justify-content: flex-end; }
    .msg-delete {
      flex: 0 0 auto; height: 18px; min-width: 22px; padding: 0 4px;
      font-size: 10px; line-height: 1; opacity: 0.55;
    }
    .msg-delete:hover { opacity: 1; }
    .bubble {
      border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px;
      white-space: normal; overflow-wrap: anywhere; line-height: 1.55;
    }
    .msg.user .bubble {
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      border-color: color-mix(in srgb, var(--accent) 38%, transparent);
      max-width: 100%;
    }
    .msg.assistant .bubble { background: transparent; }
    .msg.context .bubble { border-style: dashed; color: var(--muted); font-size: 12px; }
    .msg.note .bubble { border-color: var(--error); color: var(--error); font-size: 12px; }
    .msg.tool .bubble { border-left: 3px solid var(--accent); font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
    .msg.tool .tool-name { font-weight: 600; color: var(--accent); }
    .reasoning { color: var(--muted); font-size: 12px; margin-bottom: 6px; white-space: pre-wrap; }
    .cursor::after { content: '▍'; color: var(--accent); animation: blink 1s step-end infinite; }
    @keyframes blink { 50% { opacity: 0; } }

    /* Markdown */
    .bubble pre {
      background: var(--code-bg); border: 1px solid var(--border); border-radius: 4px;
      padding: 8px; overflow-x: auto; margin: 6px 0;
    }
    .bubble code { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; background: var(--code-bg); padding: 1px 3px; border-radius: 3px; }
    .bubble pre code { background: transparent; padding: 0; }
    .tok-keyword { color: #c792ea; }
    .tok-string { color: #c3e88d; }
    .tok-comment { color: #6c7086; font-style: italic; }
    .tok-number { color: #f78c6c; }
    .math-inline { padding: 0 2px; font-family: var(--vscode-editor-font-family, monospace); }
    .math-block { display: block; text-align: center; margin: 6px 0; font-family: var(--vscode-editor-font-family, monospace); }
    .frac { display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center; margin: 0 2px; }
    .frac-top { border-bottom: 1px solid currentColor; padding: 0 3px; }
    .frac-bottom { padding: 0 3px; }
    .sqrt-body { border-top: 1px solid currentColor; padding: 0 2px; }
    .bubble .context-details summary { cursor: pointer; color: var(--muted); font-size: 12px; user-select: none; }
    .bubble .context-details pre { max-height: 220px; overflow-y: auto; white-space: pre-wrap; }
    .bubble h1, .bubble h2, .bubble h3 { font-size: 1.1em; margin: 8px 0 4px; }
    .bubble p { margin: 4px 0; }
    .bubble ul, .bubble ol { margin: 4px 0; padding-left: 20px; }
    .bubble blockquote { margin: 6px 0; padding: 2px 10px; border-left: 3px solid var(--border); color: var(--muted); }
    .bubble hr { border: none; border-top: 1px solid var(--border); margin: 8px 0; }
    .bubble a { color: var(--accent); }
    .bubble table { border-collapse: collapse; }
    .bubble td, .bubble th { border: 1px solid var(--border); padding: 3px 6px; }

    /* Composer */
    .composer { flex: 0 0 auto; border-top: 1px solid var(--border); padding: 8px 10px; position: relative; }
    .file-picker {
      position: absolute; bottom: 100%; left: 10px; right: 10px; max-height: 220px; overflow-y: auto;
      background: var(--input-bg); border: 1px solid var(--border); border-radius: 4px; z-index: 10;
      display: none;
    }
    .file-picker.open { display: block; }
    .file-picker .item { padding: 5px 8px; cursor: pointer; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .file-picker .item:hover { background: var(--hover); }
    .file-picker .item.selected { background: var(--hover); }
    .file-picker .item .desc { color: var(--muted); font-size: 11px; }
    .working-bar {
      margin-bottom: 6px; font-size: 12px; color: var(--accent);
      display: flex; align-items: center; gap: 6px;
    }
    .working-bar::before {
      content: ''; width: 8px; height: 8px; border-radius: 50%;
      background: var(--accent); animation: iconPulse 1s ease-in-out infinite;
    }
    .queue-dock { display: none; flex-direction: column; gap: 4px; margin-bottom: 6px; }
    .queue-dock.open { display: flex; }
    .queue-item {
      display: flex; align-items: flex-start; gap: 6px;
      border: 1px dashed var(--border); border-radius: 4px;
      padding: 4px 8px; font-size: 12px; color: var(--muted);
    }
    .queue-item .queue-label { flex: 0 0 auto; color: var(--accent); }
    .queue-item .queue-text { flex: 1; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
    .queue-item .queue-remove {
      flex: 0 0 auto; height: 20px; min-width: 24px; padding: 0 5px;
      font-size: 11px; line-height: 1;
    }
    .question-panel {
      margin-bottom: 6px; border: 1px solid var(--border); border-radius: 6px;
      background: var(--input-bg); padding: 10px;
    }
    .question-panel .q-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
      font-weight: 600; font-size: 13px;
    }
    .question-panel .q-header .spacer { flex: 1; }
    .question-panel .q-question { font-size: 12px; margin-bottom: 6px; }
    .question-panel .q-detail {
      max-height: 180px; overflow-y: auto; border: 1px solid var(--border);
      border-radius: 4px; padding: 6px 8px; margin-bottom: 8px;
      background: var(--bg);
    }
    .question-panel .q-options { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .question-panel .q-option {
      border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px;
      font-size: 12px; cursor: pointer; background: transparent; color: var(--fg);
    }
    .question-panel .q-option.selected { border-color: var(--accent); background: var(--hover); }
    .question-panel .q-custom-input {
      width: 100%; background: var(--bg); color: var(--input-fg);
      border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px;
      font: inherit; font-size: 12px; margin-bottom: 8px;
    }
    .question-panel .q-actions { display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
    .question-panel .q-error { color: var(--error); font-size: 11px; margin-bottom: 6px; }
    .approval-panel { border-left: 3px solid #f9e2af; }
    .approval-panel .a-tool { font-weight: 600; }
    .approval-panel .a-reason { color: var(--muted); font-size: 12px; margin-top: 4px; white-space: pre-wrap; }
    .todo-dock {
      display: none; border: 1px solid var(--border); border-radius: 6px;
      padding: 6px 8px; margin-bottom: 6px; font-size: 12px;
      background: var(--input-bg);
    }
    .todo-dock.open { display: block; }
    .todo-dock .todo-header { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .todo-dock .todo-title { font-weight: 600; }
    .todo-dock .todo-progress { color: var(--muted); flex: 1; text-align: right; }
    .todo-dock .todo-list { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
    .todo-dock .todo-item { display: flex; gap: 6px; align-items: center; }
    .todo-dock .todo-status { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
    .todo-dock .todo-status.completed { background: #a6e3a1; }
    .todo-dock .todo-status.in_progress { background: #f9e2af; }
    .todo-dock .todo-status.pending { background: #6c7086; }
    .permission-button {
      display: none; min-width: 36px; max-width: 36px; padding: 0 4px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-weight: 600;
    }
    .permission-button.open { display: inline-block; }
    .permission-popover {
      position: absolute; left: 10px; bottom: calc(100% - 4px); width: 220px;
      background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
      padding: 6px; z-index: 12; display: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      max-height: 200px; overflow-y: auto;
    }
    .permission-popover.open { display: block; }
    .permission-option {
      display: block; width: 100%; text-align: left; border: none;
      background: transparent; color: var(--fg); padding: 5px 8px;
      border-radius: 4px; font: inherit; font-size: 12px; cursor: pointer;
    }
    .permission-option:hover { background: var(--hover); }
    .permission-option.selected { background: var(--hover); color: var(--accent); }
    .queue-item .queue-action {
      flex: 0 0 auto; height: 20px; min-width: 24px; padding: 0 5px;
      font-size: 11px; line-height: 1;
    }
    .composer-row { display: flex; gap: 6px; align-items: flex-end; }
    .composer-row button { flex: 0 0 auto; height: 36px; min-width: 36px; padding: 0 8px; }
    #stopBtn { font-size: 14px; padding: 0 10px; }
    .model-button { min-width: 36px; max-width: 36px; padding: 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .model-popover {
      position: absolute; right: 10px; bottom: calc(100% - 4px); width: 300px;
      background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
      padding: 8px; z-index: 11; display: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    }
    .model-popover.open { display: block; }
    .model-popover-row {
      display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
      font-size: 12px; color: var(--muted);
    }
    .model-popover-row:last-of-type { margin-bottom: 4px; }
    .model-popover-row label { flex: 0 0 auto; }
    .model-popover-row select {
      flex: 1; min-width: 0; background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px;
      font: inherit; font-size: 12px;
    }
    .model-popover .hint { margin-top: 2px; }
    .model-custom-sep { border-top: 1px dashed var(--border); margin: 6px 0; }
    .model-popover-row input[type=text] {
      flex: 1; min-width: 0; background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px;
      font: inherit; font-size: 12px;
    }
    .model-popover-row button { height: 26px; padding: 0 8px; }
    #composerInput {
      flex: 1; resize: none; min-height: 36px; max-height: 180px;
      background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--border); border-radius: 4px; padding: 8px 10px;
      font: inherit; line-height: 1.5;
    }
    #composerInput:focus { outline: 1px solid var(--accent); }
    body.composer-expanded #composerInput { max-height: none; height: 40vh; min-height: 220px; }
    .hint { color: var(--muted); font-size: 11px; margin-top: 4px; }
    .stats-bar {
      margin-top: 4px; font-size: 11px; color: var(--muted);
      text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* New session modal */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 20;
      display: none; align-items: center; justify-content: center;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      width: min(360px, calc(100% - 24px)); background: var(--bg);
      border: 1px solid var(--border); border-radius: 8px; padding: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    }
    .modal-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-weight: 600; }
    .modal-header .spacer { flex: 1; }
    .preset-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
    .preset-item {
      border: 1px solid var(--border); border-radius: 6px; padding: 8px; cursor: pointer;
    }
    .preset-item:hover { background: var(--hover); }
    .preset-item.selected { border-color: var(--accent); background: var(--hover); }
    .preset-item .pname { font-weight: 600; }
    .preset-item .pdesc { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
    .settings-modal { width: min(480px, calc(100% - 24px)); }
    .settings-content { max-height: 55vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .settings-section { border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
    .settings-section h3 { margin: 0 0 6px; font-size: 12px; color: var(--muted); font-weight: 600; }
    .settings-field { margin-bottom: 8px; }
    .settings-field:last-child { margin-bottom: 0; }
    .settings-field .field-label { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 4px; }
    .settings-field .field-status { font-size: 11px; color: var(--muted); }
    .settings-field input[type=password], .settings-field input[type=text], .settings-field select {
      width: 100%; background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px;
      font: inherit; font-size: 12px;
    }
    .settings-field .field-actions { display: flex; gap: 6px; margin-top: 4px; justify-content: flex-end; }
    .archive-message { font-size: 12px; color: var(--muted); line-height: 1.6; word-break: break-all; }
  </style>
</head>
<body>
  <div id="app">
    <div class="sessions-wrap">
      <span class="status-badge"><span id="statusDot" class="status-dot stopped"></span><span id="statusText">stopped</span></span>
      <button id="settingsBtn" title="设置">⚙</button>
      <button id="refreshBtn" title="刷新会话">刷新</button>
      <button id="newSessionBtn" class="primary" title="新建会话">+ 新会话</button>
      <select id="sessionSelect" title="选择会话"></select>
      <button id="renameSessionBtn" title="重命名会话">✎</button>
      <button id="closeSessionBtn" title="归档/关闭会话">✕</button>
      <button id="downloadSessionBtn" title="下载当前会话上下文">⬇</button>
    </div>
    <div id="chat" class="chat">
      <div class="empty">正在连接 DeepSeek Harness…</div>
    </div>
    <div class="composer">
      <div id="filePicker" class="file-picker"></div>
      <div id="commandPicker" class="file-picker command-picker"></div>
      <div id="workingBar" class="working-bar" style="display:none">working</div>
      <div id="todoDock" class="todo-dock"></div>
      <div id="queueDock" class="queue-dock"></div>
      <div id="questionPanel" class="question-panel" style="display:none"></div>
      <div id="approvalPanel" class="question-panel approval-panel" style="display:none"></div>
      <div id="composerRow" class="composer-row">
        <button id="permissionBtn" class="permission-button" title="选择权限">权</button>
        <textarea id="composerInput" rows="1" placeholder="Enter 发送 · Shift+Enter 换行 · @ 引用文件 · / 命令"></textarea>
        <button id="expandBtn" title="展开/收起输入框">⤢</button>
        <button id="stopBtn" title="停止生成" style="display:none">■</button>
        <button id="sendBtn" class="primary" title="发送">发送</button>
        <button id="modelBtn" class="model-button" title="模型与推理强度">模</button>
      </div>
      <div id="modelPopover" class="model-popover">
        <div class="model-popover-row">
          <label>模型</label>
          <select id="modelSelect" title="选择模型"></select>
        </div>
        <div class="model-popover-row">
          <label>推理</label>
          <select id="effortSelect" title="选择推理等级"></select>
        </div>
        <div class="model-custom-sep"></div>
        <div class="model-popover-row">
          <label>自定义</label>
          <select id="customProviderSelect" title="自定义模型 provider"></select>
        </div>
        <div class="model-popover-row">
          <input id="customModelInput" type="text" placeholder="输入模型名称">
          <button id="customModelApplyBtn" class="primary" title="应用自定义模型">应用</button>
        </div>
        <span id="modelStatus" class="hint" style="margin-top:0"></span>
      </div>
      <div id="permissionPopover" class="permission-popover"></div>
      <div id="statsBar" class="stats-bar"></div>
    </div>
    <div id="settingsModal" class="modal-overlay">
      <div class="modal settings-modal">
        <div class="modal-header">
          <span>设置</span>
          <span class="spacer"></span>
          <button id="settingsClose" title="关闭">✕</button>
        </div>
        <div id="settingsContent" class="settings-content"></div>
        <div class="modal-footer">
          <button id="settingsOpenDocBtn">打开 settings.yaml</button>
          <button id="settingsDoneBtn" class="primary">完成</button>
        </div>
      </div>
    </div>
    <div id="archiveModal" class="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <span>归档/关闭会话</span>
          <span class="spacer"></span>
          <button id="archiveClose" title="关闭">✕</button>
        </div>
        <div id="archiveMessage" class="archive-message"></div>
        <div class="modal-footer">
          <button id="archiveCancelBtn">取消</button>
          <button id="archiveConfirmBtn" class="primary">确认归档</button>
        </div>
      </div>
    </div>
    <div id="deleteModal" class="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <span>删除上下文</span>
          <span class="spacer"></span>
          <button id="deleteClose" title="关闭">✕</button>
        </div>
        <div id="deleteMessage" class="archive-message"></div>
        <div class="modal-footer">
          <button id="deleteCancelBtn">取消</button>
          <button id="deleteConfirmBtn" class="primary">确认删除</button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
  (function () {
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
      language: 'zh',
      enterToSend: true,
      queueItems: [],
      hasMoreEarlier: false,
      loadingEarlier: false,
      pendingQuestion: null,
      pendingApproval: null,
      todos: [],
      permissions: null,
      questionSelections: {},
      questionCustom: {},
      hiddenItemIds: {}
    };

    var $ = function (id) { return document.getElementById(id); };
    var chatEl = $('chat');
    var selectEl = $('sessionSelect');
    var inputEl = $('composerInput');
    var sendBtn = $('sendBtn');
    var stopBtn = $('stopBtn');
    var filePicker = $('filePicker');
    var expandBtn = $('expandBtn');
    var closeSessionBtn = $('closeSessionBtn');
    var renameSessionBtn = $('renameSessionBtn');
    var downloadSessionBtn = $('downloadSessionBtn');
    var commandPicker = $('commandPicker');
    var modelSelectEl = $('modelSelect');
    var effortSelectEl = $('effortSelect');
    var modelStatusEl = $('modelStatus');
    var statsBarEl = $('statsBar');
    var workingBarEl = $('workingBar');
    var queueDockEl = $('queueDock');
    var todoDockEl = $('todoDock');
    var questionPanelEl = $('questionPanel');
    var approvalPanelEl = $('approvalPanel');
    var composerRowEl = $('composerRow');
    var permissionBtn = $('permissionBtn');
    var permissionPopover = $('permissionPopover');
    var modelBtn = $('modelBtn');
    var modelPopover = $('modelPopover');
    var customProviderSelect = $('customProviderSelect');
    var customModelInput = $('customModelInput');
    var customModelApplyBtn = $('customModelApplyBtn');
    var settingsBtn = $('settingsBtn');
    var settingsModal = $('settingsModal');
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
    var deleteModal = $('deleteModal');
    var deleteMessage = $('deleteMessage');
    var deleteCloseBtn = $('deleteClose');
    var deleteCancelBtn = $('deleteCancelBtn');
    var deleteConfirmBtn = $('deleteConfirmBtn');
    var pendingDeleteItem = null;

    function post(msg) { vscode.postMessage(msg); }

    function applyFontSize() {
      var size = Number(state.fontSize) || 13;
      if (size < 10) size = 10;
      if (size > 24) size = 24;
      document.documentElement.style.setProperty('--vscode-font-size', size + 'px');
      document.body.style.fontSize = size + 'px';
    }

    var I18N = {
      zh: {
        'status.discovering': '发现中',
        'status.starting': '启动中',
        'status.ready': '就绪',
        'status.reconnecting': '重连中',
        'status.stopped': '已停止',
        'status.error': '错误',
        'newSession': '+ 新会话',
        'newSessionTitle': '新建会话',
        'refresh': '刷新',
        'refreshTitle': '刷新会话',
        'renameSession': '重命名会话',
        'closeSession': '归档/关闭会话',
        'settings': '设置',
        'expand': '展开/收起输入框',
        'stop': '停止生成',
        'send': '发送',
        'composerPlaceholder': 'Enter 发送 · Shift+Enter 换行 · @ 引用文件 · / 命令',
        'composerPlaceholderAlt': 'Shift+Enter 发送 · Enter 换行 · @ 引用文件 · / 命令',
        'emptyReady': '新会话已就绪。输入消息开始与 DeepSeek Harness 对话。',
        'conciseHidden': '简洁模式已隐藏工具调用与思考流程。',
        'blankTitle': '新会话',
        'session': '会话',
        'noSessions': '暂无会话',
        'selectMode': '选择工作模式',
        'selectModeDesc': '当前是新会话。选择一种工作模式后，即可在下方输入消息开始对话。',
        'loadingModes': '正在加载工作模式…',
        'queued': '排队中',
        'queueEdit': '编辑排队消息',
        'queueSteer': '转为插话（steer）',
        'queueRemove': '删除排队消息',
        'toolApproval': '工具审批',
        'reject': '拒绝',
        'allowOnce': '允许一次',
        'tool': '工具',
        'unknown': '未知',
        'waitingAnswer': '等待回答',
        'closeAndCancel': '关闭并取消问题',
        'submitAnswer': '提交回答',
        'deleteThis': '删除此段上下文',
        'deleteSegmentMsg': '将删除上次用户消息之后到当前条目之间的所有上下文（包括被隐藏的工具调用、思考流程与上下文注入）。',
        'deleteSingleMsg': '将删除该条消息。',
        'meta.assistant': 'DeepSeek',
        'meta.tool': '工具',
        'meta.note': '提示',
        'meta.context': '上下文',
        'generating': '生成中…',
        'contextInjection': '上下文注入',
        'permissionTitle': '选择权限（当前：{label}）',
        'permissionRunning': '会话运行中无法切换权限',
        'modelTitle': '模型与推理强度（当前：{label}）',
        'modelFallback': '模型 · 推理',
        'archiveTitle': '归档/关闭会话',
        'archiveMessage': '将归档会话「{title}」。归档后会从会话列表移除，但会话记录副本会保存到当前工作目录的 .dsh-vsc/archived-sessions/ 下。',
        'confirmArchive': '确认归档',
        'cancel': '取消',
        'deleteTitle': '删除上下文',
        'confirmDelete': '确认删除',
        'settingsOpenDoc': '打开 settings.yaml',
        'settingsDone': '完成',
        'settingsReadonly': '当前 settings provider 为只读，无法修改配置。',
        'sessionDisplaySection': '会话显示',
        'sessionDisplayLabel': '会话显示模式',
        'concise': '简洁会话',
        'detailed': '详细会话',
        'fontSizeSection': '字体大小',
        'fontSizeLabel': '聊天界面字体大小',
        'languageSection': '界面语言',
        'languageLabel': '插件界面语言',
        'languageZh': '中文',
        'languageEn': 'English',
        'languageSwitchTitle': '点击切换到 {target}',
        'sendModeSection': '发送方式',
        'sendModeLabel': '输入框按键行为',
        'sendModeEnter': 'Enter 发送，Shift+Enter 换行',
        'sendModeShiftEnter': 'Shift+Enter 发送，Enter 换行',
        'loadEarlier': '加载更早',
        'loadingEarlier': '加载中…',
        'stats.ctxNone': '上下文:—',
        'stats.ctx': '上下文:{pct}%',
        'stats.turns': '{turns} 轮 · {steps} 步',
        'stats.llm': 'LLM',
        'stats.tool': '工具调用',
        'stats.ttftAvg': '首 token 平均',
        'stats.tokPerSec': '{rate} tok/s',
        'stats.cacheHit': '缓存命中 {pct}%',
        'stats.inputOutput': '输入 {input} tokens · 输出 {output} tokens',
        'apiKeys': 'API Keys',
        'planReview': '计划评审',
        'chatAboutIt': '聊一聊'
      },
      en: {
        'status.discovering': 'Discovering',
        'status.starting': 'Starting',
        'status.ready': 'Ready',
        'status.reconnecting': 'Reconnecting',
        'status.stopped': 'Stopped',
        'status.error': 'Error',
        'newSession': '+ New Session',
        'newSessionTitle': 'New Session',
        'refresh': 'Refresh',
        'refreshTitle': 'Refresh Sessions',
        'renameSession': 'Rename Session',
        'closeSession': 'Archive/Close Session',
        'settings': 'Settings',
        'expand': 'Expand/Collapse Input',
        'stop': 'Stop Generation',
        'send': 'Send',
        'composerPlaceholder': 'Enter to send · Shift+Enter for newline · @ files · / commands',
        'composerPlaceholderAlt': 'Shift+Enter to send · Enter for newline · @ files · / commands',
        'emptyReady': 'New session ready. Type a message to start chatting with DeepSeek Harness.',
        'conciseHidden': 'Concise mode has hidden tool calls and reasoning.',
        'blankTitle': 'New Session',
        'session': 'Session',
        'noSessions': 'No Sessions',
        'selectMode': 'Select Working Mode',
        'selectModeDesc': 'This is a new session. Choose a working mode to start chatting below.',
        'loadingModes': 'Loading working modes…',
        'queued': 'Queued',
        'queueEdit': 'Edit queued message',
        'queueSteer': 'Steer (interrupt)',
        'queueRemove': 'Remove queued message',
        'toolApproval': 'Tool Approval',
        'reject': 'Reject',
        'allowOnce': 'Allow Once',
        'tool': 'Tool',
        'unknown': 'Unknown',
        'waitingAnswer': 'Waiting for Answer',
        'closeAndCancel': 'Close and cancel question',
        'submitAnswer': 'Submit Answer',
        'deleteThis': 'Delete this context',
        'deleteSegmentMsg': 'This will delete all context since the last user message up to the current item (including hidden tool calls, reasoning, and context injections).',
        'deleteSingleMsg': 'This will delete this message.',
        'meta.assistant': 'DeepSeek',
        'meta.tool': 'Tool',
        'meta.note': 'Note',
        'meta.context': 'Context',
        'generating': 'Generating…',
        'contextInjection': 'Context Injection',
        'permissionTitle': 'Select permission (current: {label})',
        'permissionRunning': 'Cannot switch permission while session is running',
        'modelTitle': 'Model & Reasoning (current: {label})',
        'modelFallback': 'Model · Reasoning',
        'archiveTitle': 'Archive/Close Session',
        'archiveMessage': 'Archive session "{title}"? It will be removed from the list and a copy will be saved to .dsh-vsc/archived-sessions/ in the current workspace.',
        'confirmArchive': 'Archive',
        'cancel': 'Cancel',
        'deleteTitle': 'Delete Context',
        'confirmDelete': 'Delete',
        'settingsOpenDoc': 'Open settings.yaml',
        'settingsDone': 'Done',
        'settingsReadonly': 'The current settings provider is read-only and cannot be modified.',
        'sessionDisplaySection': 'Session Display',
        'sessionDisplayLabel': 'Session display mode',
        'concise': 'Concise',
        'detailed': 'Detailed',
        'fontSizeSection': 'Font Size',
        'fontSizeLabel': 'Chat font size',
        'languageSection': 'Language',
        'languageLabel': 'Plugin UI language',
        'languageZh': '中文',
        'languageEn': 'English',
        'languageSwitchTitle': 'Click to switch to {target}',
        'sendModeSection': 'Send Mode',
        'sendModeLabel': 'Input key behavior',
        'sendModeEnter': 'Enter to send, Shift+Enter for newline',
        'sendModeShiftEnter': 'Shift+Enter to send, Enter for newline',
        'loadEarlier': 'Load earlier',
        'loadingEarlier': 'Loading…',
        'stats.ctxNone': 'ctx:—',
        'stats.ctx': 'ctx:{pct}%',
        'stats.turns': '{turns} turns · {steps} steps',
        'stats.llm': 'LLM',
        'stats.tool': 'tool calls',
        'stats.ttftAvg': 'TTFT avg',
        'stats.tokPerSec': '{rate} tok/s',
        'stats.cacheHit': 'cache hit {pct}%',
        'stats.inputOutput': 'input {input} tokens · output {output} tokens',
        'apiKeys': 'API Keys',
        'planReview': 'Plan Review',
        'chatAboutIt': 'Chat about it'
      }
    };

    function t(key, params) {
      var lang = state.language === 'en' ? 'en' : 'zh';
      var str = (I18N[lang] && I18N[lang][key]) || I18N.zh[key] || key;
      if (params) {
        for (var k in params) {
          str = str.split('{' + k + '}').join(params[k]);
        }
      }
      return str;
    }

    function applyLanguage() {
      newSessionBtn.textContent = t('newSession');
      newSessionBtn.title = t('newSessionTitle');
      refreshBtn.textContent = t('refresh');
      refreshBtn.title = t('refreshTitle');
      renameSessionBtn.title = t('renameSession');
      closeSessionBtn.title = t('closeSession');
      settingsBtn.title = t('settings');
      expandBtn.title = t('expand');
      stopBtn.title = t('stop');
      sendBtn.textContent = t('send');
      sendBtn.title = t('send');
      composerInput.placeholder = state.enterToSend ? t('composerPlaceholder') : t('composerPlaceholderAlt');
      settingsOpenDocBtn.textContent = t('settingsOpenDoc');
      settingsDoneBtn.textContent = t('settingsDone');
      archiveCancelBtn.textContent = t('cancel');
      archiveConfirmBtn.textContent = t('confirmArchive');
      deleteCancelBtn.textContent = t('cancel');
      deleteConfirmBtn.textContent = t('confirmDelete');
      document.querySelector('#settingsModal .modal-header span').textContent = t('settings');
      document.querySelector('#archiveModal .modal-header span').textContent = t('archiveTitle');
      document.querySelector('#deleteModal .modal-header span').textContent = t('deleteTitle');
      permissionBtn.textContent = '权';
      modelBtn.textContent = '模';
      renderStatus();
      renderSessions();
      renderConversation();
      renderQueue();
      renderApproval();
      renderQuestion();
      updatePermissionUi();
      renderModelButton();
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    var BACKTICK = String.fromCharCode(96);
    var LF = String.fromCharCode(10);
    var NUL = String.fromCharCode(0);
    var BS = String.fromCharCode(92);

    function leadingIndent(s) {
      var n = 0;
      for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        if (ch === ' ') n++;
        else if (ch === String.fromCharCode(9)) n += 2;
        else break;
      }
      return n;
    }

    function parseListMarker(line) {
      var indent = leadingIndent(line);
      var rest = line.slice(indent);
      if (!rest) return null;
      var ch = rest.charAt(0);
      if ((ch === '-' || ch === '*' || ch === '+') && rest.charAt(1) === ' ') {
        return { indent: indent, marker: ch, ordered: false, content: rest.slice(2) };
      }
      var j = 0;
      while (j < rest.length && rest.charAt(j) >= '0' && rest.charAt(j) <= '9') j++;
      if (j > 0 && (rest.charAt(j) === '.' || rest.charAt(j) === ')') && rest.charAt(j + 1) === ' ') {
        return { indent: indent, marker: rest.slice(0, j + 1), ordered: true, content: rest.slice(j + 2) };
      }
      return null;
    }

    function parseFence(line) {
      var t = line.trim();
      if (t.length < 3) return null;
      var ch = t.charAt(0);
      if (ch !== BACKTICK && ch !== '~') return null;
      var n = 0;
      while (n < t.length && t.charAt(n) === ch) n++;
      if (n < 3) return null;
      return { marker: t.slice(0, n), lang: t.slice(n).trim() };
    }

    function isFenceClose(line, marker) {
      var t = line.trim();
      if (t.charAt(0) !== marker.charAt(0)) return false;
      if (t.length < marker.length) return false;
      for (var i = 0; i < t.length; i++) {
        if (t.charAt(i) !== marker.charAt(0)) return false;
      }
      return true;
    }

    function parseHeading(line) {
      var t = line.trim();
      var level = 0;
      while (level < 6 && t.charAt(level) === '#') level++;
      if (level > 0 && t.charAt(level) === ' ') {
        return { level: level, text: t.slice(level + 1).trim() };
      }
      return null;
    }

    function isHr(line) {
      var t = line.trim();
      if (t.length < 3) return false;
      var ch = t.charAt(0);
      if (ch !== '-' && ch !== '*' && ch !== '_') return false;
      for (var i = 0; i < t.length; i++) {
        if (t.charAt(i) !== ch) return false;
      }
      return true;
    }

    function blockquoteContent(line) {
      var t = line.trim();
      t = t.slice(1);
      if (t.charAt(0) === ' ') t = t.slice(1);
      return t;
    }

    function highlightCode(code, lang) {
      var s = escapeHtml(code);
      var placeholders = [];
      s = s.replace(/(&quot;.*?&quot;)/g, function (m) {
        var idx = placeholders.length;
        placeholders.push('<span class="tok-string">' + m + '</span>');
        return NUL + 'ph' + idx + 'ph' + NUL;
      });
      s = s.replace(/(&#39;.*?&#39;)/g, function (m) {
        var idx = placeholders.length;
        placeholders.push('<span class="tok-string">' + m + '</span>');
        return NUL + 'ph' + idx + 'ph' + NUL;
      });
      var lines = s.split(LF);
      var commented = [];
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        var ci = line.indexOf('//');
        if (ci < 0) ci = line.indexOf('#');
        if (ci >= 0) {
          var cidx = placeholders.length;
          placeholders.push('<span class="tok-comment">' + line.slice(ci) + '</span>');
          commented.push(line.slice(0, ci) + NUL + 'ph' + cidx + 'ph' + NUL);
        } else {
          commented.push(line);
        }
      }
      s = commented.join(LF);
      var keywords = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from', 'new', 'try', 'catch', 'async', 'await', 'def', 'lambda', 'yield', 'break', 'continue', 'switch', 'case', 'throw', 'typeof', 'instanceof', 'in', 'of'];
      for (var k = 0; k < keywords.length; k++) {
        var kw = keywords[k];
        var re = new RegExp(BS + 'b' + kw + BS + 'b', 'g');
        s = s.replace(re, function () {
          var idx = placeholders.length;
          placeholders.push('<span class="tok-keyword">' + kw + '</span>');
          return NUL + 'ph' + idx + 'ph' + NUL;
        });
      }
      var numRe = new RegExp(BS + 'b(' + BS + 'd+' + BS + '.?' + BS + 'd*)' + BS + 'b', 'g');
      s = s.replace(numRe, function (m, num) {
        var idx = placeholders.length;
        placeholders.push('<span class="tok-number">' + num + '</span>');
        return NUL + 'ph' + idx + 'ph' + NUL;
      });
      for (var j = 0; j < placeholders.length; j++) {
        s = s.split(NUL + 'ph' + j + 'ph' + NUL).join(placeholders[j]);
      }
      return s;
    }

    function renderLatex(tex) {
      var s = escapeHtml(tex);
      var greek = {
        alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
        eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
        nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ',
        tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
        Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
        Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
      };
      for (var g in greek) {
        s = s.split(BS + g + ' ').join(greek[g] + ' ');
        s = s.split(BS + g).join(greek[g]);
      }
      var supRe = new RegExp(BS + '^' + BS + '{([^{}]+)}', 'g');
      s = s.replace(supRe, '<sup>$1</sup>');
      var supSimpleRe = new RegExp(BS + '^([A-Za-z0-9])', 'g');
      s = s.replace(supSimpleRe, '<sup>$1</sup>');
      var subRe = new RegExp(BS + '_' + BS + '{([^{}]+)}', 'g');
      s = s.replace(subRe, '<sub>$1</sub>');
      var subSimpleRe = new RegExp(BS + '_([A-Za-z0-9])', 'g');
      s = s.replace(subSimpleRe, '<sub>$1</sub>');
      var fracRe = new RegExp(BS + BS + 'frac' + BS + '{([^{}]+)}' + BS + '{([^{}]+)}', 'g');
      s = s.replace(fracRe, '<span class="frac"><span class="frac-top">$1</span><span class="frac-bottom">$2</span></span>');
      var sqrtRe = new RegExp(BS + BS + 'sqrt' + BS + '{([^{}]+)}', 'g');
      s = s.replace(sqrtRe, '<span class="sqrt">√<span class="sqrt-body">$1</span></span>');
      var ops = { times: '×', cdot: '·', pm: '±', le: '≤', ge: '≥', neq: '≠', infty: '∞', to: '→', rightarrow: '→', sum: '∑', int: '∫', prod: '∏' };
      for (var op in ops) {
        s = s.split(BS + op).join(ops[op]);
      }
      s = s.split(BS + ',').join(' ');
      s = s.split(BS + ';').join(' ');
      s = s.split(BS + 'quad').join(' ');
      s = s.split(BS + 'qquad').join(' ');
      s = s.split(BS + 'left').join('');
      s = s.split(BS + 'right').join('');
      return s;
    }

    function renderMathSpans(text) {
      var s = text;
      var DOLLAR = BS + '$';
      var blockRe = new RegExp(DOLLAR + DOLLAR + '([^$' + LF + ']+)' + DOLLAR + DOLLAR, 'g');
      s = s.replace(blockRe, function (m, tex) {
        return '<span class="math-block">' + renderLatex(tex) + '</span>';
      });
      var inlineRe = new RegExp(DOLLAR + '([^$' + LF + ']+)' + DOLLAR, 'g');
      s = s.replace(inlineRe, function (m, tex) {
        return '<span class="math-inline">' + renderLatex(tex) + '</span>';
      });
      return s;
    }

    function renderInline(text) {
      var raw = String(text || '');
      var parts = raw.split(BACKTICK);
      var mixed = '';
      var codePlaceholders = [];
      for (var i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          var idx = codePlaceholders.length;
          codePlaceholders.push('<code>' + escapeHtml(parts[i]) + '</code>');
          mixed += NUL + idx + NUL;
        } else {
          mixed += parts[i];
        }
      }
      var s = escapeHtml(mixed);
      s = renderMathSpans(s);
      s = s.replace(/!\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+"([^"]*)")?\\)/g, '<img alt="$1" src="$2">');
      s = s.replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)(?:\\s+"([^"]*)")?\\)/g, '<a href="$2">$1</a>');
      s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
      s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^\\w])\\*([^*\\n]+)\\*(?=[^\\w]|$)/g, '$1<em>$2</em>');
      s = s.replace(/(^|[^\\w])_([^_\\n]+)_(?=[^\\w]|$)/g, '$1<em>$2</em>');
      s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      for (var j = 0; j < codePlaceholders.length; j++) {
        s = s.split(NUL + j + NUL).join(codePlaceholders[j]);
      }
      return s;
    }

    function splitTableRow(line) {
      var s = line.trim();
      if (s.charAt(0) === '|') s = s.slice(1);
      if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
      return s.split('|').map(function (cell) { return cell.trim(); });
    }

    function renderTable(lines, start) {
      var headers = splitTableRow(lines[start]);
      var aligns = splitTableRow(lines[start + 1]);
      if (!headers.length || headers.length !== aligns.length) return null;
      var alignVals = [];
      for (var a = 0; a < aligns.length; a++) {
        if (!/^:?-+:?$/.test(aligns[a])) return null;
        if (aligns[a].charAt(0) === ':' && aligns[a].charAt(aligns[a].length - 1) === ':') alignVals.push('center');
        else if (aligns[a].charAt(aligns[a].length - 1) === ':') alignVals.push('right');
        else if (aligns[a].charAt(0) === ':') alignVals.push('left');
        else alignVals.push('');
      }
      var html = '<table><thead><tr>';
      for (var h = 0; h < headers.length; h++) {
        html += '<th' + (alignVals[h] ? ' style="text-align:' + alignVals[h] + '"' : '') + '>' + renderInline(headers[h]) + '</th>';
      }
      html += '</tr></thead><tbody>';
      var r = start + 2;
      while (r < lines.length && lines[r].trim() !== '' && lines[r].indexOf('|') >= 0) {
        var cells = splitTableRow(lines[r]);
        html += '<tr>';
        for (var c = 0; c < headers.length; c++) {
          html += '<td' + (alignVals[c] ? ' style="text-align:' + alignVals[c] + '"' : '') + '>' + renderInline(cells[c] || '') + '</td>';
        }
        html += '</tr>';
        r++;
      }
      html += '</tbody></table>';
      return { html: html, next: r };
    }

    function renderList(lines, start) {
      var first = parseListMarker(lines[start]);
      if (!first) return { html: '', next: start };
      var baseIndent = first.indent;
      var html = '<' + (first.ordered ? 'ol' : 'ul') + '>';
      var i = start;
      while (i < lines.length) {
        var m = parseListMarker(lines[i]);
        if (!m) break;
        if (m.indent < baseIndent) break;
        if (m.indent > baseIndent) break;
        if (m.ordered !== first.ordered) break;
        var content = m.content;
        i++;
        var inner = [];
        while (i < lines.length) {
          var sub = lines[i];
          if (sub.trim() === '') {
            var look = i + 1;
            while (look < lines.length && lines[look].trim() === '') look++;
            if (look >= lines.length) { i = look; break; }
            var lookIndent = leadingIndent(lines[look]);
            var lookList = parseListMarker(lines[look]);
            if (lookList && lookIndent === baseIndent) { i = look; break; }
            if (lookIndent > baseIndent) { inner.push(''); i++; continue; }
            i = look;
            break;
          }
          if (leadingIndent(sub) > baseIndent) {
            inner.push(sub.slice(baseIndent));
            i++;
          } else {
            break;
          }
        }
        html += '<li>' + renderInline(content);
        if (inner.length) html += renderMarkdown(inner.join(LF));
        html += '</li>';
      }
      html += '</' + (first.ordered ? 'ol' : 'ul') + '>';
      return { html: html, next: i };
    }

    function renderMarkdown(text) {
      var lines = String(text || '').split(LF);
      var out = [];
      var i = 0;
      while (i < lines.length) {
        var line = lines[i];
        var fence = parseFence(line);
        if (fence) {
          i++;
          var codeLines = [];
          while (i < lines.length) {
            if (isFenceClose(lines[i], fence.marker)) { i++; break; }
            codeLines.push(lines[i]);
            i++;
          }
          out.push('<pre><code' + (fence.lang ? ' class="language-' + escapeHtml(fence.lang) + '"' : '') + '>' + highlightCode(codeLines.join(LF), fence.lang) + '</code></pre>');
          continue;
        }
        if (line.trim().charAt(0) === '>') {
          var quoteLines = [];
          while (i < lines.length && lines[i].trim().charAt(0) === '>') {
            quoteLines.push(blockquoteContent(lines[i]));
            i++;
          }
          out.push('<blockquote>' + renderMarkdown(quoteLines.join(LF)) + '</blockquote>');
          continue;
        }
        if (line.indexOf('|') >= 0 && i + 1 < lines.length && lines[i + 1].indexOf('-') >= 0) {
          var table = renderTable(lines, i);
          if (table) { out.push(table.html); i = table.next; continue; }
        }
        var heading = parseHeading(line);
        if (heading) {
          out.push('<h' + heading.level + '>' + renderInline(heading.text) + '</h' + heading.level + '>');
          i++;
          continue;
        }
        if (isHr(line)) {
          out.push('<hr>');
          i++;
          continue;
        }
        var listMarker = parseListMarker(line);
        if (listMarker) {
          var list = renderList(lines, i);
          if (list.html) { out.push(list.html); i = list.next; continue; }
        }
        if (line.trim() === '') { i++; continue; }
        var para = [];
        while (i < lines.length && lines[i].trim() !== ''
          && !parseHeading(lines[i])
          && !parseListMarker(lines[i])
          && !parseFence(lines[i])
          && lines[i].trim().charAt(0) !== '>'
          && !isHr(lines[i])) {
          para.push(lines[i]);
          i++;
        }
        out.push('<p>' + renderInline(para.join(LF)) + '</p>');
      }
      return out.join('');
    }

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

    function itemHiddenKey(item) {
      return (state.selectedSessionId || '') + '::' + (item && item.id ? item.id : '');
    }

    function isItemHidden(item) {
      return !!item && !!item.id && !!state.hiddenItemIds[itemHiddenKey(item)];
    }

    function renderConversation() {
      var previousScrollTop = chatEl.scrollTop || 0;
      var wasNearBottom = (chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight) < 40;
      chatEl.innerHTML = '';
      if (state.hasMoreEarlier) {
        var earlierWrap = document.createElement('div');
        earlierWrap.className = 'load-earlier-wrap';
        var earlierBtn = document.createElement('button');
        earlierBtn.className = 'load-earlier-btn';
        earlierBtn.textContent = state.loadingEarlier ? t('loadingEarlier') : t('loadEarlier');
        earlierBtn.disabled = state.loadingEarlier;
        earlierBtn.addEventListener('click', function () {
          if (state.loadingEarlier) return;
          state.loadingEarlier = true;
          renderConversation();
          post({ type: 'loadEarlier', sessionId: state.selectedSessionId });
        });
        earlierWrap.appendChild(earlierBtn);
        chatEl.appendChild(earlierWrap);
      }
      var items = (state.conversation || []).filter(function (item) { return !isItemHidden(item); });
      var displayItems = state.sessionDisplay === 'concise'
        ? items.filter(function (item) {
            if (item.type === 'user') return typeof item.text === 'string' && item.text.trim().length > 0;
            if (item.type === 'assistant') return typeof item.text === 'string' && item.text.trim().length > 0;
            return false;
          })
        : items;
      if (!displayItems.length) {
        if (!items.length) {
          var session = currentSession();
          if (session && session.blank) {
            renderBlankSessionWelcome();
            return;
          }
          chatEl.innerHTML = '<div class="empty">' + escapeHtml(t('emptyReady')) + '</div>';
          return;
        }
        chatEl.innerHTML = '<div class="empty">' + escapeHtml(t('conciseHidden')) + '</div>';
        return;
      }
      for (var i = 0; i < displayItems.length; i++) {
        chatEl.appendChild(renderItem(displayItems[i]));
      }
      if (wasNearBottom) {
        chatEl.scrollTop = chatEl.scrollHeight;
      } else {
        chatEl.scrollTop = Math.min(previousScrollTop, Math.max(0, chatEl.scrollHeight - chatEl.clientHeight));
      }
    }

    function deleteConversationItem(item) {
      var items = state.conversation || [];
      var index = items.indexOf(item);
      if (index < 0) return;
      // 简洁模式下，删除非用户条目时，连同“上次用户消息之后、当前条目之前”的
      // 所有隐藏上下文（工具调用、思考、上下文注入等）一起删除。
      if (state.sessionDisplay === 'concise' && item.type !== 'user') {
        var start = 0;
        for (var i = index - 1; i >= 0; i--) {
          if (items[i].type === 'user') {
            start = i + 1;
            break;
          }
        }
        for (var j = start; j <= index; j++) {
          if (items[j].id) state.hiddenItemIds[itemHiddenKey(items[j])] = true;
        }
      } else if (item.id) {
        state.hiddenItemIds[itemHiddenKey(item)] = true;
      }
      renderConversation();
    }

    function requestDeleteConversationItem(item) {
      pendingDeleteItem = item;
      if (state.sessionDisplay === 'concise' && item.type !== 'user') {
        deleteMessage.textContent = t('deleteSegmentMsg');
      } else {
        deleteMessage.textContent = t('deleteSingleMsg');
      }
      deleteModal.classList.add('open');
    }

    function closeDeleteModal() {
      deleteModal.classList.remove('open');
      pendingDeleteItem = null;
    }

    function confirmDeleteConversationItem() {
      if (pendingDeleteItem) deleteConversationItem(pendingDeleteItem);
      closeDeleteModal();
    }

    function renderItem(item) {
      var wrap = document.createElement('div');
      wrap.className = 'msg ' + item.type;
      var meta = document.createElement('div');
      meta.className = 'meta';
      if (item.type === 'user') {
        var userDelete = document.createElement('button');
        userDelete.className = 'msg-delete';
        userDelete.textContent = '✕';
        userDelete.title = t('deleteThis');
        userDelete.addEventListener('click', function () {
          requestDeleteConversationItem(item);
        });
        meta.appendChild(userDelete);
        wrap.appendChild(meta);
      } else {
        var label = item.type === 'assistant' ? t('meta.assistant') : item.type === 'tool' ? t('meta.tool') : item.type === 'note' ? t('meta.note') : t('meta.context');
        meta.innerHTML = '<span>' + label + '</span>' + (item.partial ? '<span class="status-badge">' + t('generating') + '</span>' : '');
        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'msg-delete';
        deleteBtn.textContent = '✕';
        deleteBtn.title = t('deleteThis');
        deleteBtn.addEventListener('click', function () {
          requestDeleteConversationItem(item);
        });
        meta.appendChild(deleteBtn);
        wrap.appendChild(meta);
      }

      var bubble = document.createElement('div');
      bubble.className = 'bubble';

      if (item.type === 'assistant') {
        if (item.reasoning && state.sessionDisplay !== 'concise') {
          var r = document.createElement('div');
          r.className = 'reasoning';
          r.textContent = item.reasoning;
          bubble.appendChild(r);
        }
        bubble.innerHTML += renderMarkdown(item.text || '');
        if (item.partial) bubble.classList.add('cursor');
      } else if (item.type === 'tool') {
        bubble.innerHTML = '<div class="tool-name">' + escapeHtml(item.name || 'tool') + '</div>'
          + '<div>' + escapeHtml(toolSummary(item)) + '</div>';
      } else if (item.type === 'note') {
        bubble.textContent = item.text || '';
      } else if (item.type === 'context') {
        var ctxSummary = item.summary || (item.text || '').split('\\n').find(function (line) { return line.trim().length > 0; }) || t('contextInjection');
        bubble.innerHTML = '<details class="context-details"><summary>' + escapeHtml(ctxSummary) + '</summary><pre>'
          + escapeHtml(item.text || '') + '</pre></details>';
      } else {
        bubble.innerHTML = renderMarkdown(item.text || '');
      }
      wrap.appendChild(bubble);
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
      selectEl.innerHTML = '';
      var sessions = state.sessions || [];
      for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        var opt = document.createElement('option');
        opt.value = s.sessionId;
        opt.textContent = (s.running ? '● ' : '') + sessionDisplayTitle(s);
        opt.selected = s.sessionId === current;
        selectEl.appendChild(opt);
      }
      if (!sessions.length) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = t('noSessions');
        selectEl.appendChild(empty);
      }
      closeSessionBtn.disabled = !current;
      renameSessionBtn.disabled = !current;
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
      sendBtn.disabled = status !== 'ready';
      modelBtn.disabled = status !== 'ready';
      modelSelectEl.disabled = status !== 'ready';
      effortSelectEl.disabled = status !== 'ready';
      customProviderSelect.disabled = status !== 'ready';
      customModelInput.disabled = status !== 'ready';
      customModelApplyBtn.disabled = status !== 'ready';
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

    function renderBlankSessionWelcome() {
      chatEl.innerHTML = '';
      var session = currentSession();
      var wrap = document.createElement('div');
      wrap.className = 'mode-welcome';
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
          var name = document.createElement('div');
          name.className = 'pname';
          name.textContent = preset.name || preset.id;
          var desc = document.createElement('div');
          desc.className = 'pdesc';
          desc.textContent = preset.description || '';
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

    function applyCustomModel() {
      var name = customModelInput.value.trim();
      if (!name) {
        customModelInput.focus();
        return;
      }
      var provider = customProviderSelect.value;
      if (!provider) {
        modelStatusEl.textContent = '请先在模型列表中选择 provider';
        return;
      }
      post({ type: 'modelSelect', provider: provider, model: name });
      customModelInput.value = '';
      closeModelPopover();
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
      if (document.body.classList.contains('composer-expanded')) {
        inputEl.style.height = '40vh';
      } else {
        inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
      }
    }

    function toggleExpand() {
      document.body.classList.toggle('composer-expanded');
      expandBtn.textContent = document.body.classList.contains('composer-expanded') ? '⤡' : '⤢';
      inputEl.focus();
      autoResize();
    }

    function renderAll() {
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
      if (!text) return;
      if (state.status !== 'ready') return;
      post({ type: 'send', text: text });
      inputEl.value = '';
      inputEl.style.height = 'auto';
      closePicker();
    }

    function updateWorkingBar() {
      var active = state.running && state.sessionDisplay === 'concise';
      workingBarEl.style.display = active ? 'flex' : 'none';
      if (active) workingBarEl.textContent = 'working';
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
      if (done) progressParts.push(done + ' 已完成');
      if (active) progressParts.push(active + ' 进行中');
      if (pending) progressParts.push(pending + ' 待处理');
      todoDockEl.innerHTML = '';
      var header = document.createElement('div');
      header.className = 'todo-header';
      var title = document.createElement('span');
      title.className = 'todo-title';
      title.textContent = '计划';
      var progress = document.createElement('span');
      progress.className = 'todo-progress';
      progress.textContent = progressParts.join(' · ');
      var toggle = document.createElement('span');
      toggle.textContent = '▾';
      header.appendChild(title);
      header.appendChild(toggle);
      header.appendChild(progress);
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
      todoDockEl.appendChild(list);
    }

    function currentPermissionLabel() {
      var permissions = state.permissions;
      if (!permissions) return '权限';
      for (var i = 0; i < permissions.options.length; i++) {
        if (permissions.options[i].value === permissions.currentValue) {
          return permissions.options[i].name || permissions.options[i].value;
        }
      }
      return '权限';
    }

    function updatePermissionUi() {
      var permissions = state.permissions;
      var available = !!(permissions && Array.isArray(permissions.options) && permissions.options.length);
      var canSwitch = state.status === 'ready' && !state.running;
      permissionBtn.disabled = !canSwitch;
      permissionBtn.title = state.running ? t('permissionRunning') : t('permissionTitle', { label: currentPermissionLabel() });
    }

    function closePermissionPopover() {
      permissionPopover.classList.remove('open');
    }

    function togglePermissionPopover() {
      permissionPopover.classList.toggle('open');
    }

    function renderPermissions() {
      var permissions = state.permissions;
      if (!permissions || !Array.isArray(permissions.options) || !permissions.options.length) {
        permissionBtn.classList.remove('open');
        permissionPopover.classList.remove('open');
        return;
      }
      permissionBtn.classList.add('open');
      permissionBtn.textContent = '权';
      updatePermissionUi();
      permissionPopover.innerHTML = '';
      for (var i = 0; i < permissions.options.length; i++) {
        (function (option) {
          var item = document.createElement('button');
          item.className = 'permission-option' + (option.value === permissions.currentValue ? ' selected' : '');
          item.textContent = option.name || option.value;
          item.title = option.description || '';
          item.addEventListener('click', function () {
            post({ type: 'permissionSelect', sessionId: state.selectedSessionId, preset: option.value });
            closePermissionPopover();
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
          rpcId: approval.rpcId, approvalId: approval.approvalId, outcome: 'rejected',
        });
        state.pendingApproval = null;
        renderApproval();
        updateQuestionUi();
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
          rpcId: approval.rpcId, approvalId: approval.approvalId, outcome: 'rejected',
        });
        state.pendingApproval = null;
        renderApproval();
        updateQuestionUi();
      });
      actions.appendChild(reject);
      var allow = document.createElement('button');
      allow.className = 'primary';
      allow.textContent = t('allowOnce');
      allow.addEventListener('click', function () {
        post({
          type: 'approvalAnswer', sessionId: state.selectedSessionId,
          rpcId: approval.rpcId, approvalId: approval.approvalId, outcome: 'allowed-once',
        });
        state.pendingApproval = null;
        renderApproval();
        updateQuestionUi();
      });
      actions.appendChild(allow);
      approvalPanelEl.appendChild(actions);
    }

    function resetQuestionDrafts() {
      state.questionSelections = {};
      state.questionCustom = {};
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
      renderQuestion();
    }

    function submitQuestionAnswers() {
      var pending = state.pendingQuestion;
      if (!pending) return;
      var answers = [];
      for (var i = 0; i < pending.questions.length; i++) {
        var q = pending.questions[i];
        var selected = state.questionSelections[q.id] || [];
        var custom = (state.questionCustom[q.id] || '').trim();
        if (!Array.isArray(q.options) || q.options.length === 0) {
          if (!custom) {
            var err = document.createElement('div');
            err.className = 'q-error';
            err.textContent = '请回答问题：' + q.question;
            questionPanelEl.insertBefore(err, questionPanelEl.querySelector('.q-actions'));
            return;
          }
          answers.push({ id: q.id, selected: [], custom: custom });
        } else {
          if (selected.length === 0) {
            var err2 = document.createElement('div');
            err2.className = 'q-error';
            err2.textContent = '请选择问题「' + q.question + '」的选项';
            questionPanelEl.insertBefore(err2, questionPanelEl.querySelector('.q-actions'));
            return;
          }
          answers.push({ id: q.id, selected: selected });
        }
      }
      post({ type: 'questionAnswer', sessionId: state.selectedSessionId, rpcId: pending.rpcId, answers: answers });
      state.pendingQuestion = null;
      resetQuestionDrafts();
      renderQuestion();
      updateQuestionUi();
    }

    function cancelPendingQuestion() {
      var pending = state.pendingQuestion;
      if (!pending) return;
      post({ type: 'questionCancel', sessionId: state.selectedSessionId, rpcId: pending.rpcId });
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
      detail.className = 'q-detail';
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
          type: 'questionAnswer', sessionId: state.selectedSessionId, rpcId: pending.rpcId,
          answers: [{ id: q.id, selected: [otherLabel] }],
        });
        state.pendingQuestion = null;
        resetQuestionDrafts();
        renderQuestion();
        updateQuestionUi();
      });
      actions.appendChild(refuse);
      var approveBtn = document.createElement('button');
      approveBtn.className = 'primary';
      approveBtn.textContent = approve;
      approveBtn.addEventListener('click', function () {
        post({
          type: 'questionAnswer', sessionId: state.selectedSessionId, rpcId: pending.rpcId,
          answers: [{ id: q.id, selected: [approve] }],
        });
        state.pendingQuestion = null;
        resetQuestionDrafts();
        renderQuestion();
        updateQuestionUi();
      });
      actions.appendChild(approveBtn);
      questionPanelEl.appendChild(actions);
    }

    function appendGenericQuestion(pending, q) {
      var block = document.createElement('div');
      block.className = 'q-block';
      if (q.header) {
        var qh = document.createElement('div');
        qh.className = 'q-question';
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
            var btn = document.createElement('button');
            btn.className = 'q-option' + (questionOptionValue(q, index) ? ' selected' : '');
            btn.textContent = label + (desc ? ' · ' + desc : '');
            btn.addEventListener('click', function () { toggleQuestionOption(q, index); });
            opts.appendChild(btn);
          })(i);
        }
        block.appendChild(opts);
      } else {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'q-custom-input';
        input.placeholder = '输入你的回答';
        input.value = state.questionCustom[q.id] || '';
        input.addEventListener('input', function () {
          state.questionCustom[q.id] = input.value;
        });
        block.appendChild(input);
      }
      questionPanelEl.appendChild(block);
    }

    function renderQuestion() {
      questionPanelEl.innerHTML = '';
      var pending = state.pendingQuestion;
      if (!pending || !pending.questions || !pending.questions.length) {
        return;
      }
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
      for (var i = 0; i < pending.questions.length; i++) {
        appendGenericQuestion(pending, pending.questions[i]);
      }
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
      if (hasQuestion || hasApproval) workingBarEl.style.display = 'none';
      else updateWorkingBar();
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

    function renderModelButton() {
      var models = state.models;
      var label = t('modelFallback');
      if (models && models.current) {
        var provider = models.current.provider;
        var modelId = models.current.model;
        var modelName = modelId;
        var groups = models.groups || [];
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].id !== provider) continue;
          var groupModels = groups[i].models || [];
          for (var j = 0; j < groupModels.length; j++) {
            if (groupModels[j].id === modelId) {
              modelName = groupModels[j].name || groupModels[j].id;
              break;
            }
          }
          break;
        }
        label = modelName || modelId || label;
        if (models.current.reasoningEffort) label += ' · ' + models.current.reasoningEffort;
      }
      modelBtn.textContent = '模';
      modelBtn.title = t('modelTitle', { label: label });
    }

    function renderModels() {
      var models = state.models;
      renderModelButton();
      modelSelectEl.innerHTML = '';
      effortSelectEl.innerHTML = '';
      customProviderSelect.innerHTML = '';
      modelStatusEl.textContent = '';
      if (!models) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = models === null ? '加载中…' : '暂无模型';
        modelSelectEl.appendChild(empty);
        var emptyEffort = document.createElement('option');
        emptyEffort.value = '';
        emptyEffort.textContent = '—';
        effortSelectEl.appendChild(emptyEffort);
        return;
      }
      var groups = models.groups || [];
      for (var i = 0; i < groups.length; i++) {
        (function (g) {
          var cp = document.createElement('option');
          cp.value = g.id;
          cp.textContent = g.name || g.id;
          if (models.current && models.current.provider === g.id) cp.selected = true;
          customProviderSelect.appendChild(cp);
        })(groups[i]);
      }
      if (!groups.length) {
        var customEmpty = document.createElement('option');
        customEmpty.value = '';
        customEmpty.textContent = '无可用 provider';
        customProviderSelect.appendChild(customEmpty);
      }
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
        empty2.textContent = '暂无模型';
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
      else if (models.routable === false) modelStatusEl.textContent = '当前路由不可用';
      else if (models.current) modelStatusEl.textContent = '';
      renderModelButton();
    }

    function formatTokens(n) {
      n = Number(n) || 0;
      if (n < 1000) return String(n);
      if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'K';
      return (n / 1000000).toFixed(n < 10000000 ? 1 : 0) + 'M';
    }

    function formatDuration(ms) {
      ms = Number(ms) || 0;
      var s = ms / 1000;
      if (s < 60) return (Math.round(s * 10) / 10) + 's';
      var whole = Math.round(s);
      return Math.floor(whole / 60) + 'm' + (whole % 60) + 's';
    }

    function contextUsageText(stats) {
      var pressure = stats && stats.contextPressure;
      if (!pressure || !pressure.contextWindow) return t('stats.ctxNone');
      var used = pressure.projectedTokens;
      if (used === undefined) used = pressure.pressureTokens;
      if (used === undefined && stats.contextBreakdown) {
        used = (Number(stats.contextBreakdown.systemTokens) || 0)
          + (Number(stats.contextBreakdown.toolsTokens) || 0)
          + (Number(stats.contextBreakdown.messageTokens) || 0);
      }
      if (used === undefined) return t('stats.ctxNone');
      var pct = Math.min(100, Math.round(Number(used) / Number(pressure.contextWindow) * 100));
      return t('stats.ctx', { pct: pct });
    }

    function renderStats(stats) {
      var usage = stats && stats.tokenUsage;
      var billedInput = 0;
      var output = 0;
      if (usage) {
        billedInput = (Number(usage.uncachedInputTokens) || 0)
          + (Number(usage.cacheReadTokens) || 0)
          + (Number(usage.cacheWriteTokens) || 0);
        output = Number(usage.outputTokens) || 0;
      }

      // 单一底部统计行：上下文占用 + 完整 LLM 调用信息。
      var parts = [contextUsageText(stats)];
      var sessionStats = stats && stats.sessionStats;
      if (sessionStats && sessionStats.steps > 0) {
        parts.push(t('stats.turns', { turns: sessionStats.turns || 0, steps: sessionStats.steps }));
      }
      if (sessionStats) {
        var timeParts = [];
        if (sessionStats.llmMs > 0) timeParts.push(t('stats.llm') + ' ' + formatDuration(sessionStats.llmMs));
        if (sessionStats.toolMs > 0) timeParts.push(t('stats.tool') + ' ' + formatDuration(sessionStats.toolMs));
        if (timeParts.length) parts.push(timeParts.join(' · '));
        var ttftParts = [];
        if (sessionStats.ttftSteps > 0) {
          ttftParts.push(t('stats.ttftAvg') + ' ' + formatDuration(sessionStats.ttftMs / sessionStats.ttftSteps));
        }
        if (sessionStats.decodeMs > 0) {
          ttftParts.push(t('stats.tokPerSec', { rate: Math.round(sessionStats.decodeTokens / (sessionStats.decodeMs / 1000)) }));
        }
        if (ttftParts.length) parts.push(ttftParts.join(' · '));
      }
      if (usage && billedInput > 0) {
        var cacheHit = Math.round((Number(usage.cacheReadTokens) || 0) / billedInput * 100);
        parts.push(t('stats.cacheHit', { pct: cacheHit }));
        parts.push(t('stats.inputOutput', { input: formatTokens(billedInput), output: formatTokens(output) }));
      }
      statsBarEl.textContent = parts.join(' | ');
      renderTodos();
      renderPermissions();
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

    function appendSettingsField(parent, label, statusText, valueId, saveHandler, clearHandler) {
      var field = document.createElement('div');
      field.className = 'settings-field';
      var labelEl = document.createElement('div');
      labelEl.className = 'field-label';
      var nameEl = document.createElement('span');
      nameEl.textContent = label;
      var statusEl = document.createElement('span');
      statusEl.className = 'field-status';
      statusEl.textContent = statusText;
      labelEl.appendChild(nameEl);
      labelEl.appendChild(statusEl);
      var input = document.createElement('input');
      input.type = 'password';
      input.placeholder = statusText === '已配置' ? '留空则不修改' : '输入新的值';
      input.id = valueId;
      var actions = document.createElement('div');
      actions.className = 'field-actions';
      var saveBtn = document.createElement('button');
      saveBtn.textContent = '保存';
      saveBtn.className = 'primary';
      saveBtn.addEventListener('click', function () { saveHandler(input.value); });
      var clearBtn = document.createElement('button');
      clearBtn.textContent = '清除';
      clearBtn.addEventListener('click', clearHandler);
      actions.appendChild(saveBtn);
      actions.appendChild(clearBtn);
      field.appendChild(labelEl);
      field.appendChild(input);
      field.appendChild(actions);
      parent.appendChild(field);
    }

    function renderSettingsData(data) {
      settingsContent.innerHTML = '';
      if (!data.writable) {
        var hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = t('settingsReadonly');
        settingsContent.appendChild(hint);
        return;
      }
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
      settingsContent.appendChild(displaySection);

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
      settingsContent.appendChild(fontSizeSection);

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
      settingsContent.appendChild(languageSection);

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
        composerInput.placeholder = next ? t('composerPlaceholder') : t('composerPlaceholderAlt');
        post({ type: 'setEnterToSend', value: next });
      });
      sendModeField.appendChild(sendModeSelect);
      sendModeSection.appendChild(sendModeField);
      settingsContent.appendChild(sendModeSection);

      var credSection = document.createElement('div');
      credSection.className = 'settings-section';
      var credTitle = document.createElement('h3');
      credTitle.textContent = t('apiKeys');
      credSection.appendChild(credTitle);
      var credentials = data.credentials || [];
      for (var i = 0; i < credentials.length; i++) {
        (function (cred) {
          appendSettingsField(credSection, cred.label, cred.configured ? '已配置' : '未配置', 'cred-' + cred.ref, function (value) {
            if (!value) return;
            post({ type: 'credentialSave', ref: cred.ref, value: value });
          }, function () {
            post({ type: 'credentialUnset', ref: cred.ref });
          });
        })(credentials[i]);
      }
      settingsContent.appendChild(credSection);

      var nsList = data.namespaces || [];
      for (var j = 0; j < nsList.length; j++) {
        (function (ns) {
          var section = document.createElement('div');
          section.className = 'settings-section';
          var title = document.createElement('h3');
          title.textContent = '设置命名空间：' + ns.ns;
          section.appendChild(title);
          var secrets = ns.secrets || [];
          for (var k = 0; k < secrets.length; k++) {
            (function (secret) {
              appendSettingsField(section, ns.ns + '.' + secret.path.join('.'), secret.set ? '已配置' : '未配置', 'secret-' + ns.ns + '-' + secret.path.join('-'), function (value) {
                if (!value) return;
                post({ type: 'secretSave', ns: ns.ns, path: secret.path, value: value, expectedRevision: ns.revision });
              }, function () {
                post({ type: 'secretSave', ns: ns.ns, path: secret.path, value: '', expectedRevision: ns.revision });
              });
            })(secrets[k]);
          }
          settingsContent.appendChild(section);
        })(nsList[j]);
      }
    }

    // Events
    sendBtn.addEventListener('click', sendMessage);
    stopBtn.addEventListener('click', function () { post({ type: 'cancel' }); });
    $('newSessionBtn').addEventListener('click', function () {
      post({ type: 'newSession' });
    });
    settingsBtn.addEventListener('click', openSettingsModal);
    settingsCloseBtn.addEventListener('click', closeSettingsModal);
    settingsDoneBtn.addEventListener('click', closeSettingsModal);
    settingsOpenDocBtn.addEventListener('click', function () { post({ type: 'settingsOpenDocument' }); });
    closeSessionBtn.addEventListener('click', function () {
      if (!state.selectedSessionId) return;
      openArchiveModal(state.selectedSessionId);
    });
    downloadSessionBtn.addEventListener('click', function () {
      if (!state.selectedSessionId) return;
      post({ type: 'downloadSession', sessionId: state.selectedSessionId });
    });
    archiveCloseBtn.addEventListener('click', closeArchiveModal);
    archiveCancelBtn.addEventListener('click', closeArchiveModal);
    archiveConfirmBtn.addEventListener('click', function () {
      var sessionId = pendingArchiveSessionId;
      closeArchiveModal();
      if (!sessionId) return;
      post({ type: 'closeSession', sessionId: sessionId });
    });
    deleteCloseBtn.addEventListener('click', closeDeleteModal);
    deleteCancelBtn.addEventListener('click', closeDeleteModal);
    deleteConfirmBtn.addEventListener('click', confirmDeleteConversationItem);
    renameSessionBtn.addEventListener('click', function () {
      if (!state.selectedSessionId) return;
      post({ type: 'renameSession', sessionId: state.selectedSessionId });
    });
    expandBtn.addEventListener('click', toggleExpand);
    modelBtn.addEventListener('click', function () {
      toggleModelPopover();
    });
    customModelApplyBtn.addEventListener('click', applyCustomModel);
    customModelInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyCustomModel();
      }
    });
    document.addEventListener('click', function (event) {
      if (event.target !== modelBtn && !modelPopover.contains(event.target)) closeModelPopover();
      if (event.target !== permissionBtn && !permissionPopover.contains(event.target)) closePermissionPopover();
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
    permissionBtn.addEventListener('click', function () {
      togglePermissionPopover();
    });
    $('refreshBtn').addEventListener('click', function () { post({ type: 'refreshSessions' }); });
    selectEl.addEventListener('change', function () {
      var id = selectEl.value;
      if (id) post({ type: 'selectSession', sessionId: id });
    });
    inputEl.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      var sendKey = state.enterToSend ? !event.shiftKey : event.shiftKey;
      if (sendKey) {
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

    window.addEventListener('message', function (event) {
      var msg = event.data;
      switch (msg.type) {
        case 'hydrate':
          state.status = msg.status;
          state.workspace = msg.workspace;
          state.sessions = msg.sessions || [];
          state.selectedSessionId = msg.selectedSessionId;
          state.conversation = msg.conversation || [];
          state.sessionDisplay = msg.sessionDisplay || 'concise';
          state.fontSize = Number(msg.fontSize) || 13;
          state.language = msg.language === 'en' ? 'en' : 'zh';
          state.enterToSend = msg.enterToSend !== false;
          applyFontSize();
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
          state.selectedSessionId = msg.selectedSessionId;
          renderSessions();
          renderConversation();
          if (state.selectedSessionId && state.selectedSessionId !== previousSessionId) {
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
          renderSettingsData(msg.data || { writable: false, credentials: [], namespaces: [] });
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
        case 'language':
          state.language = msg.value === 'en' ? 'en' : 'zh';
          applyLanguage();
          break;
        case 'enterToSend':
          state.enterToSend = msg.value !== false;
          composerInput.placeholder = state.enterToSend ? t('composerPlaceholder') : t('composerPlaceholderAlt');
          break;
        case 'conversation':
          if (msg.selectedSessionId !== undefined && msg.selectedSessionId !== null) {
            state.selectedSessionId = msg.selectedSessionId;
            renderSessions();
          }
          if (msg.sessionId === state.selectedSessionId) {
            state.conversation = msg.conversation || [];
            state.hasMoreEarlier = msg.hasMoreEarlier || false;
            state.loadingEarlier = false;
            setRunning(msg.running || false);
            renderConversation();
          }
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
      }
    });

    post({ type: 'ready' });
  })();
  </script>
</body>
</html>`
}

module.exports = { getWebviewHtml }
