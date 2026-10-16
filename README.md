# Glassmark

把值得回看的网页，留在自己的电脑里。

Glassmark 是一个 Tauri 2 桌面客户端与 Chromium / Firefox 浏览器扩展。客户端采用 macOS 26 Liquid Glass 风格：左侧独立设置 X（Twitter）、Reddit 和网页入口；网页使用文件夹树与原始快照，X 和 Reddit 分别使用官网风格的信息流与讨论详情。目标桌面平台为 Windows、macOS 和 Linux。

**项目状态：初始实现。** 本地已通过 15 项 JavaScript 单元测试与 21 项浏览器端到端检查。当前环境没有可用的现代 Rust 工具链或完整 Firefox，尚未执行原生构建、真实扩展安装与 WebDAV 原生集成测试。相应检查已加入 GitHub Actions；在 Actions 运行完成前，不应视为已通过。详见 [验证记录](docs/VALIDATION.md)。

## 功能

- X（兼容 twitter.com）与 Reddit 独立归档入口。X 只显示书签信息流、帖子详情、回复与作者筛选；Reddit 只显示已保存信息流、评论树、社区筛选和本地排序。均移除首页、探索、账号区及推荐栏。
- 普通网页作为文件直接嵌入文件夹树，子目录及其文件可一起折叠；没有独立的收藏卡片列表。搜索结果保留原来的目录层级。
- 低透明度玻璃侧栏有背景透射、模糊、高光与描边。macOS 26 使用 Liquid Glass Clear，较旧 macOS 回退 Sidebar；Windows 使用 Mica/Acrylic；Linux 和浏览器预览以应用内场景做跨平台回退。原生材质尚未在真实系统运行验证。

- 收藏整个网页，或通过悬停高亮、上下方向键调整父子元素、点击选择多个区域，将选区合并为一份收藏。
- 为当前渲染的元素保存计算样式、伪元素、开放 Shadow DOM、可读取的画布与已加载字体；另存 HTML 源码、外部 CSS/JS 和资源清单。
- X 讨论串自动滚动收集，默认最多 100 条。收集时立即序列化，保留随后被虚拟列表卸载的帖子；可继续收集至 200、300 条，每次新增一份收藏。
- Reddit 收藏主帖与当前已加载的评论，保留原站视觉样式及评论层次，不主动展开折叠评论。
- 图片、GIF、直接媒体资源尝试下载；单次累计下载超过 500 MiB 时询问是否再放行 500 MiB。
- 客户端未运行、未配对或连接失败时，扩展停用收藏操作，不建立待发送队列。
- 文件夹与子文件夹、拖动归类、标签和全文搜索。中文短词可以搜索；较长词使用 SQLite FTS5 trigram 索引。
- 同一网址重复收藏始终生成新的 UUID，不覆盖先前收藏。
- WebDAV 自动同步：启动时、修改后和每分钟执行。远端使用普通 HTML、JSON 和媒体文件，不做端到端加密。

## 本地开发

需要 Node.js 22+、Python 3（扩展 ZIP 打包）和现代稳定版 Rust。原生平台依赖请按 [Tauri 官方指南](https://v2.tauri.app/start/prerequisites/) 安装。

```sh
npm ci
npm run desktop
```

Linux 需要 WebKitGTK 4.1 开发包。Windows 需要 MSVC 构建工具和 WebView2。macOS 需要 Xcode Command Line Tools。

仅预览界面与开发测试服务：

```sh
npm run build
npm run dev -- --demo
```

打开 `http://localhost:1420`。该模式在控制台明确标记 `DEMO`，数据存放于 `.test-data/demo`；它不运行原生 Rust 后端，也不执行 WebDAV 同步。原生开发模式由 Tauri 启动前端与 Rust 服务。

## 安装浏览器扩展

```sh
npm run build
```

- Chromium / Chrome / Edge：打开扩展管理页，启用开发者模式，选择“加载已解压的扩展程序”，指向 `dist/extension-chromium`。
- Firefox：打开 `about:debugging#/runtime/this-firefox`，选择“临时载入附加组件”，打开 `dist/extension-firefox/manifest.json`。
- `dist/glassmark-chromium.zip` 和 `dist/glassmark-firefox.zip` 是扩展打包产物。Firefox 持久安装需要 Mozilla 签名；这里的 ZIP 尚未签名或上架。

先运行客户端，打开“连接与同步”，将六位配对码输入扩展。配对码有效期五分钟、最多五次尝试，成功后立即轮换；可在客户端撤销浏览器配对。

扩展需要网页访问权限来读取用户选中的 DOM，以及下载页面引用的跨域资源。仅在用户发起收藏后注入捕获脚本，不自动遍历浏览记录。

## 收藏与阅读

在需要收藏的页面打开插件，选择整页、多个区域或讨论串。区域选择中，点击添加或移除区域，↑/↓ 调整当前指向的父子元素，Esc 取消。选择重叠区域时保留较新的范围，避免重复内容。

捕获过程中会打开独立的扩展进度页。请保留此页与来源页，直到发送完成。下载失败、流式媒体及站点范围信息会出现在归档报告中。单次超出资源数量或元素数量上限时会报告原因。

客户端侧栏分为 X、Reddit 和网页。X 与 Reddit 直接打开书签／已保存信息流，点击帖子可看已收藏的讨论，详情页可切换原始快照。网页作为文件夹下的文件显示，点击文件在右侧预览，可创建文件夹及子文件夹、折叠目录树、拖动归类，或通过工具栏编辑标签。左侧搜索覆盖标题、正文、网址及标签。网页右侧显示原站快照；社交信息流只使用已归档的正文和媒体。原始脚本保存在源码归档中，不在阅读器运行。

## WebDAV

在“连接与同步”中填写服务器目录、用户名和密码/应用密码，启用自动同步并保存。使用 HTTPS；HTTP 仅允许本机测试地址。服务器需支持 `MKCOL`、`PUT`、`HEAD`、`GET`、`PROPFIND Depth: 1` 及条件写入。

Glassmark 仅操作该目录下的 `glassmark/` 子目录。普通网页阅读器可以直接打开远端的 `archives/<id>/snapshot.html`；相对路径引用 `assets/` 中的文件。`source.html` 是包含原始脚本的源码，请将其作为源码检查，而非受信任程序运行。

同步以不可变的 revision JSON 为提交标志，先传文件，再提交事件。并发修改不会覆盖远端事件文件；元数据视图采用时间戳和 UUID 的确定性排序，所有历史 revision 仍保留。设备时钟应保持同步。删除通过墓碑同步，归档文件暂时保留，以便离线设备合并。

WebDAV 上的收藏可直接读取，也意味着服务器管理者能看到这些内容。服务器密码只保存在本机应用数据目录的配置文件中，不上传到 WebDAV；当前未集成系统钥匙串。

## 测试与构建

```sh
npm run check
npm test
npm run build
cargo test --manifest-path core/Cargo.toml
cargo build --manifest-path core/Cargo.toml --bin glassmark-bridge
npx playwright install --with-deps chromium firefox
```

生产 Rust 服务端到端测试（Linux/macOS）：

```sh
GLASSMARK_BRIDGE_BIN=core/target/debug/glassmark-bridge npm run test:e2e
GLASSMARK_BRIDGE_BIN=core/target/debug/glassmark-bridge node tests/extension.e2e.mjs
node tests/firefox.e2e.mjs
```

不设置 `GLASSMARK_BRIDGE_BIN` 时，第一条端到端测试使用明确标记的开发替代服务。它验证捕获引擎和前端，不替代原生后端测试。`extension.e2e.mjs` 使用真正安装的 Chromium MV3 扩展；Firefox 测试覆盖其渲染引擎和清单，不是附加组件安装测试。

桌面安装包：

```sh
npm run tauri -- build
```

GitHub Actions 同时进行 Rust 单元/集成测试、JavaScript 测试、生产后端 E2E、真实 Chromium 扩展测试、Firefox 捕获测试及三平台桌面构建。产物从 Actions 的 Artifacts 下载。初始构建未配置 Apple 公证、Windows 代码签名或扩展商店签名。

## 保存范围

快照冻结的是用户当前能看到、已加载的网页内容，而不是整个网站的服务端状态。外部资源下载采用独立请求并记录结果：

- 不保存 Cookie、浏览器登录数据库或会话凭据；需要 Cookie 才能访问的资源可能失败。
- 静态引用与可识别的 CSS/JS 导入会递归归档；运行时生成的模块地址、服务端 API、未加载内容及闭合 Shadow DOM 不保证完整。
- 跨域 iframe 不展开；请单独打开其中的页面收藏。
- 直接视频尝试下载；MSE/blob、HLS/DASH 分片和 DRM 视频不保证可离线播放，报告会说明范围。
- X / Reddit 适配器基于页面 DOM，其结构变化、登录墙、排序和回复折叠会影响收集结果。没有绕过访问限制，也没有声称已在真实登录会话验证。
- 阅读器屏蔽脚本、网络访问、表单和站内导航。选择“保存源码”不代表原网站交互可以离线重放。

## 项目结构

| 路径                       | 职责                                                    |
| -------------------------- | ------------------------------------------------------- |
| `app/`                     | 平台导航、X/Reddit 信息流、预览隔离、文件夹、标签、设置 |
| `extension/src/capture/`   | DOM 序列化、X/Reddit 适配与分批收集                     |
| `extension/src/picker.js`  | 多区域选择与范围调整                                    |
| `extension/src/archive.js` | 下载预算、资源依赖与归档重写                            |
| `extension/src/pages/`     | 配对弹窗与持久捕获进度页                                |
| `core/src/store.rs`        | 归档文件、revision 事件、SQLite/FTS5                    |
| `core/src/lib.rs`          | 本地桥接 API、配对、授权与通信边界                      |
| `core/src/sync.rs`         | WebDAV 上传、拉取、校验与增量状态                       |
| `src-tauri/`               | 原生窗口、受限 IPC 及平台打包                           |
| `scripts/`                 | 构建、开发服务及显式的测试替代服务                      |
| `tests/`、`core/tests/`    | 单元测试、浏览器 E2E 与 WebDAV 集成测试                 |

更多细节：[架构与数据格式](docs/ARCHITECTURE.md) · [验收与验证](docs/VALIDATION.md) · [贡献指南](CONTRIBUTING.md)。

MIT License。测试场景中的人物、文章、讨论及站点内容均为本项目构造的演示素材。

## 0.2 界面调整

X 与 Reddit 的信息流重现各站的布局、字号层次、交互图标、帖子媒体和讨论结构，不再把社交帖子当作普通网页列表中的条目。作者、计数和媒体取自收藏，不请求实时信息流。分享复制原始链接；X 的喜欢标记仅写入本地标签，不向原站点赞。

透明窗口使用 Tauri 2.12.1+，配置 `transparent`、透明背景和 `liquidGlassClear` / `sidebar` / `mica` / `acrylic` 平台材质。浏览器演示中的底图用于观察玻璃透射；不能用浏览器录屏代替原生材质验收。
