# 验证

## 自动化检查

- `npm run check`：应用、扩展和脚本语法。
- `npm test`：URL 识别、资源图、预算拒绝、并发上限、共享预算门、媒体隔离与 HLS 点播。
- `cargo test --locked --manifest-path core/Cargo.toml`：权限、持久化、搜索、标签、偏好范围、单份内容存储与 WebDAV 同步。
- `npm run test:e2e`：网页与选区、结构化帖子、头像、评论、全局与站内搜索、目录、标签选择、删除、分组设置、空文件夹取消、沉浸阅读和媒体播放。
- `node tests/extension.e2e.mjs`：安装真实 Chromium MV3 扩展，配对并向生产 Rust 后端保存网页及 X 讨论，验证客户端关闭后停用。
- `node tests/firefox.e2e.mjs`：Firefox 捕获引擎与清单。
- `node tests/firefox-extension.e2e.mjs`：真实安装 Firefox 附加组件，验证配对、捕获和原生持久化；需要 geckodriver。
- `node tests/media-capture.e2e.mjs`：仅挂载一张图片的虚拟轮播、起始位置恢复、页面媒体清单、视频独立来源和 X 父帖元数据。
- `node tests/social-interactions.e2e.mjs`：四个平台原地展开评论、96 像素缩略图、放大后图片切换及实际视频播放，检查 X 父子回复连线。
- 三平台构建：macOS 通用 DMG、Windows EXE / MSI、Linux AppImage / DEB / RPM / Arch `.pkg.tar.zst`。

CI 在浏览器测试中设置 `GLASSMARK_BRIDGE_BIN`，使用生产 Rust 服务。没有该参数的本地前端测试使用开发服务，报告明确标记 `fixture-bridge`。

## 结果

[Actions](https://github.com/kevinhuang001/bookmark-web/actions) 保存每次提交的检查结果。每次成功发布的测试报告 `e2e-report.json`、`extension-report.json`、`firefox-report.json` 保留于对应 CI 的 `test-reports-and-extensions` 附件。Release 只附带安装包、扩展 ZIP 与 `SHA256SUMS.txt`，不展示 JSON 报告。

## 实机验收

1. 安装客户端与扩展，在分组设置中配对。
2. 空名称打开新建文件夹，验证关闭、取消、Esc 和遮罩关闭。
3. 在设置中修改并发、MB 上限、帖子数量与自动加载时间，检查下一次任务使用新配置。
4. 收藏带作者头像、GIF、图片和视频的真实页面，断网验证媒体与正文。
5. 对真实 X / Reddit / 小红书 / 知乎登录会话收藏主帖和已加载评论，核对实际保存数量、取消、立即保存及错误报告。
6. 在网页中验证阅读区占满，元数据只显示于顶部面包屑旁。
7. 在网页工具栏和帖子菜单删除内容，检查搜索与其他设备同步移除。
8. 在 Windows/macOS 实机检查圆角、底层玻璃与拖动。浏览器录屏不能验证系统合成器的原生外形。

浏览器回归使用固定测试页面，不代替不断变化的真实站点登录会话。视频支持直接媒体及有限、未加密 HLS；不支持直播、DRM 或没有可下载地址的 blob 内容。

知乎固定页面回归验证回答独立 URL、专栏文章、嵌套已加载评论、原图归档、推荐回答隔离、搜索复位和 Esc 返回。原生圆角同时裁切 AppKit 共同父视图与 HTML；最大化/全屏时随窗口状态更新。需在 macOS 实机核验系统磨砂层与阴影。

Linux CI 使用 makepkg 生成 Arch 包并在 Arch 容器安装、核验动态依赖与二进制一致性；RPM 在 Fedora 容器安装并检查动态依赖；DEB 查询元数据和文件清单。容器检查不等同于各发行版真实桌面 GUI 验收。

网页缩放回归覆盖工具栏调整、50% / 200% 边界、重载后的比例恢复及焦点在沙盒页面内的快捷键还原。

WebDAV 回归覆盖三设备离线分支、标签合并、删除/编辑冲突、重启恢复、过期处理请求、时间逆序、远端事件同名异内容及 HTTP 409 写入保护。X 回归覆盖四图双视频、各播放器独立 HLS 源、延迟媒体补全、一个 URL 一个主帖、前置帖子/广告排除和信息流拒绝。冲突 UI 回归采用响应夹具，验证冲突只出现在 WebDAV 卡片内；真实因果合并和 WebDAV 传输由 Rust 集成测试验证。真实安装的 Chromium 扩展还会保存四张页面未完整挂载的图片和两个独立视频，并逐个核验原生归档文件存在。

设置回归覆盖：取消独立 enabled 开关，所选同步方式决定运行目标；本地仅显示路径，WebDAV 包含周期、立即同步和冲突。Rust 验证未配置目的地不执行同步、本地轮询与 WebDAV 周期互不混用；桌面和小窗口核对各设置分类的横向溢出及页脚可达性。
