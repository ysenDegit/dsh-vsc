# DeepSeek Harness Chat (dsh-vsc)

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
  - 简洁模式隐藏工具调用与思考流程，只保留用户与 Assistant 最终输出。
  - 运行中显示 `working`。
- 流式 Assistant 输出。
- 工具调用与工具结果按 `callId` 配对。
- 上下文注入默认折叠，只保留最新一条。
- 向上翻页时提供“加载更早”按钮，按需加载更早历史。
- 每条消息支持删除：
  - 删除前二次确认。
  - 简洁模式下删除非用户条目时，会连同上次用户消息之后的隐藏工具/思考/上下文一并删除。
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
  - `Enter` 发送，`Shift+Enter` 换行（默认）。
  - 或反过来：`Shift+Enter` 发送，`Enter` 换行。
- 输入框展开/收起：只有输入框向上展开，附近按钮位置不变。
- 停止按钮使用 `■` 图标。
- `@` 文件引用：输入 `@` 弹出当前工作区文件列表，实时过滤。
- `/` 命令菜单：输入 `/` 弹出 dsh 命令列表。
- 发送队列显示：显示“排队中”队列，支持编辑、插话（steer）、删除。
- 模型与推理强度合并为一个 `模` 按钮，支持自定义模型名称。
- 权限选择压缩为输入框左侧 `权` 按钮。
- 底部统计行：
  - 中文：`上下文:42% | 11 轮 · 319 步 | LLM 46m33s · 工具调用 35m30s | ...`
  - 英文：`ctx:42% | 11 turns · 319 steps | LLM 46m33s · tool calls 35m30s | ...`

### 5. 工具审批 / 计划条 / 权限 / 问题
- 工具审批（Approval）：输入框区域切换为审批面板，支持 `允许一次` / `拒绝`。
- 计划条（Todo）：展示计划列表与状态统计。
- 权限选择（Permission）：读取 dsh `permissions` 投影，切换时执行 `/permission <preset>`。
- 问题与计划评审：
  - Plan Review：支持批准 / 拒绝 / 聊一聊。
  - Ask User：支持单选、多选、自定义回答。

### 6. 设置面板
- 打开方式：点击顶部 `⚙`。
- 会话显示模式：简洁 / 详细。
- 字体大小：12–20 px。
- 界面语言：中文 / English。
- 发送方式：Enter 发送 / Shift+Enter 发送。
- API Key：`DEEPSEEK_API_KEY`。
- 可写 secret 字段编辑。
- 打开 settings.yaml（在 VS Code 内打开 `$DSH_HOME/settings.yaml`）。

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
| `dsh-vsc.language` | string | zh | 插件界面语言：zh / en |
| `dsh-vsc.autoOpenChat` | boolean | true | 检测到 dsh 已运行时，启动后自动打开工作区面板 |
| `dsh-vsc.enterToSend` | boolean | true | Enter 键行为：true = Enter 发送；false = Shift+Enter 发送 |

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

# 打包（需安装 @vscode/vsce）
npx @vscode/vsce package
```

本仓库当前环境建议使用：

```bash
npm_config_cache=/tmp/npm-cache npx --yes @vscode/vsce package
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
