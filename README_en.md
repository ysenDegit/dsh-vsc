# DeepSeek Harness Chat (dsh-vsc-weblike)

[中文](README.md)

Bring DeepSeek Harness (dsh) into VS Code with a Claude Code-style sidebar and workspace panel. The extension does not embed the dsh web frontend; instead it talks directly to the dsh backend over HTTP RPC and dual WebSocket event streams.

![Extension screenshot](assets/Screenshot.png)

---

## 1. Core Features

### 1.1 dsh Instance Lifecycle Management
- Auto-discovery of dsh: config path `dsh-vsc.dshPath` → `PATH` → npm global directory → `npx --no-install @deepseek-ai/dsh`.
- Before starting, checks whether a dsh web instance is already running:
  - explicit `dsh-vsc.dshUrl`
  - state file `~/.dsh/vscode-extension.json`
  - default address `http://127.0.0.1:3080`
- If not running, automatically starts `dsh web --port 0`.
- When VS Code closes, the extension automatically exits the dsh instance it started; when reusing an existing instance, it only disconnects.
- Status badge updates in real time: discovering / starting / ready / reconnecting / stopped / error.

### 1.2 Workspace and Session Management
- Automatically adds the current VS Code workspace directory to the dsh workspace.
  - If it already exists: matched by canonical path and reused directly.
  - If not: a confirmation dialog appears, and the workspace is created after user confirmation.
  - Re-maps automatically when VS Code workspace folders change.
- Session list, selection, creation, and renaming.
- Working mode selection in a new session: Standard / PTC / Minimal / Creative.
- Archive/close sessions:
  - Double confirmation before the operation.
  - Archived copies are saved to the current workspace `.dsh-vsc/archived-sessions/`.
- Improved session title fallback, no longer showing a bare `session-`.

### 1.3 Chat Interface and Conversation Display
- Two display modes: concise / detailed, concise by default.
  - Concise mode hides tool calls and thinking traces, keeping only user messages, the Assistant's final output, and command nodes.
  - In concise mode, the bottom stats row is a single line: a persistent `working` indicator on the left (dot color shows session status: gray = idle, green = thinking, red = tool call, blue = streaming output), LLM stats in the center (cache hit / input-output), and the current model and reasoning effort at the bottom right.
- Streaming Assistant output.
- Tool calls and tool results are paired by `callId`.
- `/` command execution results are shown as command nodes (`command/run` → `command/done`, including success/failure information).
- Context injection is collapsed by default, keeping only the latest entry.
- A "Load earlier" button appears when scrolling up, loading earlier history on demand.
- Markdown rendering:
  - Headings, paragraphs, bold, italic, strikethrough.
  - Inline code and fenced code blocks (with optional language class), plus light syntax highlighting for common languages (keywords / strings / comments / numbers).
  - Ordered/unordered lists (nestable).
  - Blockquotes, horizontal rules.
  - GFM tables (with alignment support).
  - Links, images.
  - A lightweight LaTeX subset: `$...$` inline math, `$$...$$` block math, fractions, square roots, super/subscripts, Greek letters, and common operators.
  - HTML is escaped before rendering for content safety.

### 1.4 Composer Input Area
- Configurable send behavior:
  - `Shift+Enter` to send, `Enter` for a newline (default).
  - Or the reverse: `Enter` to send, `Shift+Enter` for a newline.
- Input box expand/collapse: only the input box expands upward; nearby buttons stay in place.
- Stop button uses the `■` icon.
- `@` file references: typing `@` pops up a list of files in the current workspace, filtered in real time.
- `/` command menu: typing `/` pops up the dsh command list.
- `/` command execution: sending a full command line starting with `/` calls `commands/execute` directly — registered commands are executed by the host (they are not sent to the model as normal conversation; results appear as command nodes in the session); unregistered commands return empty (`undefined`) and are sent as normal messages, matching the web frontend behavior; if an older dsh version doesn't support the command RPC, it automatically falls back to a normal message.
- Send queue display: shows a "queued" list supporting edit, steer (interrupt), and delete.
- Model and reasoning effort are merged into one `模` button; custom model names are supported.
- Permission selector is compressed into a `权` button on the left of the input box.
- Context usage: shown as background fill in the input box proportional to usage; hovering the input box reveals the exact percentage. It can be disabled in settings, and the progress bar color is customizable (default matches the user message box).
- Bottom stats row (single line: `working` indicator on the left, cache hit and input/output in the center, current model and reasoning effort at the bottom right):
  - Chinese: `缓存命中 42% | 输入 12.3K tokens · 输出 2.1K tokens`
  - English: `cache hit 42% | input 12.3K tokens · output 2.1K tokens`
  - Model info at the bottom right: `Deepseek V4 Flash | Max` (model name | reasoning effort; only the model name when there is no reasoning effort).

### 1.5 Tool Approval / Todo Bar / Permissions / Questions / Command Nodes
- Tool approval: the input area switches to an approval panel, supporting `Allow once` / `Reject`.
- Todo bar: shows the plan list and status statistics.
- Permission: reads the dsh `permissions` projection; switching executes `/permission <preset>`.
- Command nodes: after a `/` command executes, the command line and its result (success/failure) are shown in the session, and are kept in concise mode as well.
- Questions and plan review:
  - Plan Review: supports Approve / Reject / Chat.
  - Ask User: supports single-choice and multi-choice; questions with options also provide a "custom answer" input (for single-choice, the custom answer takes priority over the options; for multi-choice, both can be submitted together). Questions without options accept free-form input.

### 1.6 Settings Panel
- How to open: click the `⚙` icon at the top.
- Session display mode: concise / detailed.
- Font size: 12–20 px.
- Max content width: unlimited / 800 / 1000 / 1200 / 1600 px (content is centered on large screens instead of filling the whole panel).
- Context usage display: on / off (background usage indicator in the input box).
- Context progress bar color: default (same as the user message box) / custom color.
- Context progress bar opacity: 0–100% (slider).
- UI language: 中文 / English.
- Send behavior: Enter to send / Shift+Enter to send.
- Open settings.yaml (opens `$DSH_HOME/settings.yaml` inside VS Code).
- Shows the current extension version.
- LLM-related settings (API Key, Base URL, etc.) are configured in the dsh Web UI.

### 1.7 Entry Points and Commands
- Sidebar whale icon entry.
- `dsh` button at the top right of the workspace: opens the dsh panel in the current editor column (overlaying the current workspace).
- Auto-open on VS Code startup:
  - The workspace dsh panel opens automatically only when a running dsh web instance is detected.
  - It does not auto-open when no instance is running.
- Commands:
  - `dsh: Open Chat`
  - `dsh: New Session`
  - `dsh: Refresh Sessions`
  - `dsh: Open Web UI in Browser`
  - `dsh: Open Chat Panel`

### 1.8 Download Session Context
- `⬇` button at the far right of the top bar.
- Exports the current session as Markdown or JSON.
- Markdown keeps only user messages and the Assistant's final replies.

---

## 2. Configuration

| Setting | Type | Default | Description |
|---|---|---|---|
| `dsh-vsc.dshPath` | string/null | null | Explicitly specify the dsh executable path |
| `dsh-vsc.minDshVersion` | string | `0.1.0-rc.6` | Minimum required dsh version |
| `dsh-vsc.autoStart` | boolean | true | Automatically check for/create a dsh instance when VS Code starts |
| `dsh-vsc.dshUrl` | string/null | null | Explicitly specify the URL of an already running dsh web instance |
| `dsh-vsc.sessionDisplay` | string | concise | Session display mode: concise / detailed |
| `dsh-vsc.fontSize` | number | 13 | Chat font size (px) |
| `dsh-vsc.maxWidth` | number | 1000 | Max chat content width (px); 0 = unlimited (fills the panel) |
| `dsh-vsc.showContextUsage` | boolean | true | Show context usage as background fill in the input box |
| `dsh-vsc.contextBarColor` | string | `var(--accent)` | Context progress bar color (CSS color value; default matches the user message box) |
| `dsh-vsc.contextBarOpacity` | number | 30 | Context progress bar fill opacity (%, 0–100) |
| `dsh-vsc.language` | string | zh | Extension UI language: zh / en |
| `dsh-vsc.autoOpenChat` | boolean | true | Auto-open the workspace panel on startup when dsh is already running |
| `dsh-vsc.enterToSend` | boolean | false | Enter key behavior: false (default) = Shift+Enter sends, Enter inserts a newline; true = Enter sends |

---

## 3. Requirements

- VS Code >= 1.90
- Node >= 22 (the extension host must provide a global `WebSocket`; on older hosts make sure the `ws` package can be loaded)
- `@deepseek-ai/dsh` installed, version >= 0.1.0-rc.6

---

## 4. Development and Packaging

No build step: the entry point directly uses `src/extension.js`.

```bash
# Run tests
node --test tests/*.test.js
```

Packaging takes two steps:

```bash
# 1. Install vsce (first time only)
npm install -g @vscode/vsce

# 2. Run vsce package
vsce package
```

---

## 5. Known Limitations

- Markdown rendering does not support full KaTeX yet; it currently provides a lightweight LaTeX subset, and syntax highlighting is a lightweight implementation that does not cover all languages.
- `@` file references exclude `node_modules` and `.git`, and enumerate at most 2000 files.
- Working mode selection is still embedded in the blank session page and has not been turned into a modal dialog.
- The `ws` dependency is not explicitly declared; older VS Code hosts without a global `WebSocket` need `ws` installed separately.
- Permission switching is protected by the dsh backend: it cannot be switched while a persistent terminal is being opened/created in the session; close the terminal first.

---

## License

MIT
