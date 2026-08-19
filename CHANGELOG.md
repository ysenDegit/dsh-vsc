# Changelog

本文件记录 dsh-vsc-weblike 的版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

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
