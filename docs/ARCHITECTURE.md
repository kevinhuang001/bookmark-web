# 架构

## 模块

| 路径                       | 职责                                   |
| -------------------------- | -------------------------------------- |
| `app/main.js`              | 目录、全局搜索、收藏选择、标签与删除   |
| `app/settings.js`          | 分组偏好设置与连接管理                 |
| `app/social.js`            | X / Reddit 信息流、帖子和评论          |
| `app/preview.js`           | 安全呈现单份网页内容                   |
| `app/media.js`             | 本地媒体与离线 HLS 播放                |
| `extension/src/context.js` | URL 识别与帖子范围                     |
| `extension/src/capture/`   | 网页内容序列化、帖子结构提取与媒体发现 |
| `extension/src/archive.js` | 并发资源队列、共享预算、内容寻址       |
| `extension/src/pages/`     | 扩展弹窗与任务进度                     |
| `core/src/store.rs`        | SQLite 索引、不可变事件、内容文件      |
| `core/src/preferences.rs`  | 偏好默认值、验证、持久化               |
| `core/src/sync.rs`         | WebDAV 事件与内容同步                  |
| `src-tauri/`               | 桌面进程、系统窗口与玻璃材质           |

## 收藏流程

扩展识别当前 URL，读取客户端保存位置、标签目录和偏好。帖子只提取结构化正文、评论和媒体；网页逐节点读取计算样式并形成一份用于阅读的内容文件。

帖子加载期间保持来源页激活，避免后台页面的计时器节流与虚拟列表暂停。页面内浮层显示进度，支持保存已加载内容与取消。X 达到设置的条数、加载时长或无新增内容后结束；Reddit 不请求尚未加载的评论。

媒体队列默认运行 6 个异步下载任务。每个 HTTP 响应按流读取，通过串行预算门逐块计费；同时超过预算的任务共用一次询问。CSS 与 HLS 新发现的依赖加入同一队列，URL 去重，资源数量受配置限制。下载内容用 SHA256 命名后上传本机服务。

服务端确认资源已上传后，为网页写入 `content.html`，为全部收藏写入包含正文 / 评论及资源记录的 `manifest.json`。提交不可变 revision 后更新 SQLite 文档和全文索引。每次收藏有独立 UUID。

## 本机 API

服务仅监听 `127.0.0.1:47831`，验证 Host、Origin 与 Bearer 凭证。桌面凭证随进程更新，浏览器设备凭证独立撤销。配对码 5 分钟有效并限制尝试次数。

| API                              | 桌面 | 配对扩展 |
| -------------------------------- | ---- | -------- |
| `GET /api/status`                | 是   | 是       |
| `GET /api/capture-options`       | 是   | 是       |
| `PUT /api/blobs/<name>`          | 是   | 是       |
| `POST /api/items`                | 是   | 是       |
| `GET /api/items`、内容与资源读取 | 是   | 否       |
| 标签、目录、偏好及同步配置管理   | 是   | 否       |

`capture-options` 只提供目录名称、标签和收藏偏好，不返回已有正文、设备凭证或 WebDAV 账号。

## 文件与索引

SQLite 存储文档、设备凭证、同步记录与 FTS5 trigram 索引。正文至少三个字符的搜索通过全文索引检索，短词保留子串匹配。

不可变事件是可恢复的元数据来源。启动时重放事件，以 revision 顺序生成一致结果。删除提交 tombstone，从列表与搜索中移除；通过 WebDAV 传播。

普通网页包含一份 `content.html` 与媒体。帖子只包含结构化元数据与媒体，不生成独立 HTML。当前内容格式为 2，不提供旧格式兼容分支。

## 安全阅读

网页内容先在惰性 `<template>` 中清理脚本、事件属性、外部 URL 和嵌入框架，再以仅允许同源本地资源、禁止脚本的 sandbox iframe 展示。所有图片、字体和视频替换为本地 Blob URL；保留同源资源访问以避免浏览器存储分区拦截本地媒体。沙箱不允许脚本，内容 CSP 同样禁止脚本与联网，且加载前删除事件与脚本。

社交正文转义后渲染，媒体只能从该收藏的已保存资源清单读取。HLS 自定义加载器只读取归档分片，不请求原站播放地址。

## 同步

WebDAV 仅操作独立的 `glassmark/content-v2/` 子目录，与其他内容格式隔离。资源与内容上传完成后再发布事件；下载端先完成资源、校验 SHA256，再提交事件与索引。修订事件不可变，删除使用 tombstone，冲突按 revision 确定顺序。

偏好与设备配对属于本机配置。标签、文件夹、收藏与删除事件跨设备同步。凭证不会进入内容目录。

## 窗口

应用仅在外层裁切圆角，子面板保持矩形，避免多组圆角叠加。Windows 同时设置 DWM 圆角偏好和无边线颜色，确保本机材质与 WebView 使用一致外形。macOS 使用系统材质。标题区的显式拖动处理排除按钮、输入框与链接。

## 构建

`scripts/build.mjs` 生成桌面前端、经典背景脚本的 Chromium MV3 扩展、Firefox MV3 扩展与 ZIP。原生客户端嵌入相同 Rust 服务。

CI 的 Rust 工作区缓存按平台、工具链和依赖锁文件隔离，缓存工作区 crate 并在失败时保存。发布仅接收同次成功 CI 的安装包、扩展和三个浏览器报告。

## Causal conflict management

Revision events name their parent revisions. SQLite `revisions` stores immutable events and `heads` materializes each document's unconsumed branches. A sole head supersedes its ancestors regardless of clock order; multiple heads remain an explicit conflict. Existing unparented history replays as one ordered chain. Live branches remain visible during delete/edit conflicts. Resolutions atomically check the expected head set and create a new event referencing every resolved head.

The desktop-only conflict API exposes metadata comparisons and permits version selection or explicit tag union when other editable fields agree. Mutation requests carry revision preconditions; stale requests return HTTP 409. WebDAV conditional writes verify an existing event's exact bytes before marking it uploaded. Archive bodies and content-addressed media remain immutable.
