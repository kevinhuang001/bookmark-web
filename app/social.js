import { icon, escapeHtml as esc } from "./icons.js";
import { rootPost, communityFromUrl, feedItems } from "./library.js";
import { ArchiveMedia } from "./media.js";
let media;
export function releaseSocial() {
  media?.release();
  media = null;
}
const stamp = (item) =>
  new Date(item.capturedAt).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
function authorName(post) {
  return post.authorName || post.author?.split("@")[0].trim() || "收藏的作者";
}
function avatar(post, item) {
  const name = authorName(post);
  const hue = [...name].reduce((n, c) => n + c.codePointAt(0), 0) % 360;
  return `<span class="social-avatar" style="--avatar-color:hsl(${hue} 24% 45%)">${esc([...name][0])}${post.avatarUrl ? `<img alt="" data-archive-id="${item.id}" data-archive-media="${esc(post.avatarUrl)}">` : ""}</span>`;
}
function bodyText(text) {
  const pattern = /(https?:\/\/[^\s<]+|@[\w_]+|#[^\s<]+)/g;
  return String(text || "")
    .split(pattern)
    .map((part, index) =>
      index % 2 ? `<span class="social-link">${esc(part)}</span>` : esc(part),
    )
    .join("");
}
function mediaMarkup(post, item) {
  const records = (post.media || []).slice(0, 4);
  if (!records.length) return "";
  return `<div class="social-media-grid media-count-${records.length}">${records.map((m) => `<div class="social-media media-loading ${m.type === "video" ? "video-media" : ""}">${m.type === "video" ? `<video controls preload="metadata" data-archive-id="${item.id}" data-archive-media="${esc(m.url)}"></video>` : `<img loading="lazy" alt="${esc(m.alt || "收藏的图片")}" data-archive-id="${item.id}" data-archive-media="${esc(m.url)}">`}<span class="media-fallback">媒体未归档</span></div>`).join("")}</div>`;
}
function menu(item) {
  return `<details class="post-menu"><summary aria-label="更多收藏操作">${icon("more")}</summary><div><button data-social-action="tags" data-id="${item.id}">编辑标签</button><button data-social-action="info" data-id="${item.id}">保存详情</button><button class="danger" data-social-action="delete" data-id="${item.id}">删除收藏</button></div></details>`;
}
function xActions(post, item) {
  const stats = post.stats || {};
  const liked = item.tags?.includes("喜欢");
  return `<div class="x-post-actions"><button data-social-action="open" data-id="${item.id}" title="查看已收藏的回复">${icon("comment")}<span>${esc(stats.replies || (item.posts?.length > 1 ? item.posts.length - 1 : ""))}</span></button><span>${icon("repeat")}<span>${esc(stats.reposts || "")}</span></span><button class="${liked ? "locally-liked" : ""}" data-social-action="like" data-id="${item.id}" title="标记喜欢（本地）">${icon("heart")}<span>${esc(stats.likes || "")}</span></button><span>${icon("chart")}<span>${esc(stats.views || "")}</span></span><button data-social-action="info" data-id="${item.id}" title="已保存的收藏">${icon("bookmark")}</button><button data-social-action="copy" data-id="${item.id}" title="复制来源链接">${icon("share")}</button></div>`;
}
function xPost(post, item, { detail = false, reply = false } = {}) {
  const name = authorName(post);
  return `<article class="x-post ${detail ? "x-post-detail" : ""} ${reply ? "x-reply" : ""}" data-open-archive="${item.id}" tabindex="0" role="link" aria-label="打开 ${esc(name)} 的帖子">
 ${avatar(post, item)}<div class="x-post-content"><div class="x-author-line"><button class="author-name" data-social-action="author" data-author="${esc(name)}">${esc(name)}</button>${post.verified ? icon("verified") : ""}<span>${esc(post.authorHandle || "")}</span><span>· ${stamp(item)}</span>${menu(item)}</div>
 <div class="x-post-text">${bodyText(post.text)}</div>${mediaMarkup(post, item)}${detail ? `<div class="x-capture-time">${new Date(item.capturedAt).toLocaleString("zh-CN")} · 已收藏</div>` : ""}${xActions(post, item)}${!detail && !reply && item.posts?.length > 1 ? `<button class="show-thread" data-social-action="open" data-id="${item.id}">显示此讨论串 ${icon("arrowRight")}</button>` : ""}</div></article>`;
}
function savedSidebar(kind, options) {
  const reddit = kind === "reddit";
  const communities = [
    ...new Set(
      options.items.map(
        (i) => rootPost(i).community || communityFromUrl(i.url),
      ),
    ),
  ];
  return `<aside class="saved-site-sidebar ${kind}-saved-sidebar" aria-label="${reddit ? "Reddit 已保存导航" : "X 书签导航"}"><div class="saved-site-brand">${icon(kind)}${reddit ? "<span>reddit</span>" : ""}</div><button class="saved-nav-entry active" data-social-action="bookmarks">${icon("bookmark")}<span>${reddit ? "已保存" : "书签"}</span><small>${options.items.length}</small></button><form class="saved-search" role="search">${icon("search")}<input type="search" name="q" aria-label="搜索 ${reddit ? "Reddit" : "X"} 收藏" placeholder="搜索${reddit ? "已保存" : "书签"}" value="${esc(options.query)}"><button type="submit" aria-label="搜索收藏">${icon("arrowRight")}</button></form>${reddit && communities.length ? `<div class="saved-communities"><h2>已保存的社区</h2><button class="${!options.filters.community ? "active" : ""}" data-social-action="community" data-community="">全部社区</button>${communities.map((c) => `<button class="${options.filters.community === c ? "active" : ""}" data-social-action="community" data-community="${esc(c)}">r/${esc(c)}</button>`).join("")}</div>` : ""}<div class="saved-tags"><div><h2>标签</h2><button data-social-action="new-tag" aria-label="新建标签">${icon("plus")}</button></div><button class="${!options.tag ? "active" : ""}" data-social-action="tag-filter" data-tag="">全部收藏</button>${(options.tags || []).map((t) => `<button class="${options.tag === t ? "active" : ""}" data-social-action="tag-filter" data-tag="${esc(t)}">${icon("tag")}<span>${esc(t)}</span></button>`).join("")}</div><p class="saved-local-note">${icon("archive")}本地收藏</p></aside>`;
}
function discussionScope(item) {
  const count = Math.max(0, (item.posts?.length || 1) - 1);
  return `<div class="discussion-scope">${icon("archive")}<span>已保存 ${count} 条回复 / 评论 · 下方显示本次归档的全部内容</span><button data-social-action="copy" data-id="${item.id}" title="复制来源地址，在浏览器插件中继续收藏">${icon("link")}来源链接</button></div>`;
}
function xShell(items, options) {
  const selected = items.find((i) => i.id === options.selected);
  const rows = feedItems(items, options.filters);
  return `<div class="x-shell">${savedSidebar("x", { ...options, items })}<section class="x-timeline"><header class="x-feed-header">${selected ? `<div class="x-detail-title"><button data-social-action="back" aria-label="返回信息流">${icon("back")}</button><strong>帖子</strong></div>` : `<div class="x-bookmarks-title"><div><strong>书签</strong><span>X · ${items.length} 份收藏</span></div>${icon("bookmark")}</div>`}</header>
 ${
   selected
     ? xPost(rootPost(selected), selected, { detail: true }) +
       discussionScope(selected) +
       (selected.posts || [])
         .slice(1)
         .map((p) => xPost(p, selected, { reply: true }))
         .join("")
     : `${options.filters.author ? `<div class="feed-filter-bar">${esc(options.filters.author)}<button data-social-action="clear-filter">${icon("close")} 清除筛选</button></div>` : ""}${rows.map((item) => xPost(rootPost(item), item)).join("") || '<div class="social-empty">这里还没有收藏的帖子。<p>通过浏览器插件保存帖子和讨论串。</p></div>'}<div class="feed-end">${rows.length ? "已显示全部书签" : ""}</div>`
 }</section></div>`;
}
function redditActions(post, item) {
  return `<div class="reddit-post-actions"><span class="reddit-votes">${icon("arrowUp")}<b>${esc(post.stats?.votes || "—")}</b>${icon("arrowDown")}</span><button data-social-action="open" data-id="${item.id}">${icon("comment")}<b>${esc(post.stats?.comments || (item.posts?.length > 1 ? item.posts.length - 1 : "评论"))}</b></button><button data-social-action="copy" data-id="${item.id}">${icon("share")}<b>分享</b></button><button class="reddit-save" data-social-action="info" data-id="${item.id}" title="已收藏">${icon("bookmark")}</button></div>`;
}
function redditPost(item, detail = false) {
  const post = rootPost(item);
  const community = post.community || communityFromUrl(item.url);
  const title = post.title || item.title.replace(/\s*[:|]\s*r\/.*$/, "");
  return `<article class="reddit-post ${detail ? "reddit-post-detail" : ""}" data-open-archive="${item.id}" tabindex="0" role="link" aria-label="打开 ${esc(title)}"><div class="reddit-author-line"><button class="community-avatar" data-social-action="community" data-community="${esc(community)}">r/</button><button class="community-name" data-social-action="community" data-community="${esc(community)}">r/${esc(community)}</button><span>· ${stamp(item)}</span>${menu(item)}</div><h1>${esc(title)}</h1><span class="reddit-flair">${item.posts?.length > 1 ? "讨论" : "收藏"}</span><div class="reddit-post-text">${bodyText(post.text)}</div>${mediaMarkup(post, item)}${redditActions(post, item)}</article>`;
}
function redditComment(post, item) {
  return `<article class="reddit-comment" style="--depth:${Math.min(post.depth || 0, 7)}"><div class="reddit-comment-author">${avatar(post, item)}<strong>${esc(authorName(post))}</strong><span>· ${stamp(item)}</span></div><p>${bodyText(post.text)}</p><div class="reddit-comment-actions">${icon("arrowUp")}<span>${esc(post.stats?.votes || "")}</span>${icon("arrowDown")}<span>回复</span></div></article>`;
}
function redditShell(items, options) {
  const selected = items.find((i) => i.id === options.selected);
  const rows = feedItems(items, options.filters);
  const communities = [
    ...new Set(
      items.map((i) => rootPost(i).community || communityFromUrl(i.url)),
    ),
  ];
  return `<div class="reddit-shell">${savedSidebar("reddit", { ...options, items })}<div class="reddit-main"><header class="reddit-bookmarks-header"><div class="reddit-bookmarks-title">${icon("reddit")}<div><strong>已保存</strong><span>Reddit · ${items.length} 份收藏</span></div></div>${icon("bookmark")}</header><div class="reddit-layout"><section class="reddit-timeline">${
    selected
      ? `<div class="reddit-detail-nav"><button data-social-action="back" aria-label="返回信息流">${icon("back")}</button><span>r/${esc(rootPost(selected).community || communityFromUrl(selected.url))}</span></div>${redditPost(selected, true)}${discussionScope(selected)}<div class="reddit-comments-title"><h2>评论 <span>${Math.max(0, (selected.posts?.length || 1) - 1)}</span></h2><span>已收藏的讨论</span></div>${
          (selected.posts || [])
            .slice(1)
            .map((p) => redditComment(p, selected))
            .join("") ||
          '<div class="social-empty">这份收藏中没有已加载的评论。</div>'
        }`
      : `<div class="reddit-sort-bar"><select class="saved-community" aria-label="筛选已收藏的社区"><option value="">全部收藏</option>${communities.map((c) => `<option value="${esc(c)}" ${options.filters.community === c ? "selected" : ""}>r/${esc(c)}</option>`).join("")}</select><div><button data-social-action="sort-recent" class="${options.filters.sort !== "best" ? "active" : ""}">最新</button><button data-social-action="sort-best" class="${options.filters.sort === "best" ? "active" : ""}">最佳</button></div></div>${rows.map((item) => redditPost(item)).join("") || '<div class="social-empty">还没有收藏的讨论。<p>通过浏览器插件保存主帖与已加载评论。</p></div>'}<div class="feed-end">${rows.length ? "已显示全部收藏" : ""}</div>`
  }</section></div></div></div>`;
}
export async function renderSocial(
  root,
  { kind, items, selected, query, filters, callbacks, tags = [], tag = null },
) {
  releaseSocial();
  media = new ArchiveMedia();
  root.innerHTML =
    kind === "x"
      ? xShell(items, { selected, query, filters, tags, tag })
      : redditShell(items, { selected, query, filters, tags, tag });
  root.onclick = (e) => {
    const action = e.target.closest("[data-social-action]");
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      callbacks.action(action.dataset.socialAction, action.dataset);
      return;
    }
    if (e.target.closest("button,summary,details,video,form,input,select"))
      return;
    const card = e.target.closest("[data-open-archive]");
    if (card) callbacks.action("open", { id: card.dataset.openArchive });
  };
  root.onkeydown = (e) => {
    if (e.key === "Enter" && e.target.matches("[data-open-archive]"))
      callbacks.action("open", { id: e.target.dataset.openArchive });
  };
  const search = root.querySelector(".saved-search");
  if (search)
    search.onsubmit = (event) => {
      event.preventDefault();
      callbacks.action("search", {
        query: new FormData(search).get("q") || "",
      });
    };
  const community = root.querySelector(".saved-community");
  if (community)
    community.onchange = () =>
      callbacks.action("community", { community: community.value });
  await media.hydrate(root, items);
}
