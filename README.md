# DeepSeek Harness Chat (dsh-vsc-weblike)

将 DeepSeek Harness（dsh）的能力接入 VS Code，提供 Claude Code 风格的侧边栏与工作区面板界面。插件不内嵌 dsh Web 前端，而是通过 HTTP RPC 与双 WebSocket 事件流直接与 dsh 后端通信。

---

## 一、核心功能

### 1. dsh 实例生命周期管理
- 自动发现 dsh：配置路径 `dsh-vsc.dshPath` → `PATH` → npm 全局目录 → `npx --no-install @deepseek-ai/dsh`。
- 启动前检查是否已有 dsh web 在后台运行：
  - 显式 `dsh-vsc.dshUrl`
  - 状态文件 `~/.dsh/vscode-extension.json`
  - 默认地址 `http://127.0.0.1:3080`
- 若未运行，则自动启动 `dsh web --port 0`。
- VS Code 关闭时，自动退出由插件启动的 dsh 实例；复用已有实例时仅断开连接。
- 状态徽标实时显示：发现中 / 启动中 / 就绪 / 重连中 / 停止 / 错误。

### 2. 工作区与会话管理
- 自动将当前 VS Code 工作目录加入 dsh 工作区。
  - 已存在：按 canonical path 匹配后直接使用。
  - 不存在：弹出确认框，经用户确认后创建。
  - VS Code 工作区文件夹变化时自动重新映射。
- 会话列表、选择、新建、重命名。
- 新会话内选择工作模式：标准 / PTC / 极简 / 创造。
- 归档/关闭会话：
  - 操作前二次确认。
  - 归档副本保存到当前工作目录 `.dsh-vsc/archived-sessions/`。
- 会话标题 fallback 优化，不再显示裸 `session-`。

### 3. 聊天界面与会话内容显示
- 简洁会话 / 详细会话两种模式，默认简洁。
  - 简洁模式隐藏工具调用与思考流程，只保留用户、Assistant 最终输出与命令节点。
  - 简洁模式下底部统计行为同一行：左侧常驻 `working` 标识（圆点颜色表示会话状态：灰 = 空闲、绿 = 思考中、红 = 工具调用中、蓝 = 输出中）、居中 LLM 统计信息（缓存命中 / 输入输出）、右下角当前模型与推理强度。
- 流式 Assistant 输出。
- 工具调用与工具结果按 `callId` 配对。
- `/` 命令执行结果以命令节点展示（`command/run` → `command/done`，含成功/失败信息）。
- 上下文注入默认折叠，只保留最新一条。
- 向上翻页时提供“加载更早”按钮，按需加载更早历史。
- Markdown 渲染：
  - 标题、段落、粗体、斜体、删除线。
  - 行内代码与围栏代码块（可带语言 class），并对常见语言提供轻量语法高亮（关键字/字符串/注释/数字）。
  - 有序/无序列表（可嵌套）。
  - 引用块、分割线。
  - GFM 表格（支持对齐）。
  - 链接、图片。
  - 轻量 LaTeX 公式子集：`$...$` 行内公式、`$$...$$` 块级公式、分式、根号、上下标、希腊字母、常见运算符。
  - HTML 先转义再渲染，保证内容安全。

### 4. Composer 输入区
- 发送方式可配置：
  - `Shift+Enter` 发送，`Enter` 换行（默认）。
  - 或反过来：`Enter` 发送，`Shift+Enter` 换行。
- 输入框展开/收起：只有输入框向上展开，附近按钮位置不变。
- 停止按钮使用 `■` 图标。
- `@` 文件引用：输入 `@` 弹出当前工作区文件列表，实时过滤。
- `/` 命令菜单：输入 `/` 弹出 dsh 命令列表。
- `/` 命令执行：发送以 `/` 开头的完整命令行时直接调用 `commands/execute`——已注册命令被 host 执行（不会作为普通对话发给模型，结果以命令节点显示在会话中）；未注册命令返回空（`undefined`），与 web 端一致按普通消息发送；旧版 dsh 不支持命令 RPC 时自动回退普通消息。
- 发送队列显示：显示“排队中”队列，支持编辑、插话（steer）、删除。
- 模型与推理强度合并为一个 `模` 按钮，支持自定义模型名称。
- 权限选择压缩为输入框左侧 `权` 按钮。
- 上下文占用：以输入框背景按占用比例填充显示，悬停输入框可见具体百分比；可在设置中关闭，并可自定义进度条颜色（默认与用户消息框同色）。
- 底部统计行（同一行，左起 working 指示器、居中缓存命中与输入输出、右下角当前模型与推理强度）：
  - 中文：`缓存命中 42% | 输入 12.3K tokens · 输出 2.1K tokens`
  - 英文：`cache hit 42% | input 12.3K tokens · output 2.1K tokens`
  - 右下角模型信息：`Deepseek V4 Flash | Max`（模型名 | 推理强度，无推理强度时只显示模型名）。

### 5. 工具审批 / 计划条 / 权限 / 问题 / 命令节点
- 工具审批（Approval）：输入框区域切换为审批面板，支持 `允许一次` / `拒绝`。
- 计划条（Todo）：展示计划列表与状态统计。
- 权限选择（Permission）：读取 dsh `permissions` 投影，切换时执行 `/permission <preset>`。
- 命令节点：`/` 命令执行后，会话中显示命令行与执行结果（成功/失败），简洁模式同样保留。
- 问题与计划评审：
  - Plan Review：支持批准 / 拒绝 / 聊一聊。
  - Ask User：支持单选、多选；带选项的问题同时提供"自定义回答"输入框（单选时自定义回答优先于选项，多选时两者可同时提交），无选项的问题直接自由输入。

### 6. 设置面板
- 打开方式：点击顶部 `⚙`。
- 会话显示模式：简洁 / 详细。
- 字体大小：12–20 px。
- 内容最大宽度：不限制 / 800 / 1000 / 1200 / 1600 px（大屏时内容居中，不占满工作区）。
- 上下文占用显示：开 / 关（输入框背景占用指示）。
- 上下文进度条颜色：默认（与用户消息框相同）/ 自定义颜色。
- 上下文进度条透明度：0–100%（滑杆调节）。
- 界面语言：中文 / English。
- 发送方式：Enter 发送 / Shift+Enter 发送。
- 打开 settings.yaml（在 VS Code 内打开 `$DSH_HOME/settings.yaml`）。
- 显示当前插件版本号。
- LLM 相关设置（API Key、Base URL 等）请移步 dsh Web UI 配置。

### 7. 入口与命令
- 侧边栏鲸鱼图标入口。
- 工作区右上角 `dsh` 按钮入口：在当前编辑器列直接打开 dsh 面板（覆盖当前工作区）。
- VS Code 启动自动打开：
  - 仅当检测到 dsh web 已在运行时，才自动打开工作区 dsh 面板。
  - 未运行时不自动打开。
- 命令：
  - `dsh: Open Chat`
  - `dsh: New Session`
  - `dsh: Refresh Sessions`
  - `dsh: Open Web UI in Browser`
  - `dsh: Open Chat Panel`

### 8. 下载会话上下文
- 顶栏最右侧 `⬇` 按钮。
- 将当前会话导出为 Markdown 或 JSON。
- Markdown 仅保留用户消息与 Assistant 最终回复。

---

## 二、配置项

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `dsh-vsc.dshPath` | string/null | null | 显式指定 dsh 可执行文件路径 |
| `dsh-vsc.minDshVersion` | string | `0.1.0-rc.6` | 最低 dsh 版本要求 |
| `dsh-vsc.autoStart` | boolean | true | 启动 VS Code 时自动检查/生成 dsh 实例 |
| `dsh-vsc.dshUrl` | string/null | null | 显式指定已运行的 dsh web 地址 |
| `dsh-vsc.sessionDisplay` | string | concise | 会话显示模式：concise / detailed |
| `dsh-vsc.fontSize` | number | 13 | 聊天界面字体大小（px） |
| `dsh-vsc.maxWidth` | number | 1000 | 聊天内容最大宽度（px），0 = 不限制（占满面板） |
| `dsh-vsc.showContextUsage` | boolean | true | 是否在输入框中以背景填充显示上下文占用信息 |
| `dsh-vsc.contextBarColor` | string | `var(--accent)` | 上下文进度条颜色（CSS 颜色值，默认与用户消息框同色） |
| `dsh-vsc.contextBarOpacity` | number | 30 | 上下文进度条填充不透明度（%，0–100） |
| `dsh-vsc.language` | string | zh | 插件界面语言：zh / en |
| `dsh-vsc.autoOpenChat` | boolean | true | 检测到 dsh 已运行时，启动后自动打开工作区面板 |
| `dsh-vsc.enterToSend` | boolean | false | Enter 键行为：false（默认）= Shift+Enter 发送、Enter 换行；true = Enter 发送 |

---

## 三、运行环境

- VS Code >= 1.90
- Node >= 22（扩展宿主需提供全局 `WebSocket`；旧版宿主请确保可加载 `ws` 包）
- 已安装 `@deepseek-ai/dsh` 且版本 >= 0.1.0-rc.6

---

## 四、开发与打包

无需构建：入口直接使用 `src/extension.js`。

```bash
# 运行测试
node --test tests/*.test.js
```

打包分两步：

```bash
# 1. 安装 vsce（仅首次需要）
npm install -g @vscode/vsce

# 2. 运行 vsce 打包
vsce package
```

---

## 五、已知限制

- Markdown 渲染暂不支持完整 KaTeX 公式；当前为轻量 LaTeX 子集，代码高亮为轻量实现，不覆盖所有语言。
- `@` 文件引用排除了 `node_modules` 与 `.git`，且最多枚举 2000 个文件。
- 工作模式选择目前仍内嵌在空白会话页面，尚未改为模态框。
- `ws` 依赖未显式声明；旧版 VS Code 宿主若无全局 WebSocket 则需额外安装 `ws`。
- 权限切换受 dsh 后端保护：会话存在打开/创建中的持久终端时不能切换，需先关闭终端。

---

## 许可

MIT
