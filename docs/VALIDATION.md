# 验收与验证

## 自动化检查

| 检查 | 环境与范围 |
| --- | --- |
| `npm run check` | 所有应用、扩展和脚本的 JavaScript 语法 |
| `npm test` | 15 项归档、平台归类、依赖下载、预算及媒体隔离单元测试 |
| `cargo test --manifest-path core/Cargo.toml` | Rust 持久化、配对、搜索、路径边界及 WebDAV 双目录同步 |
| `cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings` | 后端静态检查 |
| `npm run test:e2e` | 配对与授权、整页与选区、X 虚拟滚动、Reddit 108 条已保存评论的完整显示、目录文件、拖动、中文搜索、标签、站点书签导航与搜索、居中预览、脚本和网络隔离 |
| `node tests/extension.e2e.mjs` | 安装 Chromium MV3 扩展，连接原生 Rust 服务，捕获、上传并验证客户端关闭后停用 |
| `node tests/firefox.e2e.mjs` | Firefox 捕获引擎与扩展清单；不包含已安装 Firefox 附加组件的测试 |
| 三平台 Tauri 构建 | Windows x64 EXE/MSI、Linux x64 AppImage/DEB、macOS Apple Silicon + Intel 通用 DMG |

完整运行记录见 [Actions](https://github.com/kevinhuang001/bookmark-web/actions)。每个发布版本附有 `e2e-report.json`、`extension-report.json`、`firefox-report.json` 以及 `SHA256SUMS.txt`；`e2e-report.json` 中的 `backend: native-rust` 表示该次测试使用真实 Rust 后端。

本地可设置 `GLASSMARK_PORTABLE_CHROMIUM=1` 运行同一套界面检查；没有 `GLASSMARK_BRIDGE_BIN` 时使用开发测试服务，报告标识 `fixture-bridge`。CI 为浏览器测试设置真实 bridge 路径。

## 评论保存范围

X 默认收集主帖和最多 100 条帖子／回复，可在扩展进度页继续收集。Reddit 保存主帖和当前已加载的全部评论。客户端详情页显示本次归档中的全部回复／评论，并显示实际保存条数。测试覆盖超过 100 条已保存评论时的数量、最后一条可见性和详情返回。

## 桌面实机验收

1. 安装对应平台的发布包并配对浏览器扩展。
2. 关闭客户端，确认扩展不能收藏；重新启动后检查恢复。
3. 对真实网页完成整页和多区域收藏，断网检查排版、媒体和目录操作。
4. 在真实 X / Reddit 登录会话收藏帖子，核对已加载范围、归档报告、讨论详情和原始快照。
5. 在 macOS 26 检查 Liquid Glass、Windows 检查 Mica/Acrylic、Linux 检查回退视觉和窗口操作。
6. 在两个设备配置测试 WebDAV，验证增量同步、标签、文件夹、删除及离线冲突合并。

构建和自动化检查不替代真实站点登录会话与各操作系统上的视觉验收。演示素材来自 `tests/fixtures/`，录屏标注测试服务与原生运行范围。
