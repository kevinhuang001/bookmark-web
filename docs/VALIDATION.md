# 验证

## 自动化检查

- `npm run check`：应用、扩展和脚本语法。
- `npm test`：URL 识别、资源图、预算拒绝、并发上限、共享预算门、媒体隔离与 HLS 点播。
- `cargo test --locked --manifest-path core/Cargo.toml`：权限、持久化、搜索、标签、偏好范围、单份内容存储与 WebDAV 同步。
- `npm run test:e2e`：网页与选区、结构化帖子、头像、评论、全局与站内搜索、目录、标签选择、删除、分组设置、空文件夹取消、沉浸阅读和媒体播放。
- `node tests/extension.e2e.mjs`：安装真实 Chromium MV3 扩展，配对并向生产 Rust 后端保存网页及 X 讨论，验证客户端关闭后停用。
- `node tests/firefox.e2e.mjs`：Firefox 捕获引擎与清单；不代表已安装附加组件测试。
- 三平台构建：macOS 通用 DMG、Windows EXE / MSI、Linux AppImage / DEB。

CI 在浏览器测试中设置 `GLASSMARK_BRIDGE_BIN`，使用生产 Rust 服务。没有该参数的本地前端测试使用开发服务，报告明确标记 `fixture-bridge`。

## 结果

[Actions](https://github.com/kevinhuang001/bookmark-web/actions) 保存每次提交的检查结果。每个成功发布版本附带 `e2e-report.json`、`extension-report.json`、`firefox-report.json` 和 `SHA256SUMS.txt`。

## 实机验收

1. 安装客户端与扩展，在分组设置中配对。
2. 空名称打开新建文件夹，验证关闭、取消、Esc 和遮罩关闭。
3. 在设置中修改并发、MB 上限、帖子数量与自动加载时间，检查下一次任务使用新配置。
4. 收藏带作者头像、GIF、图片和视频的真实页面，断网验证媒体与正文。
5. 对真实 X / Reddit 登录会话收藏主帖和已加载评论，核对实际保存数量、取消、立即保存及错误报告。
6. 在网页中验证阅读区占满，元数据只显示于顶部面包屑旁。
7. 在网页工具栏和帖子菜单删除内容，检查搜索与其他设备同步移除。
8. 在 Windows/macOS 实机检查圆角、底层玻璃与拖动。浏览器录屏不能验证系统合成器的原生外形。

浏览器回归使用固定测试页面，不代替不断变化的真实站点登录会话。视频支持直接媒体及有限、未加密 HLS；不支持直播、DRM 或没有可下载地址的 blob 内容。
