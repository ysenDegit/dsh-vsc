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
    #app { display: flex; flex-direction: column; height: 100%; width: 100%; min-width: 0; max-width: var(--chat-max-width, none); margin: 0 auto; }

    /* Status badge (top integrated bar) */
    .status-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); flex: 0 0 auto; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #6c7086; }
    .status-dot.ready { background: #a6e3a1; }
    .status-dot.starting, .status-dot.discovering { background: #f9e2af; }
    .status-dot.error { background: #f38ba8; }
    .status-dot.stopped { background: #6c7086; }
    .status-dot.reconnecting { background: #f9e2af; }
    .status-badge.retryable { cursor: pointer; border-bottom: 1px dotted var(--muted); }
    .status-badge.retryable:hover { color: var(--accent); }

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
      border-bottom: 1px solid var(--border); flex: 0 0 auto; min-width: 0;
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
    .mode-welcome-hint { color: var(--muted); font-size: 12px; margin-bottom: 10px; }
    .mode-welcome .preset-list { max-height: none; }

    /* Chat area */
    .chat { flex: 1 1 auto; min-width: 0; overflow-y: auto; overflow-x: hidden; padding: 12px 10px; }
    .empty { color: var(--muted); text-align: center; margin-top: 40px; line-height: 1.8; }
    .empty-actions { margin-top: 12px; text-align: center; }
    .empty-actions button { padding: 4px 14px; }
    .load-earlier-wrap { text-align: center; margin: 4px 0 8px; }
    .load-earlier-btn { font-size: 12px; padding: 4px 10px; }
    .msg { margin-bottom: 14px; max-width: 100%; }
    .msg .meta { font-size: 11px; color: var(--muted); margin-bottom: 3px; display: flex; gap: 6px; align-items: center; }
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
    .msg.command .bubble { border-left: 3px solid var(--accent); font-size: 12px; }
    .msg.command .command-line { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600; color: var(--accent); }
    .msg.command .command-outcome { margin-top: 4px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .msg.command .command-running { color: var(--muted); }
    .msg.command .command-success { color: var(--ok, #2e7d32); }
    .msg.command .command-error { color: var(--error); }
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
    .bubble table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
    .bubble td, .bubble th { border: 1px solid var(--border); padding: 3px 6px; }

    /* Composer */
    .composer { flex: 0 0 auto; min-width: 0; border-top: 1px solid var(--border); padding: 8px 10px; position: relative; }
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
    .work-indicator {
      position: absolute; left: 0; top: 50%; transform: translateY(-50%);
      display: inline-flex; align-items: center; gap: 5px;
      font-weight: 600; font-size: 11px; color: var(--fg);
    }
    .work-bulb { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: currentColor; color: var(--muted); }
    .work-indicator.thinking .work-bulb { color: #a6e3a1; }
    .work-indicator.tool .work-bulb { color: #f38ba8; }
    .work-indicator.output .work-bulb { color: #89b4fa; }
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
    .composer-row { display: flex; gap: 6px; align-items: flex-end; min-width: 0; }
    .composer-row button { flex: 0 0 auto; height: 36px; min-width: 36px; padding: 0 8px; }
    #stopBtn { font-size: 14px; padding: 0 10px; }
    .model-button { min-width: 36px; max-width: 36px; padding: 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .model-popover {
      position: absolute; right: 10px; bottom: calc(100% - 4px); width: 300px; max-width: calc(100% - 20px);
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
      flex: 1; min-width: 0; resize: none; min-height: 36px; max-height: 180px;
      background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--border); border-radius: 4px; padding: 8px 10px;
      font: inherit; line-height: 1.5;
    }
    #composerInput:focus { outline: 1px solid var(--accent); }
    body.composer-expanded #composerInput { max-height: none; height: 40vh; min-height: 220px; }
    /* hidden 属性必须优先于任何 display 规则（否则 display:flex 会盖掉它）。 */
    [hidden] { display: none !important; }
    .pending-images { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
    .pending-img { position: relative; }
    .pending-img img { height: 56px; border-radius: 4px; display: block; border: 1px solid var(--border); }
    .pending-img button {
      position: absolute; top: -7px; right: -7px; width: 16px; height: 16px; line-height: 14px;
      padding: 0; border-radius: 50%; background: var(--bg); border: 1px solid var(--border);
      color: var(--muted); cursor: pointer; font-size: 11px; text-align: center;
    }
    .composer-notice { color: #d9534f; font-size: 11px; margin: 2px 0 6px; }
    .msg-images { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
    .msg-image img { max-height: 180px; max-width: 100%; border-radius: 6px; display: block; }
    .img-placeholder {
      display: inline-block; padding: 8px 12px; border: 1px dashed var(--border);
      border-radius: 6px; color: var(--muted); font-size: 11px;
    }
    .hint { color: var(--muted); font-size: 11px; margin-top: 4px; }
    .stats-bar {
      position: relative; margin-top: 4px; font-size: 11px; color: var(--muted);
      text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .stats-bar .model-info {
      position: absolute; right: 0; top: 50%; transform: translateY(-50%);
      max-width: 45%; overflow: hidden; text-overflow: ellipsis;
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
    .settings-modal {
      width: min(600px, calc(100% - 24px));
      height: min(560px, calc(100vh - 48px));
      display: flex; flex-direction: column;
    }
    .settings-content { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .settings-body { display: flex; gap: 10px; flex: 1; min-height: 0; }
    .settings-nav { flex: 0 0 110px; display: flex; flex-direction: column; gap: 2px; }
    .settings-nav-item {
      text-align: left; padding: 6px 8px; border: none; background: transparent;
      color: var(--fg); border-radius: 4px; font: inherit; font-size: 12px; cursor: pointer;
    }
    .settings-nav-item:hover { background: var(--hover); }
    .settings-nav-item.active { background: var(--hover); color: var(--accent); font-weight: 600; }
    .settings-pane { display: none; flex-direction: column; gap: 10px; }
    .settings-pane.active { display: flex; }
    .settings-section { border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
    .settings-section h3 { margin: 0 0 6px; font-size: 12px; color: var(--muted); font-weight: 600; }
    .settings-subsection { margin: 8px 0 2px 10px; padding-left: 10px; border-left: 1px solid var(--border); }
    .settings-subsection-title { font-size: 12px; color: var(--muted); font-weight: 600; margin-bottom: 4px; }
    .settings-section a { color: var(--accent); cursor: pointer; word-break: break-all; }
    .settings-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .settings-title-row h3 { margin: 0; }
    .ws-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .ws-row:last-child { margin-bottom: 0; }
    .ws-info { flex: 1; min-width: 0; }
    .ws-path { font-size: 12px; word-break: break-all; }
    .ws-meta { font-size: 11px; color: var(--muted); }
    .ws-rename-input { width: 110px; }
    .ws-del-btn { color: #f38ba8; border-color: #f38ba8; }
    .ws-arch-label { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
    .settings-field { margin-bottom: 8px; }
    .settings-field:last-child { margin-bottom: 0; }
    .settings-field .field-label { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 4px; }
    .settings-field .field-status { font-size: 11px; color: var(--muted); }
    .settings-field input[type=password], .settings-field input[type=text], .settings-field select {
      width: 100%; background: var(--input-bg); color: var(--input-fg);
      border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px;
      font: inherit; font-size: 12px;
    }
    .settings-field input[type=color] {
      width: 100%; height: 32px; padding: 2px; background: var(--input-bg);
      border: 1px solid var(--border); border-radius: 4px;
    }
    .settings-field input[type=range] { width: 100%; accent-color: var(--accent); }
    .settings-field .field-actions { display: flex; gap: 6px; margin-top: 4px; justify-content: flex-end; }
    .archive-message { font-size: 12px; color: var(--muted); line-height: 1.6; word-break: break-all; }
  </style>
</head>
<body>
  <div id="app">
    <div class="sessions-wrap">
      <span class="status-badge"><span id="statusDot" class="status-dot stopped"></span><span id="statusText">stopped</span></span>
      <button id="settingsBtn" title="设置">⚙</button>
      <button id="refreshBtn" title="刷新会话">⟳</button>
      <button id="newSessionBtn" class="primary" title="新建会话">＋</button>
      <select id="sessionSelect" title="选择会话"></select>
      <button id="renameSessionBtn" title="重命名会话">✎</button>
      <button id="closeSessionBtn" title="归档/关闭会话">✕</button>
      <button id="downloadSessionBtn" title="下载当前会话上下文">⬇</button>
    </div>
    <div id="chat" class="chat">
      <div class="empty">正在连接 DeepSeek Harness…</div>
    </div>
    <div class="composer">
      <div id="pendingImages" class="pending-images" hidden></div>
      <div id="composerNotice" class="composer-notice" hidden></div>
      <div id="filePicker" class="file-picker"></div>
      <div id="commandPicker" class="file-picker command-picker"></div>
      <div id="todoDock" class="todo-dock"></div>
      <div id="queueDock" class="queue-dock"></div>
      <div id="questionPanel" class="question-panel" style="display:none"></div>
      <div id="approvalPanel" class="question-panel approval-panel" style="display:none"></div>
      <div id="composerRow" class="composer-row">
        <button id="permissionBtn" class="permission-button" title="选择权限">权</button>
        <button id="imageBtn" title="选择图片">📷</button>
        <textarea id="composerInput" rows="1" placeholder="Shift+Enter 发送 · Enter 换行 · @ 引用文件 · / 命令"></textarea>
        <input type="file" id="imageFileInput" accept="image/*" multiple hidden>
        <button id="expandBtn" title="展开/收起输入框">⤢</button>
        <button id="stopBtn" title="停止生成" style="display:none">■</button>
        <button id="sendBtn" class="primary" title="发送">发送</button>
        <button id="modelBtn" class="model-button" title="模型与推理强度">模</button>
      </div>
      <div id="modelPopover" class="model-popover">
        <div class="model-popover-row">
          <label id="modelLabel">模型</label>
          <select id="modelSelect" title="选择模型"></select>
        </div>
        <div class="model-popover-row">
          <label id="effortLabel">推理</label>
          <select id="effortSelect" title="选择推理等级"></select>
        </div>
        <span id="modelStatus" class="hint" style="margin-top:0"></span>
      </div>
      <div id="permissionPopover" class="permission-popover"></div>
      <div id="statsBar" class="stats-bar">
      <span id="workIndicator" class="work-indicator idle">
        <span class="work-bulb"></span>
        <span class="work-label">working</span>
      </span>
      <span id="statsText"></span>
      <span id="modelInfo" class="model-info"></span>
    </div>
    </div>
    <div id="settingsModal" class="modal-overlay">
      <div class="modal settings-modal">
        <div class="modal-header">
          <span>设置</span>
          <span class="spacer"></span>
          <button id="settingsClose" title="关闭">✕</button>
        </div>
        <div class="settings-body">
          <div id="settingsNav" class="settings-nav"></div>
          <div id="settingsContent" class="settings-content"></div>
        </div>
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
    var selectEl = $('sessionSelect');
    var inputEl = $('composerInput');
    var composerInput = inputEl;
    var newSessionBtn = $('newSessionBtn');
    var refreshBtn = $('refreshBtn');
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
    var statsTextEl = $('statsText');
    var workIndicatorEl = $('workIndicator');
    var modelInfoEl = $('modelInfo');
    var queueDockEl = $('queueDock');
    var todoDockEl = $('todoDock');
    var questionPanelEl = $('questionPanel');
    var approvalPanelEl = $('approvalPanel');
    var composerRowEl = $('composerRow');
    var permissionBtn = $('permissionBtn');
    var imageBtn = $('imageBtn');
    var imageFileInput = $('imageFileInput');
    var permissionPopover = $('permissionPopover');
    var modelBtn = $('modelBtn');
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

    var I18N = {
      zh: {
        'status.discovering': '发现中',
        'status.starting': '启动中',
        'status.ready': '就绪',
        'status.reconnecting': '重连中',
        'status.stopped': '已停止',
        'status.error': '错误',
        'statusRetry': '点击重新检测 dsh web 实例',
        'newSessionTitle': '新建会话',
        'refreshTitle': '刷新会话',
        'renameSession': '重命名会话',
        'closeSession': '归档/关闭会话',
        'settings': '设置',
        'expand': '展开/收起输入框',
        'stop': '停止生成',
        'send': '发送',
        'composerPlaceholder': 'Enter 发送 · Shift+Enter 换行 · @ 引用文件 · / 命令',
        'composerPlaceholderAlt': 'Shift+Enter 发送 · Enter 换行 · @ 引用文件 · / 命令',
        'imageAttachment': '图片',
        'imageRemove': '移除图片',
        'imageReadFailed': '图片读取失败',
        'imageLoading': '图片加载中…',
        'imageLoadFailed': '图片加载失败',
        'imageCommandRefuse': '该命令不接受图片附件，请移除图片后重试',
        'imagePick': '选择图片',
        'imagePicked': '已添加 {count} 张图片',
        'emptyReady': '新会话已就绪。输入消息开始与 DeepSeek Harness 对话。',
        'emptyNoWorkspace': '没有打开的工作区，无法开始会话。',
        'addWorkspaceBtn': '将当前文件夹添加到DSH工作区',
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
        'questionCustom': '输入你的回答',
        'questionCustomOptional': '输入自定义回答（可选）',
        'meta.assistant': 'DeepSeek',
        'meta.tool': '工具',
        'meta.note': '提示',
        'meta.context': '上下文',
        'meta.command': '命令',
        'generating': '生成中…',
        'contextInjection': '上下文注入',
        'commandRunning': '执行中…',
        'commandDone': '已执行',
        'commandFailed': '执行失败',
        'permissionTitle': '选择权限（当前：{label}）',
        'permissionRunning': '会话运行中无法切换权限',
        'modelTitle': '模型与推理强度（当前：{label}）',
        'modelFallback': '模型 · 推理',
        'modelLabel': '模型',
        'effortLabel': '推理',
        'archiveTitle': '归档/关闭会话',
        'archiveMessage': '将归档会话「{title}」。归档后会从会话列表移除，但会话记录副本会保存到当前工作目录的 .dsh-vsc/archived-sessions/ 下。',
        'confirmArchive': '确认归档',
        'cancel': '取消',
        'settingsOpenDoc': '打开 settings.yaml',
        'settingsDone': '完成',
        'settingsReadonly': '当前 settings provider 为只读，无法修改配置。',
        'pluginVersion': '插件版本',
        'dshServiceUrlSection': 'dsh 服务地址',
        'dshServiceUrlNone': '未连接',
        'dshWebOpenTitle': '在浏览器中打开 dsh Web UI',
        'sessionDisplaySection': '会话显示',
        'sessionDisplayLabel': '会话显示模式',
        'concise': '简洁会话',
        'detailed': '详细会话',
        'fontSizeSection': '字体大小',
        'fontSizeLabel': '聊天界面字体大小',
        'maxWidthSection': '内容宽度',
        'maxWidthLabel': '聊天内容最大宽度',
        'unlimited': '不限制（占满）',
        'contextUsageSection': '上下文占用',
        'contextUsageLabel': '在输入框中显示上下文占用',
        'contextColorSection': '进度条颜色',
        'contextColorDefault': '使用默认颜色（与用户消息框相同）',
        'contextOpacitySection': '进度条透明度',
        'contextOpacityLabel': '填充不透明度',
        'tabDisplay': '显示',
        'tabGeneral': '通用',
        'tabWorkspace': '工作区',
        'tabAbout': '关于',
        'workspaceCurrentSection': '当前工作区',
        'workspacePathLabel': '目录',
        'workspaceIdLabel': '工作区 ID',
        'workspaceSessionsLabel': '会话数：',
        'workspaceActiveSuffix': '（工作中）',
        'workspaceCountSeparator': '+',
        'workspaceArchivedSuffix': '（已归档）',
        'workspaceNone': '未添加工作区',
        'showArchivedSessionsLabel': '显示已归档会话',
        'workspaceAllSection': '所有 dsh 工作区',
        'workspaceRenameBtn': '重命名',
        'workspaceDeleteBtn': '删除',
        'workspaceRefreshBtn': '刷新',
        'languageSection': '界面语言',
        'languageLabel': '插件界面语言',
        'languageZh': '中文',
        'languageEn': 'English',
        'languageSwitchTitle': '点击切换到 {target}',
        'sendModeSection': '发送方式',
        'sendModeLabel': '输入框按键行为',
        'sendModeEnter': 'Enter 发送，Shift+Enter 换行',
        'sendModeShiftEnter': 'Shift+Enter 发送，Enter 换行',
        'startupSection': '启动行为',
        'autoStartLabel': '启动 VS Code 时自动启动 dsh web',
        'autoOpenChatLabel': '启动时自动打开面板',
        'settingsWebNotice': 'LLM模型相关设置请移步web端',
        'loadEarlier': '加载更早',
        'loadingEarlier': '加载中…',
        'stats.ctxNone': '上下文:—',
        'stats.ctx': '上下文:{pct}%',
        'stats.cacheHit': '缓存命中 {pct}%',
        'stats.inputOutput': '输入 {input} tokens · 输出 {output} tokens',
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
        'statusRetry': 'Click to re-detect the dsh web instance',
        'newSessionTitle': 'New Session',
        'refreshTitle': 'Refresh Sessions',
        'renameSession': 'Rename Session',
        'closeSession': 'Archive/Close Session',
        'settings': 'Settings',
        'expand': 'Expand/Collapse Input',
        'stop': 'Stop Generation',
        'send': 'Send',
        'composerPlaceholder': 'Enter to send · Shift+Enter for newline · @ files · / commands',
        'composerPlaceholderAlt': 'Shift+Enter to send · Enter for newline · @ files · / commands',
        'imageAttachment': 'Image',
        'imageRemove': 'Remove image',
        'imageReadFailed': 'Failed to read image',
        'imageLoading': 'Loading image…',
        'imageLoadFailed': 'Failed to load image',
        'imageCommandRefuse': 'This command does not accept image attachments; remove the images and retry',
        'imagePick': 'Pick image',
        'imagePicked': 'Added {count} image(s)',
        'emptyReady': 'New session ready. Type a message to start chatting with DeepSeek Harness.',
        'emptyNoWorkspace': 'No workspace is open; the session cannot start.',
        'addWorkspaceBtn': 'Add the current folder to the DSH workspace',
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
        'questionCustom': 'Type your answer',
        'questionCustomOptional': 'Custom answer (optional)',
        'meta.assistant': 'DeepSeek',
        'meta.tool': 'Tool',
        'meta.note': 'Note',
        'meta.context': 'Context',
        'meta.command': 'Command',
        'generating': 'Generating…',
        'contextInjection': 'Context Injection',
        'commandRunning': 'Running…',
        'commandDone': 'Done',
        'commandFailed': 'Failed',
        'permissionTitle': 'Select permission (current: {label})',
        'permissionRunning': 'Cannot switch permission while session is running',
        'modelTitle': 'Model & Reasoning (current: {label})',
        'modelFallback': 'Model · Reasoning',
        'modelLabel': 'Model',
        'effortLabel': 'Reasoning',
        'archiveTitle': 'Archive/Close Session',
        'archiveMessage': 'Archive session "{title}"? It will be removed from the list and a copy will be saved to .dsh-vsc/archived-sessions/ in the current workspace.',
        'confirmArchive': 'Archive',
        'cancel': 'Cancel',
        'settingsOpenDoc': 'Open settings.yaml',
        'settingsDone': 'Done',
        'settingsReadonly': 'The current settings provider is read-only and cannot be modified.',
        'pluginVersion': 'Plugin Version',
        'dshServiceUrlSection': 'dsh Service URL',
        'dshServiceUrlNone': 'Not connected',
        'dshWebOpenTitle': 'Open the dsh Web UI in the browser',
        'sessionDisplaySection': 'Session Display',
        'sessionDisplayLabel': 'Session display mode',
        'concise': 'Concise',
        'detailed': 'Detailed',
        'fontSizeSection': 'Font Size',
        'fontSizeLabel': 'Chat font size',
        'maxWidthSection': 'Content Width',
        'maxWidthLabel': 'Max chat content width',
        'unlimited': 'Unlimited (full width)',
        'contextUsageSection': 'Context Usage',
        'contextUsageLabel': 'Show context usage in the input box',
        'contextColorSection': 'Bar Color',
        'contextColorDefault': 'Use default color (same as user message)',
        'contextOpacitySection': 'Bar Opacity',
        'contextOpacityLabel': 'Fill opacity',
        'tabDisplay': 'Display',
        'tabGeneral': 'General',
        'tabWorkspace': 'Workspace',
        'tabAbout': 'About',
        'workspaceCurrentSection': 'Current Workspace',
        'workspacePathLabel': 'Folder',
        'workspaceIdLabel': 'Workspace ID',
        'workspaceSessionsLabel': 'Sessions: ',
        'workspaceActiveSuffix': ' (active)',
        'workspaceCountSeparator': ' + ',
        'workspaceArchivedSuffix': ' (archived)',
        'workspaceNone': 'No workspace added',
        'showArchivedSessionsLabel': 'Show archived sessions',
        'workspaceAllSection': 'All dsh Workspaces',
        'workspaceRenameBtn': 'Rename',
        'workspaceDeleteBtn': 'Delete',
        'workspaceRefreshBtn': 'Refresh',
        'languageSection': 'Language',
        'languageLabel': 'Plugin UI language',
        'languageZh': '中文',
        'languageEn': 'English',
        'languageSwitchTitle': 'Click to switch to {target}',
        'sendModeSection': 'Send Mode',
        'sendModeLabel': 'Input key behavior',
        'sendModeEnter': 'Enter to send, Shift+Enter for newline',
        'sendModeShiftEnter': 'Shift+Enter to send, Enter for newline',
        'startupSection': 'Startup',
        'autoStartLabel': 'Auto-start dsh web when VS Code starts',
        'autoOpenChatLabel': 'Auto-open the panel on startup',
        'settingsWebNotice': 'LLM model settings: please use the web UI.',
        'loadEarlier': 'Load earlier',
        'loadingEarlier': 'Loading…',
        'stats.ctxNone': 'ctx:—',
        'stats.ctx': 'ctx:{pct}%',
        'stats.cacheHit': 'cache hit {pct}%',
        'stats.inputOutput': 'input {input} tokens · output {output} tokens',
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
      newSessionBtn.title = t('newSessionTitle');
      refreshBtn.title = t('refreshTitle');
      renameSessionBtn.title = t('renameSession');
      closeSessionBtn.title = t('closeSession');
      settingsBtn.title = t('settings');
      expandBtn.title = t('expand');
      stopBtn.title = t('stop');
      sendBtn.title = t('send');
      renderSendLabel();
      composerInput.placeholder = state.enterToSend ? t('composerPlaceholder') : t('composerPlaceholderAlt');
      settingsOpenDocBtn.textContent = t('settingsOpenDoc');
      settingsDoneBtn.textContent = t('settingsDone');
      archiveCancelBtn.textContent = t('cancel');
      archiveConfirmBtn.textContent = t('confirmArchive');
      document.querySelector('#settingsModal .modal-header span').textContent = t('settings');
      document.querySelector('#archiveModal .modal-header span').textContent = t('archiveTitle');
      permissionBtn.textContent = '权';
      modelBtn.textContent = '模';
      $('modelLabel').textContent = t('modelLabel');
      $('effortLabel').textContent = t('effortLabel');
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

    function itemSignature(item) {
      return item.type + '|' + (item.id || '') + '|' + (item.text || '') + '|' + (item.reasoning || '')
        + '|' + (item.status || '') + '|' + (item.resultText || '') + '|' + (item.arguments || '')
        + '|' + (item.summary || '') + '|' + (item.partial ? 1 : 0)
        + '|' + ((item.outcome && item.outcome.kind) || '') + '|' + ((item.outcome && item.outcome.text) || '');
    }

    function scheduleConversationRender() {
      if (conversationTimer) return;
      conversationTimer = setTimeout(function () {
        conversationTimer = 0;
        renderConversation();
      }, 16);
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
      var wasNearBottom = (chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight) < 40;

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
      var displayItems = state.sessionDisplay === 'concise'
        ? items.filter(function (item) {
            if (item.type === 'user') return typeof item.text === 'string' && item.text.trim().length > 0;
            if (item.type === 'assistant') return typeof item.text === 'string' && item.text.trim().length > 0;
            if (item.type === 'command') return true; // 命令执行是用户操作反馈，简洁模式也保留
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

      var seen = new Set();
      for (var i = 0; i < displayItems.length; i++) {
        var item = displayItems[i];
        var key = item.id || (item.type + '-' + i);
        seen.add(key);
        var rec = itemNodes.get(key);
        if (!rec) {
          rec = { node: renderItem(item), signature: '' };
          itemNodes.set(key, rec);
        }
        var sig = itemSignature(item);
        if (rec.signature !== sig) {
          var fresh = renderItem(item);
          rec.node.replaceWith(fresh);
          rec.node = fresh;
          rec.signature = sig;
        }
        chatEl.appendChild(rec.node);
      }
      for (var entry of itemNodes) {
        if (!seen.has(entry[0])) {
          entry[1].node.remove();
          itemNodes.delete(entry[0]);
        }
      }

      if (wasNearBottom) {
        chatEl.scrollTop = chatEl.scrollHeight;
      }
      // 未在底部时保持原滚动位置（节点复用不会重置滚动）。
    }

    function renderItem(item) {
      var wrap = document.createElement('div');
      wrap.className = 'msg ' + item.type;
      if (item.type !== 'user') {
        var meta = document.createElement('div');
        meta.className = 'meta';
        var label = item.type === 'assistant' ? t('meta.assistant') : item.type === 'tool' ? t('meta.tool') : item.type === 'note' ? t('meta.note') : item.type === 'command' ? t('meta.command') : t('meta.context');
        meta.innerHTML = '<span>' + label + '</span>' + (item.partial ? '<span class="status-badge">' + t('generating') + '</span>' : '');
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
      } else if (item.type === 'command') {
        var cmdLine = '/' + (item.name || '?') + (item.args || '');
        var cmdHtml = '<div class="command-line">' + escapeHtml(cmdLine) + '</div>';
        if (item.outcome) {
          var outcomeClass = item.outcome.kind === 'error' ? 'command-error' : 'command-success';
          var outcomeText = item.outcome.text || (item.outcome.kind === 'error' ? t('commandFailed') : t('commandDone'));
          cmdHtml += '<div class="command-outcome ' + outcomeClass + '">' + escapeHtml(outcomeText) + '</div>';
        } else {
          cmdHtml += '<div class="command-outcome command-running">' + escapeHtml(t('commandRunning')) + '</div>';
        }
        bubble.innerHTML = cmdHtml;
      } else if (item.type === 'context') {
        var ctxSummary = item.summary || (item.text || '').split('\\n').find(function (line) { return line.trim().length > 0; }) || t('contextInjection');
        bubble.innerHTML = '<details class="context-details"><summary>' + escapeHtml(ctxSummary) + '</summary><pre>'
          + escapeHtml(item.text || '') + '</pre></details>';
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
        opt.textContent = (s.archived ? '🗄 ' : '') + (s.running ? '● ' : '') + sessionDisplayTitle(s);
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
      if (!text && pendingImages.length === 0) return;
      if (state.status !== 'ready') return;
      if (pendingImages.length > 0 && text.charAt(0) === '/') {
        var token = text.split(/\s+/)[0];
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
      post({ type: 'send', text: text, images: pendingImages.slice(), clientTimeZone: clientTimeZoneName() });
      inputEl.value = '';
      inputEl.style.height = 'auto';
      pendingImages = [];
      renderPendingImages();
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
      sendBtn.textContent = pendingImages.length > 0
        ? t('send') + ' 🖼' + pendingImages.length
        : t('send');
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
      var show = state.sessionDisplay === 'concise';
      workIndicatorEl.style.display = show ? 'inline-flex' : 'none';
      if (!show) return;
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
      if (!q.multiSelect) {
        // 单选：选择选项后清掉该题已输入的自定义回答（与 web 端互斥语义一致）。
        state.questionCustom[q.id] = '';
      }
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
          if (selected.length === 0 && !custom) {
            var err2 = document.createElement('div');
            err2.className = 'q-error';
            err2.textContent = '请选择选项或输入自定义回答：' + q.question;
            questionPanelEl.insertBefore(err2, questionPanelEl.querySelector('.q-actions'));
            return;
          }
          var answer2 = { id: q.id };
          if (!q.multiSelect && custom) {
            // 单选 + 自定义回答：以自定义内容为准（与 web 端一致）。
            answer2.selected = [];
          } else {
            answer2.selected = selected;
          }
          if (custom) answer2.custom = custom;
          answers.push(answer2);
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
        // 与 web 端一致：有选项的问题也允许用户自行输入回答；
        // 单选时自定义回答优先于所选选项，多选时两者共存。
        var customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.className = 'q-custom-input';
        customInput.placeholder = t('questionCustomOptional');
        customInput.value = state.questionCustom[q.id] || '';
        customInput.addEventListener('input', function () {
          state.questionCustom[q.id] = customInput.value;
          if (!q.multiSelect && customInput.value.trim() !== '') {
            state.questionSelections[q.id] = [];
            var optionBtns = block.querySelectorAll('.q-option');
            for (var bi = 0; bi < optionBtns.length; bi++) optionBtns[bi].classList.remove('selected');
          }
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
      if (hasQuestion || hasApproval) workIndicatorEl.style.display = 'none';
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
      if (!models || !models.current) {
        modelInfoEl.textContent = '';
        modelInfoEl.title = '';
        return;
      }
      var groups = models.groups || [];
      var name = modelDisplayName(models.current, groups);
      var effort = effortDisplayName(models.current, groups);
      modelInfoEl.textContent = effort ? name + ' | ' + effort : name;
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
      modelBtn.textContent = '模';
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
      statsTextEl.textContent = parts.join(' | ');
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
        dshLink.href = data.baseUrl;
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

      if (!data.writable) {
        var hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = t('settingsReadonly');
        aboutPane.appendChild(hint);
        activateSettingsTab('about');
        return;
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
        composerInput.placeholder = next ? t('composerPlaceholder') : t('composerPlaceholderAlt');
        post({ type: 'setEnterToSend', value: next });
      });
      sendModeField.appendChild(sendModeSelect);
      sendModeSection.appendChild(sendModeField);
      generalPane.appendChild(sendModeSection);

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
      startupSection.appendChild(autoStartField);
      autoStartCheck.addEventListener('change', function () {
        post({ type: 'setAutoStart', value: autoStartCheck.checked });
      });

      var autoOpenField = document.createElement('div');
      autoOpenField.className = 'settings-field';
      var autoOpenLabel = document.createElement('label');
      autoOpenLabel.className = 'field-label';
      var autoOpenCheck = document.createElement('input');
      autoOpenCheck.type = 'checkbox';
      autoOpenCheck.checked = data.autoOpenChat !== false;
      var autoOpenName = document.createElement('span');
      autoOpenName.textContent = t('autoOpenChatLabel');
      autoOpenLabel.appendChild(autoOpenCheck);
      autoOpenLabel.appendChild(autoOpenName);
      autoOpenField.appendChild(autoOpenLabel);
      startupSection.appendChild(autoOpenField);
      autoOpenCheck.addEventListener('change', function () {
        post({ type: 'setAutoOpenChat', value: autoOpenCheck.checked });
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

      var webNoticeSection = document.createElement('div');
      webNoticeSection.className = 'settings-section';
      var webNotice = document.createElement('div');
      webNotice.className = 'hint';
      webNotice.textContent = t('settingsWebNotice');
      webNoticeSection.appendChild(webNotice);
      aboutPane.appendChild(webNoticeSection);
      activateSettingsTab(settingsActiveTab);
    }

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
    renameSessionBtn.addEventListener('click', function () {
      if (!state.selectedSessionId) return;
      post({ type: 'renameSession', sessionId: state.selectedSessionId });
    });
    expandBtn.addEventListener('click', toggleExpand);
    modelBtn.addEventListener('click', function () {
      toggleModelPopover();
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

    window.addEventListener('message', function (event) {
      var msg = event.data;
      switch (msg.type) {
        case 'hydrate':
          state.status = msg.status;
          state.workspace = msg.workspace;
          state.sessions = msg.sessions || [];
          if (msg.selectedSessionId) state.selectedSessionId = msg.selectedSessionId;
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
          if (msg.selectedSessionId) state.selectedSessionId = msg.selectedSessionId;
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
          if (msg.selectedSessionId !== undefined && msg.selectedSessionId !== null) {
            state.selectedSessionId = msg.selectedSessionId;
            renderSessions();
          }
          if (msg.sessionId === state.selectedSessionId) {
            var wasRunning = state.running;
            state.conversation = msg.conversation || [];
            state.hasMoreEarlier = msg.hasMoreEarlier || false;
            state.loadingEarlier = false;
            setRunning(msg.running || false);
            // 流式 chunk 合并渲染（~16ms 一帧）；回合结束时立即刷新。
            if (wasRunning && !state.running) flushConversationRender();
            else scheduleConversationRender();
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
      }
    });

    post({ type: 'ready' });
  })();
  </script>
</body>
</html>`
}

module.exports = { getWebviewHtml }
