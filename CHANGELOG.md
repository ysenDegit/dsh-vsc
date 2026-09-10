# Changelog

本文件记录 dsh-vsc-weblike 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [1.1.2]

（未发布：1.1.1 已于 2026-09-06 由用户发布。）

### Changed

- 适配 dsh 0.1.5（对照工作区 dsh 仓库 0.1.5 分支与真实 0.1.5 实例逐端点校验；`minDshVersion` 默认提升到 `0.1.5`）：
  - **实时助手输出改用进程内 assistant-stream**：0.1.5 起会话日志不再写 `assistant/chunk`（chunkrow 打包传输已归档），运行中的增量只有 `session/follow` 的 `assistantStream:true` 会下发。插件现在随 follow 请求开启该选项，新增 `src/assistant-stream.js`（`expandAssistantStreamRecords` 展开 durable 紧凑记录 + `LiveAssistantStream` 跟随 start/chunk/end 帧），重连时用快照 `activeAttempt` 还原 partial；durable `assistant/message`/`assistant/attempt` 落地即替换实时副本。改动 src/assistant-stream.js（新增）、src/chat-view.js、src/conversation.js。
  - **工作模式以 `agentPreset` 投影为准**：`session/list`、follow/control 快照都带该投影，插件侧记录只作点击后的乐观缓存（旧版后端兜底）；`session/create` 结果仍用于首次建立。
  - **模型选择以 `modelSelection` 投影为准**：`next → lastUsed → modelCatalog.default`，投影变化（可能在 dsh Web UI 里改）后自动重取；`modelCatalog` 的 `default/routableProviders/groups/failures` 形状保留。
  - **历史记录回归 0.1.5 契约**：`session/page` 与 follow 快照的 `records` 只有 `{type:'event',event}`，移除已废弃的 chunkrow 展开分支（`historyRecordEvent`）。
  - `workspace/follow` 新增的 `order` 帧（工作区手动排序）现在会重排缓存列表。
  - `agentPresets/list` 的 `modeSelectionEnabled` 生效：为 `false` 时新会话不再显示模式卡片；`authorable` 一并透传。
  - **新增 Sessions 抽屉内容搜索**：输入 ≥2 字符防抖调用 `session/search`，命中显示会话与摘要（点击直接切换）；dsh 默认把全文索引配成 `openAt:'never'`，此时静默降级为原有标题本地过滤，只记一条日志。
  - `session/control` 的 `jobs` 帧接入统计行：运行中的后台任务数量以"{n} 个后台任务"提示。
  - `historyRecordEvent` / `sessionPresetOf` 由 session-service 导出供 chat-view 复用；README 新增“插件版本 ↔ dsh 版本对应关系（1.1.0 起）”表（中英文）；测试 40 → 50（含新增 assistant-stream、抽屉搜索、适配器参数用例）。

### Added

- 文件附件：输入框新增 📎（0.1.5 `fileUploads/upload`），发送前把文件 base64 上传换 `receiptId`，并以 `{type:'file',receiptId}` 进入 `session/prompt` 或 `commands/execute` 的 `submittedAttachments`（图片/文件统一处理）。
- **悬浮提示词暂存框**（`dsh-vsc.promptStash`，默认开启）：输入框上方右侧的悬浮层，用于预先写下"接下来准备发送的提示词"，最多 5 个槽位（composer 行里的 ＋ 逐个增加，到上限后按钮禁用并提示"最多 5 个"）。每个槽位是固定高度的单行输入框（不自动换行，超出部分只显示能显示出来的内容），右侧按钮（或在该框内按 Enter）把该条提示词直接发进当前会话——发送后只清空该框内容、保留槽位，方便接着写下一条；× 移除该槽位。内容变化防抖 300ms 上报宿主并持久化到 VS Code globalState（重启/换窗口后仍在），关掉开关只隐藏界面、不清空内容；待回答问题/审批时随 composer 行一起收起，dsh 未就绪或槽位为空时发送按钮禁用。设置面板"常规"页新增同名开关。新增 src/webview/script/08-prompt-stash.js、src/protocol.js 的 `normalizePromptStashItems`/`PROMPT_STASH_LIMIT`，改动 src/chat-view.js、src/extension.js、package.json、src/webview.js、src/webview/{body.html,style.css}、src/webview/script/{00-boot,01-i18n,03-render,04-actions,05-settings,06-listeners,07-message}.js。
- 悬浮提示词暂存框：**发送后删除该暂存框**（用户要求，原为"只清空内容、保留槽位"）——点框右侧发送按钮或在该框内按 Enter 把提示词发进会话后，该框立即从悬浮层移除、剩余框上移并重新编号、持久化同步删除条目，焦点收回到 composer 输入框（避免框消失后焦点掉到 body、接着打字没反应）。设置页说明与 README（中英文）同步。
- 悬浮提示词暂存框：**＋ 按钮会把输入框里的文字存进新暂存框**（用户要求）——输入框有内容时，点 ＋ 即把整段文字移到新框并清空输入框（多行草稿原样保存，单行框只是显示不下换行；输入框为空时仍是新建空框），按钮 tooltip 随"输入框有没有文字"在"添加提示词暂存框 / 把输入框内容存入新的暂存框"之间切换；**同时取消暂存框数量上限**（原为 5 个）：按钮不再禁用、`normalizePromptStashItems()` 不再截断条数（保留单条 20000 字符兜底），悬浮层自身加 `max-height: min(45vh, 320px)` + 滚动，堆再多也不会盖住聊天区，设置面板说明、`dsh-vsc.promptStash` 配置说明与 README 同步。i18n 删 `promptStashAddFull`、新增 `promptStashAddFromInput`。测试：暂存框用例改为「hydrate 渲染 / ＋ 吞掉草稿并在无上限下持续新增 / Enter 与输入法 / × 移除」，`normalizePromptStashItems` 用例改为断言 200 条不被截断，测试仍 73。
- 抽屉里**不再区分分支会话与普通会话**（用户要求）：fork/派生出来的会话直接按普通会话渲染——不缩进、不加"分支会话"标记、fork/重命名/归档操作与其它会话一致（dsh `session/fork` 写的 `parentSession` 只是 dsh 侧元数据）。`buildSessionLineage()` 现在只对 `origin:'subagent'` 的子代理会话（含子代理再派生的子代理）做嵌套与按 depth 缩进，孤儿降级为 root、防环等逻辑保留；"提升为普通会话（⇧）/ 恢复层级（⇩）"因此只对子代理行有意义，宿主的 `promotedLocally` 也只对子代理会话下发（旧数据里针对分支会话的遗留条目自动被忽略）；i18n 删除 `forkedSession` 文案。用例改写为「forked sessions render exactly like normal sessions; only subagents nest」（含孙代 fork 顶层渲染与两层子代理缩进；已实测旧嵌套规则下失败），真实账本（98 条会话）核验：98 行全渲染、缩进行数 = 子代理数（8）、"分支会话"字样 0 处、10 条 fork/派生会话全部顶层。测试仍 73。
- 输入框占位符在暂存框功能开启时追加"**· Ctrl+Shift+Enter 暂存**"（用户要求，截图标注输入框内的提示区）：文案随发送方式配置切换基础部分（`Enter 发送 · Shift+Enter 换行` 或反过来），语言切换、发送方式切换、暂存开关切换都会即时更新；功能关闭时该提示不出现。三处原先各写一份的 `composerInput.placeholder = ...` 收敛到 `updateComposerPlaceholder()`。新增运行时用例覆盖（中英文、两种发送方式、开关切换、初始关闭）。测试 78 → 79。
- 悬浮提示词暂存框：**输入框里按 Ctrl+Shift+Enter（macOS 为 Cmd+Shift+Enter）直接把当前内容暂存到新暂存框**（快捷键先定为 Ctrl+Enter，按用户要求改为 Ctrl+Shift+Enter，1.1.2 发布前调整，未对外发布过旧快捷键）（用户要求，仅在该功能开启时生效）——复用 ＋ 的暂存逻辑（文字 + 待发送图片一起搬走并清空 composer），输入框既无文字也无图片时不做任何事（不造空框、也不 `preventDefault`）；与原有 Enter/Shift+Enter 发送语义互不干扰（先判 Ctrl/Cmd 再判发送），暂存后焦点留在输入框（＋ 按钮则聚焦新框）。＋ 按钮 tooltip 追加"（Ctrl+Shift+Enter 暂存输入框内容）"，设置页说明与 README 同步。新增运行时用例（空输入框无动作 / 有内容时暂存且不发送 / `enterToSend=true` 下普通 Enter 仍发送 / 关闭功能后不再拦截），测试 76 → 77。
- 悬浮提示词暂存框**支持图片暂存**（用户要求）：条目从纯文本升级为 `{id,text,images}`——＋ 现在把输入框里的文字**与 composer 里的待发送图片一起**存进新暂存框并清空 composer（图片不再只属于输入框）；暂存框行内在文字左侧显示图片缩略图（20px，最多 3 张、更多显示 `+N`，每张缩略图带自己的 `×` 可单独移除），框右侧发送按钮把**文字+图片**作为一条消息提交（`{type:'image',mediaType,data,name}`，与 composer 手发完全一致），发送后该框（连同图片）一起删除；图片随暂存框**持久化到 globalState**（重启/换窗口仍在）。为避免打字时反复搬运 base64：文本防抖上报只发 `{id,text}`，宿主用新增的 `mergePromptStashTexts()` 按 id 合并、保留自己那份图片；新增/删除框与增删图片才整份上报（`images:true`）。旧版纯字符串条目由 `normalizePromptStashEntries()` 自动升级（含 `id:''`，webview 补齐 id 后回写），无需迁移。新增/改写 webview 运行时用例（图片随框持久化、＋ 搬走 composer 图片、发送带 images、缩略图 × 单独移除、打字上报不含图片数据）与 protocol 用例（legacy 升级、图片规整、按 id 合并保图），假 DOM 补 `FileReader` 以覆盖粘贴路径，测试 74 → 76。
- **会话选择框（Sessions 抽屉）每行右侧显示会话模式标签**（用户要求，如"标准模式""PTC 模式"）：显示名优先取 dsh `agentPresets/list` 的名字（自定义 preset 如"锚定标准模式"只有这里有），其次内置 id 的本地化短名（`standard/ptc/code/minimal/cordis`，中英各一套），再退回原始 id；数据取 `agentPreset` 投影（hydrate 首帧也补 `item.agentPreset`，与 `doRefreshSessions` 同规则），没有模式的会话不显示标签；**面板宽度 < 480px 时用 CSS 媒体查询自动隐藏**（宽度足够才显示），标签最多占行宽 45% + 超出省略，不会挤压会话标题；`presets` 消息到达时顺带重绘抽屉，自定义 preset 名字即时生效。新增运行时用例（宿主目录名优先 / 内置本地化 / 无模式不显示 / 只有投影值也能显示 / 切英文后变 `PTC Mode`），并用真实账本核验（98 条会话中 15 条带模式，`anchored-standard` → 锚定标准模式、`standard` → 标准模式）。测试 73 → 74。
- **分支会话/子代理会话可"提升为普通会话"（仅插件视图）**：抽屉子行悬停时出现 **⇧**（提升：在插件抽屉里按顶层行显示）与 **⇩**（恢复层级显示），集合持久化在 globalState（`dsh-vsc.promotedSessions`，`ChatViewProvider.promotedLocally`，hydrate/sessions 帧都带 `promotedLocally` 标记）。之所以是"仅插件视图"：dsh 的谱系只写在创建时的 header（`session/fork` 写 `parentSession`）且**没有任何修改接口**（`session-controller` 只暴露 create/selectModel/rename/fork/prompt/attachment/updateQueue/cancel，全仓无 detach/promote 概念），所以 dsh Web UI 里该会话仍然嵌套显示。改动 src/chat-view.js、src/extension.js、src/webview/script/{01-i18n,03-render}.js；测试假 DOM 顺带升级为"事件冒泡 + `closest()`"（可测事件委托路径），测试 70 → 71。
- 悬浮提示词暂存框的 **＋** 按钮按用户要求移到 composer 行**右侧**（发送 / 模型与权限 / 停止之后，整行最右，运行时不会因 ■ 出现而左右跳动），并在 `tests/webview.test.js` 增加静态 HTML 顺序断言（＋ 必须在输入框/发送/权限/停止右侧）。
- Sessions 抽屉：子代理会话（`origin:'subagent'`）嵌套在父会话下方；归档行新增"取消归档（仅插件视图，↩）"，抽屉标题旁新增"隐藏已归档 / 恢复已归档显示"（本地集合持久化在 globalState，dsh 侧状态不变——上游确实没有 unarchive API）。
- 长会话渲染窗口：详细模式默认只挂载最近 300 条，顶部"显示更早的 N 条"逐步回看。
- 后台任务面板：统计行里的"{n} 个后台任务"可点击展开（label/status/detail，来自 `session/control` 的 jobs 帧）。
- 目标/计划横幅：会话存在 `goal` / `plan` 投影时在聊天区顶部显示目标摘要与计划模式状态。
- ⋯ 菜单新增"在文件管理器中显示"（`session/canOpenWorkspacePath` + `session/openWorkspacePath`）与"打开 preset 目录"（`settings/openAgentPresetDirectory`，内置只读模式会提示改用创造模式）。

### Changed

- 目标横幅改为可关闭、按目标版本重现：新增 × 按钮（宿主按 `objective|phase|roundsStarted|blockedReason` 指纹记录关闭状态），目标更新后自动重新显示；横幅文本单行省略、不再挤占聊天区。
- 长会话改为"宿主裁剪 + 服务端分页"：初始只保留最近 500 条折叠条目（宿主按 `sourceSeq` 裁掉更早事件，不留在内存），webview 去掉"显示更早的 N 条"客户端窗口，只保留一个"加载更早"入口（点击向 dsh 请求更早一页并追加挂载）。
- 性能与资源（都用真实 27,888 条事件的会话量化过）：
  - `foldEvents` 的 `tool/result` 配对从线性 `items.find` 改为 `callId → item` 索引：详细模式折叠 **253ms → 10.1ms/次**（约 25×），流式期间不再阻塞扩展宿主。
  - 无 webview 时不再折叠与推送会话（打开界面由 hydrate 重建），待发队列对 conversation/sessions/stats/queue/models/commands 等同类型消息做"最新快照"合并，修掉后台运行时队列无限增长。
  - 事件缓存改为 LRU（默认保留 6 个会话），浏览大量会话不再让每个会话的完整事件数组常驻内存。
  - `session/follow` 只保留当前会话一条长流（此前每浏览一个会话就常驻一条服务端流）。
  - 重新连接改为 1s→2s→…→15s 指数退避，连接成功即复位。
  - 子进程 stdout/stderr 捕获上限 64KB 且就绪后停止累积。
  - 状态文件（含 launch token）改为 `0600`。
  - webview 附件缓存改为 LRU（最多 40 张），长会话浏览大量图片不再无限增长。
- 会话显示名与 dsh Web 端对齐（列表"编码"一致）：宿主下发 `displayTitle`，规则为 `title` 投影 → 工作目录名 → 会话 id；webview 同步该规则并去掉"会话 1a2b3c4d"短 id 兜底。
- 宿主侧用户可见文案本地化：新增 `src/i18n.js`（中英字典）+ `ChatViewProvider.t()`，折叠笔记（回合结束原因、上下文注入来源标签）、notice、VS Code 对话框与按钮文案全部按 `dsh-vsc.language` 输出；中文分隔符与英文冒号分别处理；新增字典键一致性测试（顺带修掉英文字典缺失 `searchResults` 的漏键）。
- 纯逻辑抽到 `src/protocol.js`（显示名规则、waterfall 应答构造、子代理判定）以便脱离 vscode 单测；移除未被调用的 `SessionService.findWorkspaceById` / `sessionCwd` / `refreshWorkspace`。

### Fixed

- 刷新按钮语义与兜底修正：顶栏 ⟳ 从"仅刷新会话列表"升级为**轻量全量刷新**（会话列表 + 模型目录 + 命令目录 + 工作模式 + 设置快照，不重载会话历史），刷新期间按钮禁用并旋转；`dsh-vsc.refreshSessions` 命令（标题改为 `dsh: Refresh Sessions and Catalogs`）同步该行为。dsh 未就绪或工作区未确定时**不再用空列表覆盖界面**，改为保留现有列表 + 提示"dsh 尚未就绪：已保留当前列表，并重新检测连接"，并自动触发一次连接重探测（仅在非 starting/discovering 状态）。改动 src/chat-view.js（`refreshSessions(userInitiated)` / `refreshAll()`）、src/extension.js、src/webview/script/{01-i18n,04-actions,06-listeners,07-message}.js、src/webview/style.css、src/i18n.js、package.json、README.md。
- 修复点击"加载更早"后消息顺序颠倒、拖到最底部看不到最近内容的问题：整体重建的条件写在 `if (firstRec && …)` 里，只在"首条已有旧节点记录"时才成立；而加载更早是在头部插入**新**条目（首条没有记录）→ 跳过重建 → 新条目被 `appendChild` 追加到旧节点**之后**，DOM 顺序与折叠结果正好相反（最近的消息堆在顶部，底部显示的是最老的一段）。现在只要头部与预期不符（含"首条是新条目"）就整体重建，并在重建前后记录/恢复视口锚点，阅读位置不再跳走；顺带把 note 的合成 seq 改为单调计数器，避免裁剪/分页后 note id 撞车。新增回归测试「prepending older items on "load earlier" keeps DOM order」（已实测该用例在旧代码下失败）。测试 64 → 65。
- 修复 webview 加载期崩溃导致插件"无法使用"的问题（界面停在静态占位：状态点 `stopped`、"正在连接 DeepSeek Harness…"，任何点击都无反应）：`src/webview/script/00-boot.js` 里新增的三个元素查询（`drawerArchivedToggle` / `moreRevealFolderBtn` / `morePresetDirBtn`）被插在 `$` 辅助函数定义**之前**，运行时报 `$ is not a function`，整段 webview 脚本中止——`node --check` 只验语法，抓不到这类错误。已把查询移回其他元素查询处；并新增 **`tests/webview-runtime.test.js`**：在最小假 DOM 中真实执行整段 webview 打包脚本，再派发 hydrate / sessions / conversation / stats / presets / feedback / settingsData / serviceStatus / queue / question / approval 等代表性宿主消息，任何加载期或渲染期异常都会让用例失败（已验证该用例能复现并捕获本次回归）。测试 61 → 62。
- 修复列表显示名与网页不一致的问题（详见 Changed 的 displayTitle 项）。
- 修复无界面时流式会话把整份会话快照每 30ms 压入待发队列导致内存持续增长的问题。
- 设置 → 赞助页新增标语（用户提供文案）："为爱发电，永久免费，如果此插件合您心意，请随意打点。"（`sponsorSlogan` 中英各一键；中文按常见写法把"和您心意"写作"合您心意"，英文对应 "Built for the love of it — free forever. If this extension suits you, feel free to tip whatever you like."），显示在收款码上方、加粗行高 1.6，样式 `.sponsor-slogan`；运行时用例补断言。
- 新增**设置 → 赞助**页（用户要求，收款码由用户提供）：把 `sponsor/wx.jpg`（微信）与 `sponsor/zfb.jpg`（支付宝）整合进设置弹窗，作为一个独立标签页（位于"关于/显示/通用/工作区"之后）；webview 的 CSP 只允许 `data:`/`https:` 图片且没有 `asWebviewUri` 通道，所以 `src/webview.js` 在生成 HTML 时把两张图读成 **data URI 内嵌进脚本**（`var DSH_SPONSOR = {...}`，离线可用、图片缺失时界面降级为"未找到收款码图片"提示），设置页点击图片可在 160px/320px 之间放大还原（方便手机扫码，`classList.toggle('zoomed')`）；新增 i18n 键 6 个（`tabSponsor/sponsorSection/sponsorHint/sponsorWechat/sponsorAlipay/sponsorZoomHint/sponsorMissing`，中英各一套）与 `.sponsor-row/.sponsor-code/.sponsor-label` 样式。测试假 DOM 的 `classList` 升级为读写 `className` 的真实实现（原先全是空函数），新增运行时用例断言赞助页存在、两张图为 `data:image/jpeg;base64,` 且数据确实内嵌（长度 > 1000）、文案为"微信/支付宝"、点击可放大还原，测试 82 → 83。webview HTML 体积 224KB → 387KB（含两张收款码）。
- 解释"隐藏已归档按钮根本无用"（用户报告）：排查确认**按钮与代码都没坏**——该工作区 13 条归档会话**全部**已被"本地恢复显示"（旧版有 bug 的批量"隐藏已归档"把它们一次性写进了 `dsh-vsc.unarchivedSessions`），于是 `effectiveArchivedSet() ∩ 工作区` = 0：**没有一条可切换的归档会话**，开关自然点了没反应（这也解释了按钮上一直没有数量后缀）。已用真实数据核实：`workspace/follow` baseline 确实带 60 条 `archivedSessionIds`、当前工作区 18 条会话里 13 条归档，而截图里可见的"已恢复显示"行正好是其中最新的 4 条（时间正好对得上）。本轮改动：宿主把 `unarchivedLocally.size` 作为 `restoredCount` 随 hydrate/sessions 帧下发，webview 在"可切换数 = 0 但本地显示数 > 0"时给按钮 tooltip 追加说明"本工作区的归档会话都已被'本地恢复显示'，共 N 条，因此这个开关暂时无事可做；可在 设置 → 管理工作区 里点'清除仅插件内显示'"——不再让人以为按钮坏了，并直接指向清理入口（上一轮已加的批量清除按钮）。新增运行时用例（tooltip 带原因与清理入口、清掉后恢复带数量的正常文案），测试 81 → 82。
- 会话列表改为按**最近修改时间**排序（用户要求："会话排序应该按照最近修改时间排序"）：排查发现 dsh `session/list` 的 `updatedAt` 只等于 `max(header.createdAt, sessionListMetadata.lastPromptAt)`（`packages/api/session-controller/src/list.ts`，投影里也只有 `lastPromptAt`），**"模型输出/工具调用"这类修改不体现在列表里**，所以会话一旦发完提示词就停在原地、相对时间也停在那一刻。插件现在自记"活动时间"（单调递增，近 2000 条）：`$events` 的 `api-session/activity`（参数就是 `[sessionId, event.time]`，此前被丢弃）、`api-session/status` 的开始/结束运行（记 `now`，即一轮工作开始/结束都算修改）、当前会话 `session/follow` 每来一条新事件的事件时间；新增纯函数 `protocol.applySessionActivity()` 把两者取 max 后**稳定降序重排**（时间相同保持 dsh 原顺序），`hydrate` 与 `sessions` 帧都走它——排序与相对时间（"刚刚/N 分钟前"）因此同步更新。新增 protocol 用例 4 组断言与宿主 vscode-stub 冒烟（基线 dsh 顺序 → 收到提示词活动时间后该会话置顶 → 开始运行后置顶且时间≈now），测试 80 → 81。
- 澄清并管理"仅插件内显示"的会话（用户提问"这些仅插件视图的会话是什么？为什么我在 web 端看不到？"）：它们就是 **dsh 里已归档的会话**——dsh 只有 `workspace/archiveSession`、没有取消归档接口，网页端还会用 `archivedSessionIds` 把归档会话**直接从会话树里过滤掉**（`client/ui-workspace/src/client/tree.ts` 的 `groupByWorkspace(..., archived, ...)`），所以网页端根本看不到；插件为它们实现了**仅插件视图**的本地"取消归档"（globalState 集合）。本轮：① 行内标签从"已恢复显示（仅插件视图）"改为自解释的"**已归档会话（仅插件内显示）**"并给该行 meta 加 tooltip（说明 dsh 侧仍是归档、网页端仍看不到）；② 修复 `↪ 重新隐藏` 在真实数据下**从不显示**的 bug——宿主对本地恢复的会话下发 `archived:false`（`effectiveArchivedSet` 已排除），旧判断 `s.archived && s.restoredLocally` 永不成立，现改为只看 `restoredLocally`；③ 设置 → 管理工作区新增一键清理"**清除"仅插件内显示"（N）**"（新消息 `clearRestoredSessions` → `clearRestoredSessions()`：清空集合 + 持久化 + 刷新 + 提示），用于撤销旧版"隐藏已归档"按钮把全部归档会话写进本地集合留下的痕迹（用户当前工作区里就有 4 条）。新增运行时用例（设置页按钮的出现/文案/点击/清除后消失）与宿主 vscode-stub 冒烟（2 条本地恢复 → 清除后列表只剩 1 条、`archivedAvailable` 0 → 2、落盘 `[]`、提示文案），测试 79 → 80。
- 修复"显示已归档 / 隐藏已归档"看起来不起作用的问题（用户报告）：按钮与状态本身没坏，坏在**效果不可见**——归档会话按时间序排在列表**末尾**（用户工作区 18 条里 13 条已归档，且都是较老的），点开"显示已归档"后那 13 行被追加在滚动区下方，视口顶部一模一样，于是"点了没反应"。现在：① 按钮文案带上数量"显示已归档（13）/ 隐藏已归档（13）"（宿主新增 `SessionService.archivedCountInWorkspace()`，hydrate 与 sessions 帧下发 `archivedAvailable`），点之前就知道会出现多少条；② 归档会话单独成组——活动会话之后插入"已归档（N）"分区标题再列归档行（子代理谱系在各自组内递归，本地"取消归档"过的行归入活动组），滚动到末尾即可看清归属；③ 从"不显示"切到"显示"时抽屉自动滚到归档分区，本次点击的效果立刻可见；④ `setShowArchivedSessions()` 改为**先刷界面、再写配置**并把写配置失败降级为日志——旧顺序在远程/只读设置下 `config.update` 抛错会让按钮看起来完全没反应。新增/改写运行时用例（按钮文案含数量、归零后无括号、归档分区标题与分组顺序、关闭后无分区），并用真实账本核验（18 条工作区会话 = 4 活动 + 13 归档，分区标题"已归档（13）"位置正确），测试 77 → 78。
- 修复抽屉"已归档"按钮语义反了、点到第二次就再也隐藏不了的问题（用户报告）：旧实现把文案绑在"本地取消归档集合大小"上（`archivedLocalCount > 0` → 文案"恢复已归档显示"），点击又发 `hideArchivedView{hidden: !(count>0)}` 去批量改写本地集合，于是**文案与真实状态相反**（默认不显示归档时反而写着"隐藏已归档"），且第一次点击实际效果是"显示"，之后又与设置项 `dsh-vsc.showArchivedSessions` 互相干扰，表现为"再次点击无法隐藏"。现在按钮与设置项共用同一个状态源：`state.showArchivedSessions === true` → 按钮写"隐藏已归档"（点击把配置写为 false），否则写"显示已归档"（点击写为 true），可反复切换并跨重启保留。顺带把"取消归档（仅插件视图，↩）"做成可见且可逆：行 meta 增加"已恢复显示（仅插件视图）"，已恢复的行给出反向操作 `↪ 重新隐藏（仅插件视图）`（新消息 `unrestoreSession` + `unrestoreArchivedSession()`）；删除失效的 `hideArchivedView` 消息、`setArchivedViewHidden()` 批量方法与废弃的 `archivedLocalCount` 字段。新增 2 个运行时用例（按钮文案与往复切换、归档行的本地恢复与反向隐藏；已实测文案写反时用例失败），测试 71 → 73。
- 修复 Sessions 抽屉把 fork 出来的会话误标成"子代理会话"、且"fork 的 fork"（孙代）整行消失的问题（用户提问"这里为什么是子代理会话？"）：dsh 的 `session/fork` 给子会话写的是 `parentSession`（列表里即 `parentSessionId`）——**和子代理会话用的是同一个字段**，只有子代理带 `origin:'subagent'`（`session-controller/src/list.ts` 的 `listFields`；已用真实实例核对：98 条会话里 10 条 fork/派生会话 origin 为空、8 条子代理带 origin）。旧实现按 `parentSessionId` 嵌套后一律硬标"子代理会话"，且只渲染一层，导致父会话是被 fork 出来的会话时其子行整行不显示。现在按 dsh 网页端 `flattenLineage` 的规则递归展平谱系（父不在列表的"孤儿"降级为 root 不丢弃、环状引用用 visited 兜底、缩进按 depth 内联到 `padding-left`），并按来源区分标签与能力：`origin:'subagent'` 仍是"子代理会话"（仅可选中）；其余带父会话的按普通会话处理（保留 fork/重命名/归档）并标注新增文案"分支会话 / Forked session"。真实账本核验：98 行全部渲染（旧实现丢 4 行孙代 fork）、0 行标签不符。新增 webview 运行时回归用例（已实测在旧标签逻辑下失败），测试 68 → 69。
- 修掉输入法组字误发送：composer 输入框与新的暂存框在 `Enter` 处理中跳过 `event.isComposing`（中文/日文输入法按 Enter 确认候选词时不再被当成"发送"）。
- 修复"取消归档 / 隐藏已归档"实际没有持久化的问题：`ChatViewProvider.persistUnarchived()` 读取的 `this.options` 从未被赋值（构造函数只解构了单个字段），每次调用都抛 `TypeError` 并被 catch 成一条日志——表现为重启 VS Code 后本地取消归档的会话又回到归档列表。现在构造函数保留 `options` 引用；并顺手删除 `handleMessage` 里调用已不存在的 `setAutoOpenChat` 的死分支。
- 测试假 DOM 升级为可交互子集（`tests/helpers/fake-dom.js`）：`addEventListener`/`click()`/`dispatchEvent` 真正派发、`innerHTML = ''` 会清空子节点、支持 `document.activeElement`（`focus()` 记录焦点）；新增 2 个悬浮暂存框运行时用例（渲染/上限/发送/Enter/移除/开关/待回答问题收起/hydrate 不覆盖正在输入的内容）与 `normalizePromptStashItems` 用例，测试 65 → 68。

- 启动行为措辞与风险提示：`dsh-vsc.autoStart` 由"启动 VS Code 时自动启动 dsh web"改为"**启动插件时自动启动 dsh 后端**"（中英文设置项标签、配置项 description、README 同步）；设置面板勾选该选项时显示警告"自动启动的 dsh 后端可能会导致 session 冲突，请谨慎使用。"，并在"启动行为"分区常驻提示"推荐手动启动 dsh 后端服务。"（新增 `autoStartWarning` / `autoStartRecommended` 文案与 `.warn` 样式）；README 的"dsh 实例生命周期管理"（中英文）同步改写：说明自动启动的后端与手动后端并存可能造成 session 冲突、推荐手动启动。改动 src/webview/script/01-i18n.js、src/webview/script/05-settings.js、src/webview/style.css、package.json、README.md。

### Removed

- 移除助手消息下方的"有帮助 / 没帮助"按钮（用户要求）：同时清理宿主侧的整套反馈管线——`messageFeedback/list|put|delete` 调用、`feedbackBySession` 快照与每会话拉取、`feedback/record` 事件分支、`feedback` 消息与 hydrate 字段、折叠产物里的 `messageId`、相关 i18n 文案与 `.msg-feedback` 样式，避免"按钮没了但每个会话仍白拉一次反馈"的浪费。
- 移除"启动时自动打开 dsh 面板"功能（用户反馈该行为失效且非核心）：删除 `dsh-vsc.autoOpenChat` 配置项、webview 设置项、`workspaceState` 的"上次关闭过面板"标记与 `maybeAutoOpen()` 三重条件判定；工作区面板现在只在用户点击侧边栏入口或工作区右上角 `dsh` 按钮时打开（启动时的后台初始化仍照常连接 dsh 并加载工作区/会话）。改动 src/extension.js、src/chat-view.js、src/webview/script/{00-boot,01-i18n,05-settings,07-message}.js、package.json、README.md。

### Fixed

- 修复详细模式下"上下文注入没有相应条目"的问题：折叠器此前只保留**最后一条**注入（`lastContextIndex` 过滤），而 0.1.5 的注入量很大（AGENTS.md 指令、插件注入、会话引用、技能内容等，实测某会话 38 条），窗口内看不到最新一条时整段历史就一条都不显示。现在详细模式**逐条保留**上下文注入条目（按 `source.kind` + 正文去重，完全相同的重复注入只保留一条），简洁模式仍隐藏并置"有隐藏详情"标记；摘要跳过 `<system-reminder>` 这类包裹标签行，取第一条有效内容，取不到时按来源标注（如"上下文注入：项目指令"）。改动 src/conversation.js、tests/conversation.test.js（1.1.2 累计测试 40 → 52，本次 +2）。
- 修复 dsh 0.1.5 下所有 `/` 命令执行必然失败的问题：`commands/execute` 的附件参数已由 `images` 改名 `submittedAttachments`（`CommandSubmitAttachment`，`{type:'image',mediaType,data,name?}` 或 `{type:'file',receiptId}`），旧参数会被网关以 `missing "submittedAttachments"; unexpected "images"` 直接拒绝——`/permission`、`/compact`、`/model` 等全部命令都受影响。插件新增 `normalizeCommandAttachments()` 归一化 webview 传入的图片对象，并把 `commands/execute` 返回的 `{commandId,result}` 错误结果即时提示；命令目录"可带附件"标志也从 `input.images` 修正为 `input.attachments`。
- 修复问题与审批应答在 0.1.5 下结构不合法的问题：waterfall 返回值就是业务答案本身，`user-questions/request` 需要 `AskUserQuestionAnswer`（`{answers:[{id,selected,custom?}]}`）、`approval/request` 需要 `ApprovalOutcome`（`'allowed-once'|'rejected'`），不再多包一层 `{sessionId, answer}` / `{sessionId, approvalId, outcome}`。

## [1.1.1]

（2026-09-06 由用户发布。）

### Fixed

- 修复新会话"选择工作模式"点击后无反馈（选中态不更新）的问题：rc.1 的 `session/list` 不返回 `agentPreset`，而工作模式卡片的选中态此前只依赖该字段——`agentPresets/select` 实际成功但界面始终不显示选中。修复：宿主新增 `agentPresetBySession` 记录（来自 `session/create` 结果、`agentPresets/select` 成功回调与 `$events` 的 `agent-preset/selected` `[sessionId, presetId]` 帧），`doRefreshSessions` 把记录合并回会话条目；webview 卡片点击改为乐观选中并立即重绘（宿主确认后以 sessions 帧为准）；选择失败弹提示而非静默。改动 src/chat-view.js、src/webview/script/03-render.js、README.md。

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
