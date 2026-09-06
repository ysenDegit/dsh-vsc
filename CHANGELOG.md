# Changelog

本文件记录 dsh-vsc-weblike 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [1.1.0]

### Changed

- 适配 dsh 0.1.2-rc.1（Typert Remote）：
  - 一元 RPC 改为 `POST /api/<ns>/<method>`，payload 统一 `{args:{...}}`；`WireClient` 增加 `callArgs`。
  - 事件流改为单 WS `/api/remote.mux`：`$events`（全局 emit/waterfall）、`session/control`（队列/投影/jobs）、`workspace/follow`（工作区/归档）、`session/follow`（会话日志快照 + 实时事件）；新增 `RemoteMuxClient` 多路复用逻辑流并自动重连。
  - 会话/工作区端点映射：`session/list|create|page|follow|prompt|cancel|rename|fork|attachment|updateQueue|modelCatalog|selectModel`、`workspace/create|delete|rename|archiveSession|follow`、`agentPresets/list|select`、`commands/list|execute`、`settings/describe|openSettingsDocument`、`$events/result`。
  - token 认证：插件启动 dsh 时从 `dsh web: http://.../?token=...` 捕获每次进程唯一的 launch token，首次启动用它换取 `dsh-auth-*` cookie，所有 `/api` 请求与 `/api/remote.mux` upgrade 都携带该 cookie；状态文件记录 token，供跨重启复用插件实例。
  - 默认端口已有 dsh 但需要认证时不再直接新建实例：插件先弹输入框询问用户粘贴带 `?token=...` 的完整启动 URL，粘贴成功则复用，取消才启动插件自己的实例。
  - settings / 模型目录 / 命令列表适配 rc.1 新返回结构；离线设置功能保持可用；`minDshVersion` 默认提升到 `0.1.2-rc.1`；README 中英文明确声明插件 1.1.0 要求 dsh >= 0.1.2-rc.1（运行环境节同步从 0.1.0-rc.6 更新，低于该版本的旧 dsh 不再兼容）。
  - 改动 src/wire.js、src/server.js、src/dsh-service.js、src/session-service.js、src/chat-view.js、src/extension.js、tests/session-service.test.js；已对真实 rc.1 实例完成 token 换 cookie、RPC、`$events`/`workspace.follow`/`session.control`/`session.follow` 冒烟验证。

### Fixed

- 修复 `session/page` 使用 `throughSeq = Number.MAX_SAFE_INTEGER` 被 rc.1 拒绝（"through seq … is past cursor"）的问题：初始历史改为由 `session/follow` 首帧 snapshot 种子化并记录 cursor，`session/page` 仅在“加载更早”时使用 `throughSeq = cursor`，不再超出会话当前水位。
- 修复关闭“自动启动 dsh web”后，在已是 dsh 工作区的目录打开插件仍弹“是否将当前工作目录添加到 dsh 工作区？/ 取消后看不到工作区会话”的问题：根因是 `workspace/follow` 常开流只在流打开时下发一次 baseline，而初始化流程 `sessions.reset()` 清空缓存后既不等待也不触发新的 baseline，`ensureWorkspace` 在缓存为空时把已存在的工作区误判为“未加入”而弹确认框（取消则 `workspaceView` 为空，会话列表随之为空）。修复：`SessionService.reset()` 现在同时重新武装 `whenWorkspaceReady()`（5s 兜底计时器 unref，不阻塞进程退出）；`ChatViewProvider` 新增 `reopenWorkspaceFollow()`（关闭并重开 `workspace/follow`，服务器即重发 baseline——已用真实 rc.1 实例验证“首开 1 条 baseline、重开后 2 条”），`doEnsureWorkspaceAndSession` 在 `reset()` 后调用它，`ensureWorkspace` 在 `findWorkspace` 前先 `await whenWorkspaceReady()`。另：dsh 未连接（如关闭自动启动且无手动实例）时聊天区不再显示误导性的“将当前文件夹添加到 dsh 工作区”按钮，改为“dsh 尚未连接：点击顶部状态点重新检测/启动 dsh”（中英文新增 `emptyNoDsh`）。改动 src/session-service.js、src/chat-view.js、src/webview/script/01-i18n.js、src/webview/script/03-render.js、src/webview/script/07-message.js、tests/session-service.test.js（+1，测试 40/40）。
- 修复 dsh Web UI 打开入口在 rc.1 下落到 `dsh web authentication required` 401 页的问题：顶栏 `⋯` 菜单“打开 dsh Web”、设置-关于“dsh 服务地址”超链接与 `dsh: Open Web UI in Browser` 命令全部改用带当前进程 launch token 的完整 URL（`http://…/?token=…`，浏览器一次 GET 即换 cookie 进入 UI；实例无 token 时退回纯 baseUrl）。打开前先 `ensureAuthToken()` 验证：launch token 每进程唯一，外部手动实例被重启后 token 会更换——此时点击打开会重新弹框询问新 token URL，不会再次落进 401 页（插件自启实例的 token 始终为当前进程的，验证一次 HTTP GET 即通过）。改动 src/dsh-service.js（新增 `webUrl` getter 与 `ensureAuthToken()`）、src/extension.js、src/chat-view.js、src/webview/script/05-settings.js、tests/dsh-service.test.js（+8，测试 39/39）。
- 修复 VS Code 1.136 远程窗口下活动栏与编辑器标题按钮插件图标仍渲染为空白灰块的问题（文件图标 SVG/PNG 均无法加载；1.0.10 已从 SVG 切到 PNG 仍复现）：视图容器与 `dsh-vsc.openChatFromTitle` 命令图标改用 VS Code 内置 codicon `$(comment-discussion)`（字体图标，不依赖扩展资源文件加载；本版本内置 references-view 容器即用 `icon: "$(references)"` 证实 activitybar 支持 codicon，微软 Python 扩展命令图标 `"$(play)"` 证实 commands.icon 支持 codicon）。包级 marketplace 图标保持 `assets/icon.png`（市场要求 PNG）。改动 package.json、README.md。

## [1.0.10]

### Changed

- 简洁会话与详细会话的实现彻底分离：会话折叠（`src/conversation.js`）现在按 `foldEvents(events, { mode: ... })` 产出两种独立列表——简洁模式只保留用户消息、助手文本与命令反馈（不携带工具/思考/上下文/产物/note，也不再在 webview 端二次过滤）；详细模式保持原有完整时间线。切换显示模式时宿主会按新模式重新折叠并推送会话内容。webview 为简洁会话的流式助手消息新增轻量纯文本增量渲染（`renderConciseStreamingItem` / `appendConciseStreamText`，每个 chunk 只追加文本增量，不再整段 Markdown 重建），且用户向上滚动时把重绘频率从 16ms 自动降到约 150ms，流式期间向上滚动对话框不再被高频 DOM 重建拖慢；回合结束后仍以 Markdown 渲染最终结果。改动 src/conversation.js、src/chat-view.js、src/webview.js、tests/conversation.test.js；测试 26 → 31。
- webview 单文件重构为模块化拼装：`src/webview.js` 只负责组装 HTML（约 57 行），样式（`src/webview/style.css`）、静态 DOM（`src/webview/body.html`）与内联脚本按 boot / i18n / markdown / render / actions / settings / listeners / message 拆到 `src/webview/script/*.js`。仍为零构建、纯 CommonJS，`getWebviewHtml(nonce)` 按固定顺序读文件拼装，功能与拆分前完全一致；单文件过大不再影响运行性能（文件体积只影响一次加载解析），主要收益是模块边界清晰、便于维护。
- 会话刷新与渲染性能优化：`host/session-status` 等事件触发的 `refreshSessions` 改为 120ms 防抖 + 在途合并，避免高频状态帧造成 `workspace.list` / `session.list` RPC 风暴与乱序回推；webview 的 `itemSignature` 改为长度/状态轻量签名，不再每帧拼接完整消息文本；`renderConversation` 只在节点未挂载时才 `appendChild`（“加载更早”等头部插入场景自动整树重建），减少长会话下的重复 DOM 移动；`selectSession` 中历史/模型/命令目录并行加载，降低切换延迟。改动 src/chat-view.js、src/webview/script/03-render.js；测试 31/31。
- README 简介补充 dsh 版本适配声明：鉴于最新 DeepSeek Harness alpha 版本的快速破坏性更新，本插件暂时不对其适配，支持 dsh 版本仍为 0.1.1-rc.2（中英文）。
- 插件前端与 dsh 后端解耦（离线可用）：dsh 未启动时设置面板仍可打开并修改本地设置（会话显示、字体、宽度、语言、Enter 发送、启动行为、上下文栏等）；“关于”页显示“dsh 未连接”提示；工作区管理页签仅在已连接时展示；“打开 settings.yaml”离线时直接尝试打开本地文件，未生成时给出明确提示。改动 src/chat-view.js、src/webview/script/01-i18n.js、src/webview/script/05-settings.js。
- README 简介补充 VS Code 1.136 图标注册说明：VS Code 1.136 的扩展注册可能存在 bug，插件图标无法正常显示，但入口仍可点击使用（中英文）。

### Fixed

- 修复 Sessions 抽屉中运行中的会话导致切换失败/需多次点选的问题：`conversation` 流式帧每次都会携带 `selectedSessionId` 并触发 `renderSessions()` 整棵重建 drawerList，会话工作时高频 chunk 会在点击过程中替换 DOM 节点，使 click 事件丢失（会话越活跃越难切换）；同时旧会话在途帧还可能反向覆盖用户的新选择。现在 webview 对 `conversation` 帧只处理 `msg.sessionId === state.selectedSessionId` 的帧，不再用帧内 `selectedSessionId` 覆盖当前选择，也不再因流式更新重建 Sessions 抽屉。改动 src/webview.js；测试 26/26。
- 修复切换会话/清空会话时旧界面状态残留：`sessions` / `hydrate` 消息现在显式接受 `selectedSessionId = null`，切换选中会话时立即清空上一会话的对话、队列、审批/提问、模型/命令等会话级状态，避免新会话消息未到达前闪出旧会话内容，也避免归档/删除工作区后仍显示旧数据。改动 src/webview/script/07-message.js、src/webview/script/03-render.js。
- 修复 RPC 可能无限挂起的问题：`WireClient.call` / `respond` 增加默认 60s 超时（可传参覆盖），dsh 服务无响应时抛出明确超时错误而不是让界面一直等待。改动 src/wire.js、tests/wire.test.js（+1，测试 31/31）。
- 修复 VS Code 升级后活动栏/编辑器标题图标不显示的问题：VS Code 1.136 远程窗口下 SVG 图标（即使改为 `currentColor`）仍渲染为空白，活动栏与编辑器标题入口改为直接使用 `assets/icon.png`（128×128 PNG，市场图标同款鲸鱼），PNG 为各版本 VS Code 通用格式；`assets/icon.svg` 保留备用。包内 package.json 的 `viewsContainers.activitybar` 与 `dsh-vsc.openChatFromTitle` 命令图标均指向 `assets/icon.png`。
- 修复“用户手动启动 3080 dsh 实例但插件仍用自己的实例”的问题：实例复用优先级改为 **显式 `dshUrl` → 默认端口 3080 → 状态文件**（原为显式 → 状态文件 → 3080），用户手动启动的实例优先；状态文件同时改为记录 dsh 子进程 pid（原来记录的是 VS Code 扩展宿主 pid，无法判断服务是否真的存活）。改动 src/dsh-service.js、README.md。

## [1.0.9]

### Added

- Sessions 抽屉新增“未分组”勾选项（位于标题旁）：勾选后显示 `cwd` 与当前工作区路径一致的未分组会话（未被任何 dsh 工作区记账、非子代理、未归档），并可按会话“加载到当前工作区”或一键“全部加载”。实现基于 dsh `session.create` 的幂等采用路径（同 `sessionId` + `workspaceId` 再次调用即把已存在会话纳入工作区，要求会话 cwd 与工作区路径一致，否则后端返回 `session-conflict`）。新增 `SessionService.listUngroupedSessions` / `attachUngroupedSession`，`ChatViewProvider` 的 `getUngroupedSessions` / `attachUngroupedSession` / `attachAllUngroupedSessions`，webview 勾选状态与未分组分区渲染（中英文文案、加载中/成功/失败 toast）。测试 23 → 26（新增 3 条 `listUngroupedSessions` / `attachUngroupedSession` 载荷与过滤测试）。

### Fixed

- 修复详细模式展开 Think 后整个页面大幅上跳的问题：`<details>` 展开/收起会让聊天区高度突变，浏览器滚动锚定（scroll anchoring）会把视线整体拉走（思考链越长越明显）。现在点击 summary 时记录其视口位置，下一帧按实际位移补偿 `chatEl.scrollTop`，使展开/收起前后点击处保持不动；同一机制也覆盖上下文注入（Context）等其它 `details` 摘要。改动 src/webview.js。
- 修复会话区顶部残留“新会话已就绪。输入消息开始与 DeepSeek Harness 对话。”提示的问题：切换会话/打开历史会话时，如果历史尚未加载完成，界面会先渲染空状态提示；随后历史消息到达后直接追加在提示下方，导致翻到最上方仍能看到空状态文案。现在渲染消息列表前会清理残留的 `.empty` / `.empty-actions` / 空白新会话欢迎节点，只保留“加载更早”按钮与真实的会话内容。

## [1.0.8] - 2026-08-23

### Changed

- 界面视觉基线（Phase 0）：聊天界面全面改用 VS Code Webview 主题变量（`--vscode-*`），替换原写死的深色回退色板；引入语义色板（`--surface`/`--surface-2`/`--border-soft`/`--accent-soft`/`--active` 等）并统一圆角（4/6/8px）、默认柔化边框、弹层阴影与滚动条样式，使界面随 VS Code 主题自适应深浅色，向 Copilot / Claude Code 插件的“工具化、内容优先”观感靠拢。
- 打包精简：`.vscodeignore` 增加 `assets/hahawhale.svg`（未在任何代码/文档中被引用的闲置 104KB 装饰资产），避免其混入安装包。
- 界面改版 Phase 1（顶栏 + Sessions 抽屉）：顶部从"一排小按钮 + 下拉"改为精简顶栏（会话标题 + 状态点 + 新建/刷新/Sessions/设置/⋯）；点击会话标题或 `☰` 打开 Sessions 抽屉，含搜索、New Session、会话列表（工作中/已归档/相对时间 + fork/重命名/归档每行操作）；当前会话的归档/重命名/fork/打开 dsh Web 移入顶栏 `⋯` 菜单。
- 功能变更：
  - 移除"下载当前会话上下文"（`⬇`）功能与相关导出代码。
  - 归档/关闭会话不再把会话副本保存到工作区 `.dsh-vsc/archived-sessions/`，仅归档并从会话列表移除。
  - 新增 fork 会话：通过 dsh `session.fork` RPC 复制当前会话（继承 cwd、模型与 `parentSessionId` 血缘，自动切换新会话）；无可 fork 完成回合时给出提示。新增 `SessionService.forkSession` 与 `ChatViewProvider.forkSession`，并补充 `session.fork` 载荷单元测试。
- 测试：19 → 21（新增 2 条 `session.fork` 载荷测试）。
- 顶栏细节调整：
  - 修复点击会话标题按钮中间区域无法打开 Sessions 抽屉的问题（原 document 点击风控把内层 `<span>` 当作"外部点击"而立即关闭，现改为 `sessionTitleBtn.contains(t)` 判定）。
  - 删除顶栏 `☰`（Sessions）与 `＋`（新建会话）按钮——Sessions 抽屉由点击会话标题打开，新建会话入口在抽屉内。
  - `⋯` 菜单移除"重命名 / fork / 归档"会话管理入口，仅保留"打开 dsh Web UI"；会话管理统一在抽屉每行操作。
  - fork 出的新会话自动以"源会话标题（fork YYYY-MM-DD HH:mm）"命名。
- fork 会话增加通知反馈：点击 fork 后立即在顶栏下方弹出"正在 fork 会话…"（带 spinner），fork 完成替换为"fork 完成：<标题>"，失败时提示原因（无可 fork 完成回合）。webview 新增 toast 组件与 `forkDone`/`forkError` 消息，`ChatViewProvider.forkSession` 在成功/失败时发送对应消息。
- 界面改版 Phase 2（Composer + 动作/模式弹层，Claude Code 风格）：
  - Composer 改为 `＋`(动作) / `📷`(图片) / 输入框 / `⤢` / `■` / `Auto`(模式胶囊) / `发送`。
  - `＋` 打开"筛选动作…"搜索框，分 **Model**（切换模型 / 推理强度 / 账户与用量）与 **Context**（引用项目文件 / 附加图片）两组。
  - `Auto` 模式胶囊打开 Modes 弹层（Manual / Plan / Auto 等工作模式，映射 dsh 权限预设），当前模式高亮显示在胶囊上。
  - 原有 `模`（模型）与 `权`（权限）按钮分别并入动作弹层与模式胶囊。
- Composer 交互修正（Phase 2 修订）：
  - 权限与模型控制合并：删除独立的工作模式（`Auto`/`workspace-write`）胶囊按钮，`＋` 的动作弹层统一集成 **Model**、**权限/模式**、**Context** 三组；选择权限后自动关闭动作弹层。
  - 发送按钮改为输入框内右侧 `↑` 圆形箭头，不再占用底部工具栏。
  - Composer 改为圆角胶囊；"展开/收起"只把输入框向上浮出为独立面板，底部工具栏保持紧凑。
  - 底部统计行右下角显示"模型 | 推理强度 | 当前权限"，如 `Deepseek V4 Flash | Max | workspace-write`。
- Composer 交互调整（Phase 2 修订 2）：
  - 删除"展开/收起输入框"功能（输入框已支持 Enter/Shift+Enter 换行）。
  - 发送按钮改为输入框右侧的"发送"文字按钮（有图片时在按钮内显示小数字徽标）。
  - 动作按钮改为"方框斜杠"图标并置于发送按钮右侧；点击打开一个简单卡片，仅含 **模型/推理** 选择与 **权限/模式** 列表（不再使用搜索式"筛选动作"弹层，也不调用 VS Code 原生选择器）。
  - Composer 仍为圆角胶囊；输入框默认保留外边框；面板宽度 <900px 时，底部统计行隐藏中间"缓存命中 / LLM 用量"，保留 `working` 与右下角模型/权限信息。
- 界面改版 Phase 4（对话流与 Hero 空状态）：新会话 Hero 增加问候语与工作模式卡片（`mode-welcome` 最大宽度、标题样式微调）。
- 底栏信息完整显示：`.stats-bar .model-info` 的 `max-width` 由 45% 放宽为 `calc(100% - 80px)`，窄面板下不再截断"模型 | 推理强度 | 当前权限"。
- 界面改版 Phase 5（设置与响应式）：设置弹窗分组改为 VS Code 设置风格卡片（`settings-section` 背景/圆角/柔化边框）；窄面板（≤600px）自动收紧顶栏、聊天区与 composer 内边距。
- 界面改版 Phase 6（发布收尾）：更新 README / CHANGELOG / context.md，重打包并核验（版本号按约定仍为 1.0.8，等用户声明后再 bump）。
- 详细会话模式向 web 端靠拢：工具调用改为紧凑时间线（图标 + 工具名 + 文件名（去路径下划线），点击展开参数/结果，错误显示 ❌ 红字）；思考过程改为单行 `💭 Think · 预览`（预览折叠换行为单行，点击展开完整思维链且保留换行），流式思考为 `💭 Thinking · …`；去掉卡片底色/左侧色条/等宽字体。
- 适配 dsh web 端“产物”列表：live 流 `session/event` 附带工具渲染意图（callView：diff 或 generic/edit）且工具成功时，回合结束自动输出“产物”行（成功修改文件按首次出现顺序去重，最多显示 5 个 chip + “+N”），点击 chip 在 VS Code 中打开对应文件；历史回放（无 view）不下发产物行。新增 `producedFromCallView` 派生、`openFile` 消息与 2 条折叠测试。

## [1.0.7] - 2026-08-22

### Changed

- 自动启动 dsh 的进程命令改为 `dsh web --port 0 --no-open`：此前自启会触发 dsh 打开默认浏览器，现通过 `--no-open` 禁止打开浏览器（插件内嵌自己的聊天界面，无需外部浏览器）。新增 `server.webArgs` 纯函数统一生成启动参数，并补充回归测试确保 `--no-open` 始终位于参数末尾、不被覆盖。
- README 简介新增 Bug 反馈提示：由于作者测试环境有限、BUG 被发现得较零散，如遇恶性 BUG 可邮件 ysen96@qq.com，将尽快修复。

## [1.0.6] - 2026-08-22

### Changed

- 对话区视觉优化：
  - 命令/工具消息改为紧凑卡片（收紧内边距与消息间距，命令头与结果缩进为一行/两行小卡）；`/permission` 类命令渲染为小胶囊（chip），结果与其同行；命令类消息不再显示"命令" meta 标签，降低连续同类命令的重复视觉噪音。
  - 用户消息右对齐并限宽约 85%，助手消息左对齐；工具/命令消息改用更暗背景 + 左侧色条，形成消息层级。
  - 更多颜色改用 VS Code 主题变量（`--vscode-*`）：状态点、工作指示灯、TODO 状态、审批提示、错误提示等工作区配色不再硬编码色值。
  - 工具调用卡片优化（详细会话模式）：由"工具名 + `结果 工具名 …`拼接串"的折行排布，改为可折叠卡片（`<details>`，默认收起、点击展开），标题行为工具名 + 首个参数摘要（超出截断），正文为格式化后的参数与会话结果（等宽、限高约 220px 超出滚动）。
  - 推理思维链与正式输出分开：思考过程不再嵌套在文本气泡内，而是作为独立块展示在正式输出上方；折叠/完成标题固定为 "Think"（中英文一致，不再随界面语言显示"思考过程"）。
  - 移除消息卡片上的角色标签（DeepSeek / 工具 / 提示 / 上下文）与模型回复中的"生成中…"字样：回复框只保留内容与流式光标，不再显示这些提示文本。
  - 思考过程展示（仅作展示用）：思考过程回复框采用与工具调用框一致的卡片样式（左侧色条、`--tool-bg` 背景、圆角、紧凑内边距、等宽字体与 12px/箭头字号，与工具卡一致），折叠后的 `Think` 框左右宽度只容纳 "Think" 字样（不整行拉宽）。生成中为单行 `Thinking · <流式内容>`（左侧输出状态、右侧流式内容；单行不换行、无横向滚动条、高度固定一行；内容不断向右增长，视窗固定在最新处，旧内容向左滚出视野）；生成结束后自动折叠为 `Think`，点击展开查看完整思维链（正文为多行灰色文字，无黑底卡片）。
  - 详细会话模式下也显示左下角工作状态（working）：此前仅简洁会话显示，现两种显示模式一致（question/approval 面板打开时仍隐藏以免重叠）。

### Fixed

- 修复"计划"任务栏收起小箭头不生效：点击计划栏头部即可展开/收起任务列表，箭头在 ▸/▾ 之间切换，收起状态在统计刷新后保留。
- 修复某些助手消息出现空白气泡：当助手消息仅含工具调用、无文本且无推理（非生成中）时不再渲染空气泡（此前会显示一个空的"DeepSeek"卡片）。
- 修复工具调用结束后仍显示"运行中"：`tool/result` 事件的 callId 应取自 `data.message.callId`（dsh 实际把它挂在 message 上），原实现只查 `source.callId` / `content[].toolCallId` 导致配对失败、工具卡永远停在 `call` 状态；现按 `message.callId` → `data.callId` → `source.callId` → `content[].toolCallId` 逐级回退配对，结束的工具卡展示结果（成功/失败），仅真正进行中的才显示"运行中"。

## [1.0.5] - 2026-08-22

### Added

- 图片发送（vision，两种方式）：① 输入框粘贴截图/图片（PNG/JPEG/WebP）；② 输入框左侧 **📷 选择图片**按钮（隐藏 `<input type=file>` 打开本地文件对话框，本机/远程都可靠）。图片以缩略图显示在输入框上方（可逐张移除，发送按钮显示 🖼N 角标，"已添加 N 张图片"提示确认），随消息作为 `image` 附件提交给模型（配合 `deepseek-v4-flash-vision-exp` 等视觉模型使用，并补发浏览器时区 `clientTimeZone`）；部分远程环境剪贴板 items 不含图片文件时自动尝试 `navigator.clipboard.read()` 兜底，并在输出面板记录诊断日志；历史消息中的图片以缩略图渲染（通过 `session.attachment` 按需取回并缓存）；不接受图片附件的命令发送前提示并保留图片（命令目录携带 `input.images` 标志）；修复 `hidden` 属性被 `display:flex` 覆盖导致预览 rail 不显示的样式问题。

### Fixed

- 修复首次启动插件时 composer 栏元素缺失（权限选择按钮"权"与统计行/模型信息不显示）：启动阶段 webview 的 `ready` 请求可能早于工作区/会话初始化完成，`hydrate` 拿到空会话、模型/命令/统计均未拉取，且权限按钮与统计行此前只依赖 `stats` 消息触发渲染。现初始化请求合并为单轮并在 `hydrate` 前完成，`hydrate` 载荷携带统计快照（统计行/权限/TODO 首帧即渲染），`ready` 后补发 `stats` 快照，会话快照刷新时对未加载的模型/命令目录自动补发请求。

### Removed

- 移除"拖拽图片添加"功能：VS Code webview 的拖放拦截不稳定（拖拽经过 explorer 等区域后文件对象被 workbench 接管，会回退为"用 VS Code 打开图片"），保留粘贴与 📷 选择图片两条可靠路径。

## [1.0.4] - 2026-08-20

### Added

- "添加工作区"确认框推迟到用户首次打开插件界面时弹出：启动阶段后台静默初始化（dsh 自动启动、会话准备照常），不再弹窗打扰。
- 未添加工作区时，聊天区显示"没有打开的工作区，无法开始会话。"提示及"将当前文件夹添加到DSH工作区"按钮（点击后重新询问）。
- 设置-关于 页新增"dsh 服务地址"：显示当前连接地址（超链接），点击在浏览器打开 dsh Web UI。
- 首次创建工作区且无会话时，自动创建并选中空白"新会话"（下拉不再显示"暂无会话"），聊天区显示"新会话已就绪…"提示及工作模式选择。
- 设置新增"工作区"页（管理工作区）：查看当前/全部 dsh 工作区、"显示已归档会话"开关（已归档会话带 🗄 标记）、重命名/删除工作区（删除需二次确认）。
- 设置-工作区 的会话数显示改为"工作中+已归档"（如 3（工作中）+4（已归档），工作中数字加粗；工作中仅统计可见的真实会话，不含空白"新会话"占位与子代理会话）。

### Removed

- 移除"拉取会话"功能：dsh 协议不支持跨工作区复制会话（`workspace.insertSessionBefore` 仅限同工作区内排序移动）；待 dsh 服务端提供复制/导入 API 后再恢复。

### Fixed

- 修复新版本 dsh 上执行 `/` 命令报 `missing "images"`：`commands/execute` 载荷补上 `images: []` 字段（Typert 描述符要求）。

## [1.0.3] - 2026-08-20

### Added

- 自动弹出逻辑收紧为三个条件同时满足：dsh web 已在运行、当前目录已在 dsh 工作区中（新窗口/新目录不弹）、上次未关闭过面板（关闭后手动打开一次恢复）。
- 设置面板"通用"页新增"启动行为"开关：启动 VS Code 时自动启动 dsh web（`autoStart`）、启动时自动打开面板（`autoOpenChat`）。
- 状态徽标在"已停止/错误"时可点击，重新探测 dsh web 实例（`retryConnect`）。
- 设置面板"上下文占用"并入"显示"标签页，进度条颜色/透明度为其子设置项（缩进层级展示）。

### Fixed

- 关闭自动启动（`autoStart=false`）后插件不再连接手动启动的 dsh web：现改为只禁用自动生成实例，仍会复用/连接已运行的实例（未发现实例时保持 stopped，不弹错误）。

## [1.0.2] - 2026-08-20

### Changed

- README 合并为中英双语：简介中英双语并排，正文先中文后英文，顶部及章节末尾提供页面内跳转（`#中文` / `#english`），删除单独的 README_en.md。

## [1.0.1] - 2026-08-19

### Added

- 首个公开面世版本。
- README 添加插件截图（assets/Screenshot.png）。

### Changed

- 清理代码与文档中的私人信息。
