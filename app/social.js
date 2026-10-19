import { t as tr, locale } from "./i18n.js";
import { icon, escapeHtml as esc } from "./icons.js";
import { rootPost, communityFromUrl, feedItems } from "./library.js";
import { ArchiveMedia } from "./media.js";
let media;
export function releaseSocial() {
  media?.release();
  media = null;
}
const stamp = (item) =>
  new Date(item.capturedAt).toLocaleDateString(locale(), {
    month: "short",
    day: "numeric",
  });
function authorName(post) {
  return (
    post.authorName || post.author?.split("@")[0].trim() || tr("收藏的作者")
  );
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
  const records = post.media || [];
  if (!records.length) return "";
  return `<div class="social-media-grid media-count-${records.length}">${records.map((m) => `<div class="social-media media-loading ${m.type === "video" ? "video-media" : ""}">${m.type === "video" ? `<video controls preload="metadata" data-archive-id="${item.id}" data-archive-media="${esc(m.url)}"></video>` : `<img loading="lazy" alt="${esc(m.alt || tr("收藏的图片"))}" data-archive-id="${item.id}" data-archive-media="${esc(m.url)}">`}<span class="media-fallback">${tr("媒体未归档")}</span></div>`).join("")}</div>`;
}
function menu(item) {
  return `<details class="post-menu"><summary aria-label="${tr("更多收藏操作")}">${icon("more")}</summary><div><button data-social-action="tags" data-id="${item.id}">${tr("编辑标签")}</button><button data-social-action="info" data-id="${item.id}">${tr("保存详情")}</button><button class="danger" data-social-action="delete" data-id="${item.id}">${tr("删除收藏")}</button></div></details>`;
}
function xActions(post, item) {
  const stats = post.stats || {};
  const liked = item.tags?.includes("喜欢");
  return `<div class="x-post-actions"><button data-social-action="open" data-id="${item.id}" title="${tr("查看已收藏的回复")}">${icon("comment")}<span>${esc(stats.replies || (item.posts?.length > 1 ? item.posts.length - 1 : ""))}</span></button><span>${icon("repeat")}<span>${esc(stats.reposts || "")}</span></span><button class="${liked ? "locally-liked" : ""}" data-social-action="like" data-id="${item.id}" title="${tr("标记喜欢（本地）")}">${icon("heart")}<span>${esc(stats.likes || "")}</span></button><span>${icon("chart")}<span>${esc(stats.views || "")}</span></span><button data-social-action="info" data-id="${item.id}" title="${tr("已保存的收藏")}">${icon("bookmark")}</button><button data-social-action="copy" data-id="${item.id}" title="${tr("复制来源链接")}">${icon("share")}</button></div>`;
}
function xPost(post, item, { detail = false, reply = false } = {}) {
  const name = authorName(post);
  return `<article class="x-post ${detail ? "x-post-detail" : ""} ${reply ? "x-reply" : ""}" data-open-archive="${item.id}" tabindex="0" role="link" aria-label="${tr("打开 {3} 的帖子", { 3: esc(name) })}">
 ${avatar(post, item)}<div class="x-post-content"><div class="x-author-line"><button class="author-name" data-social-action="author" data-author="${esc(name)}">${esc(name)}</button>${post.verified ? icon("verified") : ""}<span>${esc(post.authorHandle || "")}</span><span>· ${stamp(item)}</span>${menu(item)}</div>
 <div class="x-post-text">${bodyText(post.text)}</div>${mediaMarkup(post, item)}${detail ? `<div class="x-capture-time">${tr("{0} · 已收藏", { 0: new Date(item.capturedAt).toLocaleString(locale()) })}</div>` : ""}${xActions(post, item)}</div></article>`;
}
function savedSearch(kind, query) {
  const label = {
    x: "X",
    reddit: "Reddit",
    xiaohongshu: tr("小红书"),
    zhihu: tr("知乎"),
  }[kind];
  return `<form class="saved-search" role="search">${icon("search")}<input type="search" name="q" aria-label="${tr("搜索 {1} 收藏", { 1: label })}" placeholder="${tr("搜索收藏")}" value="${esc(query)}"><button type="submit" aria-label="${tr("搜索收藏")}">${icon("arrowRight")}</button></form>`;
}
function collectionTabs(options) {
  const tags = ["", ...(options.tags || [])];
  return `<nav class="collection-navigation" aria-label="${tr("标签")}"><div class="collection-tabs" role="tablist" aria-label="${tr("标签")}">${tags.map((tag, index) => `<button id="collection-tab-${index}" role="tab" aria-controls="saved-posts" aria-selected="${(options.tag || "") === tag}" tabindex="${(options.tag || "") === tag ? 0 : -1}" data-social-action="tag-filter" data-tag="${esc(tag)}">${esc(tag || tr("全部收藏"))}</button>`).join("")}</div><button class="collection-add-tag" data-social-action="new-tag" aria-label="${tr("新建标签")}">${icon("plus")}</button></nav>`;
}
function emptyCollection(options) {
  return options.tag
    ? `<div class="social-empty tag-empty"><strong># ${esc(options.tag)}</strong><p>${tr("此标签下暂无收藏。")}</p></div>`
    : `<div class="social-empty">${tr("这里还没有收藏内容。")}</div>`;
}
function sidebarTags(options) {
  return `<div class="sidebar-tag-section"><div class="sidebar-tag-title">${tr("标签")}</div>${collectionTabs(options)}</div>`;
}
function collectionPanel(options) {
  const index = ["", ...(options.tags || [])].indexOf(options.tag || "");
  return `id="saved-posts" role="tabpanel" aria-labelledby="collection-tab-${Math.max(0, index)}"`;
}
function detailBack() {
  return `<div class="discussion-back"><button data-social-action="back" aria-label="${tr("{0}返回收藏", { 0: "" })}">${icon("back")}<span>${tr("{0}返回收藏", { 0: "" })}</span></button></div>`;
}
function xSidebar(options) {
  return `<aside class="saved-site-sidebar x-saved-sidebar" aria-label="${tr("X 书签导航")}"><div class="saved-site-brand">${icon("x")}</div><button class="saved-nav-entry active" data-social-action="bookmarks">${icon("bookmark")}<span>${tr("书签")}</span><small>${options.items.length}</small></button>${savedSearch("x", options.query)}${sidebarTags(options)}<p class="saved-local-note">${tr("{5}本地收藏", { 5: icon("archive") })}</p></aside>`;
}
function redditSidebar(items, options) {
  const communities = [
    ...new Set(
      items.map((i) => rootPost(i).community || communityFromUrl(i.url)),
    ),
  ];
  return `<aside class="reddit-saved-sidebar" aria-label="${tr("Reddit 已保存导航")}"><button class="saved-nav-entry active" data-social-action="bookmarks">${icon("bookmark")}<span>${tr("已保存")}</span><small>${items.length}</small></button>${sidebarTags(options)}${communities.length ? `<div class="saved-communities"><h2>${tr("已收藏的社区")}</h2><button class="${!options.filters.community ? "active" : ""}" data-social-action="community" data-community="">${tr("全部社区")}</button>${communities.map((c) => `<button class="${options.filters.community === c ? "active" : ""}" data-social-action="community" data-community="${esc(c)}"><span class="reddit-community-mark">r/</span>${esc(c)}</button>`).join("")}</div>` : ""}</aside>`;
}
function discussionScope(item) {
  const count = Math.max(0, (item.posts?.length || 1) - 1);
  return `<div class="discussion-scope">${icon("archive")}<span>${tr("已保存 {1} 条回复 / 评论 · 下方显示本次归档的全部内容", { 1: count })}</span><button data-social-action="copy" data-id="${item.id}" title="${tr("复制来源地址，在浏览器插件中继续收藏")}">${tr("{3}来源链接", { 3: icon("link") })}</button></div>`;
}
function xShell(items, options) {
  const selected = items.find((i) => i.id === options.selected);
  const rows = feedItems(items, options.filters);
  return `<div class="x-shell">${xSidebar({ ...options, items })}<section class="x-timeline"><header class="x-feed-header">${selected ? detailBack() : `<div class="x-feed-title">${tr("全部收藏")}</div>`}</header>
 ${
   selected
     ? xPost(rootPost(selected), selected, { detail: true }) +
       discussionScope(selected) +
       (selected.posts || [])
         .slice(1)
         .map((p) => xPost(p, selected, { reply: true }))
         .join("")
     : `<div ${collectionPanel(options)}>${<div class="social-sort-bar"><button data-social-action="sort-recent" class="${options.filters.sort !== "best" ? "active" : ""}">${tr("最新")}</button><button data-social-action="sort-best" class="${options.filters.sort === "best" ? "active" : ""}">${tr("最佳")}</button></div>}${options.filters.author ? `<div class="feed-filter-bar">${esc(options.filters.author)}<button data-social-action="clear-filter">${tr("{1} 清除筛选", { 1: icon("close") })}</button></div>` : ""}${rows.map((item) => xPost(rootPost(item), item)).join("") || emptyCollection(options)}<div class="feed-end">${rows.length ? tr("已显示全部书签") : ""}</div></div>`
 }</section></div>`;
}
function redditActions(post, item) {
  return `<div class="reddit-post-actions"><span class="reddit-votes">${icon("arrowUp")}<b>${esc(post.stats?.votes || "—")}</b>${icon("arrowDown")}</span><button data-social-action="open" data-id="${item.id}">${icon("comment")}<b>${esc(post.stats?.comments || (item.posts?.length > 1 ? item.posts.length - 1 : tr("评论")))}</b></button><button data-social-action="copy" data-id="${item.id}">${icon("share")}<b>${tr("分享")}</b></button><button class="reddit-save" data-social-action="info" data-id="${item.id}" title="${tr("已收藏")}">${icon("bookmark")}</button></div>`;
}
function redditPost(item, detail = false) {
  const post = rootPost(item);
  const community = post.community || communityFromUrl(item.url);
  const title = post.title || item.title.replace(/\s*[:|]\s*r\/.*$/, "");
  return `<article class="reddit-post ${detail ? "reddit-post-detail" : ""}" data-open-archive="${item.id}" tabindex="0" role="link" aria-label="${tr("打开 {2}", { 2: esc(title) })}"><div class="reddit-author-line"><button class="community-avatar" data-social-action="community" data-community="${esc(community)}">r/</button><button class="community-name" data-social-action="community" data-community="${esc(community)}">r/${esc(community)}</button><span>· ${stamp(item)}</span><span class="reddit-post-author">u/${esc(authorName(post))}</span>${menu(item)}</div><h1>${esc(title)}</h1><div class="reddit-post-text">${bodyText(post.text)}</div>${mediaMarkup(post, item)}${redditActions(post, item)}</article>`;
}
function redditComment(post, item) {
  return `<article class="reddit-comment" style="--depth:${Math.min(post.depth || 0, 7)}"><div class="reddit-comment-author">${avatar(post, item)}<strong>${esc(authorName(post))}</strong><span>· ${stamp(item)}</span></div><p>${bodyText(post.text)}</p><div class="reddit-comment-actions">${icon("arrowUp")}<span>${esc(post.stats?.votes || "")}</span>${icon("arrowDown")}<span>${tr("回复")}</span></div></article>`;
}
function redditShell(items, options) {
  const selected = items.find((i) => i.id === options.selected);
  const rows = feedItems(items, options.filters);
  return `<div class="reddit-shell"><header class="reddit-archive-header"><div class="reddit-wordmark">${icon("reddit")}<strong>reddit</strong></div>${savedSearch("reddit", options.query)}</header>${redditSidebar(items, options)}<div class="reddit-main"><div class="reddit-layout"><section class="reddit-timeline">${
    selected
      ? `${detailBack()}${redditPost(selected, true)}<div class="reddit-comments-title"><h2>${tr("评论")} <span>${Math.max(0, (selected.posts?.length || 1) - 1)}</span></h2></div>${
          (selected.posts || [])
            .slice(1)
            .map((p) => redditComment(p, selected))
            .join("") ||
          `<div class="social-empty">${tr("这份收藏中没有已加载的评论。")}</div>`
        }`
      : `<div ${collectionPanel(options)}><div class="reddit-sort-bar"><div><button data-social-action="sort-recent" class="${options.filters.sort !== "best" ? "active" : ""}">${tr("最新")}</button><button data-social-action="sort-best" class="${options.filters.sort === "best" ? "active" : ""}">${tr("最佳")}</button></div></div>${rows.map((item) => redditPost(item)).join("") || emptyCollection(options)}</div>`
  }</section></div></div></div>`;
}
function noteCover(post, item) {
  const first = post.media?.[0];
  if (!first)
    return `<div class="note-cover note-cover-text"><p>${esc((post.text || post.title || item.title).slice(0, 120))}</p></div>`;
  const url = first.type === "video" ? first.poster : first.url;
  return `<div class="social-media note-cover ${url ? "media-loading" : "note-cover-video"}">${url ? `<img loading="lazy" alt="${esc(first.alt || post.title || tr("笔记封面"))}" data-archive-id="${item.id}" data-archive-media="${esc(url)}"><span class="media-fallback">${tr("封面未归档")}</span>` : icon("video")}${first.type === "video" ? `<span class="note-cover-badge">${icon("video")}</span>` : ""}${post.media.length > 1 ? `<span class="note-cover-count">${post.media.length}</span>` : ""}</div>`;
}
function notePost(item) {
  const post = rootPost(item);
  return `<article class="note-post" data-open-archive="${item.id}" tabindex="0" role="link" aria-label="${tr("打开 {1}", { 1: esc(post.title || item.title) })}">${noteCover(post, item)}<div class="note-card-info"><h2>${esc(post.title || post.text?.slice(0, 50) || item.title)}</h2><div class="note-card-author">${avatar(post, item)}<span>${esc(authorName(post))}</span><span class="note-card-likes">${icon("heart")}${esc(post.stats?.likes || "")}</span></div></div></article>`;
}
function noteComment(post, item) {
  return `<article class="note-comment" style="--depth:${Math.min(post.depth || 0, 4)}">${avatar(post, item)}<div><strong>${esc(authorName(post))}</strong><p>${bodyText(post.text)}</p><span>${esc(post.postedAt ? new Date(post.postedAt).toLocaleDateString(locale()) : "")}</span></div><span class="note-comment-likes">${icon("heart")}${esc(post.stats?.likes || "")}</span></article>`;
}
function noteDetail(item) {
  const post = rootPost(item);
  const count = post.media?.length || 0;
  return `<div class="note-detail"><section class="note-gallery" aria-label="${tr("笔记图片与视频")}">${count ? mediaMarkup(post, item) : `<div class="note-gallery-empty">${icon("file")}<span>${tr("文字笔记")}</span></div>`}${count > 1 ? `<div class="note-gallery-controls"><button data-note-slide="-1" aria-label="${tr("上一张")}">${icon("back")}</button><span class="note-gallery-count">1 / ${count}</span><button data-note-slide="1" aria-label="${tr("下一张")}">${icon("arrowRight")}</button></div>` : ""}</section><article class="note-post note-detail-content"><div class="note-detail-author">${avatar(post, item)}<strong>${esc(authorName(post))}</strong>${menu(item)}</div><div class="note-detail-scroll"><h1>${esc(post.title || item.title)}</h1><div class="note-body">${bodyText(post.text)}</div><p class="note-date">${stamp(item)}</p><section class="note-comments"><h2>${tr("共 {8} 条已收藏评论", { 8: Math.max(0, (item.posts?.length || 1) - 1) })}</h2>${
    (item.posts || [])
      .slice(1)
      .map((p) => noteComment(p, item))
      .join("") || `<p class="note-no-comments">${tr("暂无已收藏评论")}</p>`
  }</section></div><div class="note-detail-actions"><span>${icon("heart")}${esc(post.stats?.likes || "—")}</span><span>${icon("bookmark")}${esc(post.stats?.saves || "—")}</span><button data-note-comments aria-label="${tr("查看已收藏评论")}">${icon("comment")}${esc(post.stats?.comments || (item.posts?.length || 1) - 1)}</button><button data-social-action="copy" data-id="${item.id}" aria-label="${tr("复制来源链接")}">${icon("share")}</button></div></article></div>`;
}
function noteShell(items, options) {
  const selected = items.find((i) => i.id === options.selected);
  const rows = feedItems(items, options.filters);
  return `<div class="note-shell"><header class="note-archive-header"><div class="note-wordmark">${icon("xiaohongshu").replace('viewBox="0 0 24 24"', 'viewBox="0 6 24 12"')}</div>${savedSearch("xiaohongshu", options.query)}</header>${selected ? detailBack() + noteDetail(selected) : `${collectionTabs(options)}<div class="note-content"><div class="note-sort"><div class="social-sort-bar"><button data-social-action="sort-recent" class="${options.filters.sort !== "best" ? "active" : ""}">${tr("最新")}</button><button data-social-action="sort-best" class="${options.filters.sort === "best" ? "active" : ""}">${tr("最佳")}</button></div></div><div ${collectionPanel(options)} class="note-grid">${rows.map(notePost).join("") || emptyCollection(options)}</div></div>`}</div>`;
}

function zhihuPost(item, detail = false) {
  const post = rootPost(item);
  const title = post.title || item.title;
  return `<article class="zhihu-post ${detail ? "zhihu-detail" : ""}" ${detail ? "" : `data-open-archive="${item.id}" tabindex="0" role="link" aria-label="${tr("打开 {2}", { 2: esc(title) })}"`}>
    <h1>${esc(title)}</h1><div class="zhihu-author">${avatar(post, item)}<strong>${esc(authorName(post))}</strong><span>${stamp(item)}</span></div>
    <div class="zhihu-body">${bodyText(post.text)}</div>${detail ? mediaMarkup(post, item) : `<button class="zhihu-read-more" data-social-action="open" data-id="${item.id}">${tr("阅读全文")}${icon("chevron")}</button>`}
    <footer class="zhihu-actions"><span class="zhihu-votes">${icon("arrowUp")}${esc(post.stats?.votes || "—")}</span><button data-social-action="open" data-id="${item.id}">${icon("comment")}${tr("评论")} ${Math.max(0, (item.posts?.length || 1) - 1)}</button><button data-social-action="info" data-id="${item.id}">${icon("bookmark")}${tr("已收藏")}</button><button data-social-action="copy" data-id="${item.id}" title="${tr("复制来源链接")}">${icon("share")}${tr("分享")}</button>${menu(item)}</footer></article>`;
}
function zhihuShell(items, options) {
  const selected = items.find((i) => i.id === options.selected);
  const rows = feedItems(items, options.filters);
  return `<div class="zhihu-shell"><header class="zhihu-header"><div class="zhihu-wordmark">${icon("zhihu")}<strong>${tr("知乎")}</strong></div>${savedSearch("zhihu", options.query)}</header><div class="zhihu-layout"><section class="zhihu-main">${
    selected
      ? `${detailBack()}${zhihuPost(selected, true)}<div class="zhihu-comments"><h2>${tr("评论")} · ${Math.max(0, (selected.posts?.length || 1) - 1)}</h2>${
          (selected.posts || [])
            .filter((p) => p.isComment)
            .map((p) => noteComment(p, selected))
            .join("") ||
          `<p class="social-empty">${tr("这份收藏中没有已加载的评论。")}</p>`
        }</div>`
      : `<div class="zhihu-list">${collectionTabs(options)}<div ${collectionPanel(options)}><div class="zhihu-sort"><button data-social-action="sort-recent" class="${options.filters.sort !== "best" ? "active" : ""}">${tr("最新")}</button><button data-social-action="sort-best" class="${options.filters.sort === "best" ? "active" : ""}">${tr("最佳")}</button></div>${rows.map((i) => zhihuPost(i)).join("") || emptyCollection(options)}</div></div>`
  }</section></div></div>`;
}

export async function renderSocial(
  root,
  { kind, items, selected, query, filters, callbacks, tags = [], tag = null },
) {
  releaseSocial();
  media = new ArchiveMedia();
  root.innerHTML =
    kind === "zhihu"
      ? zhihuShell(items, { selected, query, filters, tags, tag })
      : kind === "xiaohongshu"
        ? noteShell(items, { selected, query, filters, tags, tag })
        : kind === "x"
          ? xShell(items, { selected, query, filters, tags, tag })
          : redditShell(items, { selected, query, filters, tags, tag });
  root
    .querySelector('[role="tab"][aria-selected="true"]')
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (!selected && items.length && !feedItems(items, filters).length && !tag) {
    const empty = root.querySelector(".social-empty");
    if (empty)
      empty.innerHTML = `${tr("没有符合筛选条件的收藏。")}<p><button data-social-action="bookmarks">${tr("清除筛选")}</button></p>`;
  }
  if (!selected && query && !items.length) {
    const empty = root.querySelector(".social-empty");
    if (empty)
      empty.innerHTML = `${tr("没有找到相关收藏。")}<p><button data-social-action="search" data-query="">${tr("清除搜索")}</button></p>`;
  }
  const gallery = root.querySelector(".note-gallery .social-media-grid");
  if (gallery) {
    const slides = [...gallery.children];
    const update = () => {
      const index = Math.round(
        gallery.scrollLeft / Math.max(1, gallery.clientWidth),
      );
      const label = root.querySelector(".note-gallery-count");
      if (label) label.textContent = `${index + 1} / ${slides.length}`;
    };
    gallery.addEventListener("scroll", update, { passive: true });
    for (const button of root.querySelectorAll("[data-note-slide]"))
      button.onclick = () => {
        const index = Math.max(
          0,
          Math.min(
            slides.length - 1,
            Math.round(gallery.scrollLeft / Math.max(1, gallery.clientWidth)) +
              Number(button.dataset.noteSlide),
          ),
        );
        gallery.scrollTo({
          left: index * gallery.clientWidth,
          behavior: "smooth",
        });
      };
  }
  const commentsButton = root.querySelector("[data-note-comments]");
  if (commentsButton)
    commentsButton.onclick = () =>
      root
        .querySelector(".note-comments")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    const tab = e.target.closest('[role="tab"]');
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const tabs = [...root.querySelectorAll('[role="tab"]')];
      const current = tabs.indexOf(tab);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? tabs.length - 1
            : (current + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      const tag = tabs[next].dataset.tag;
      callbacks.action("tag-filter", { tag });
      queueMicrotask(() =>
        [...root.querySelectorAll('[role="tab"]')]
          .find((node) => node.dataset.tag === tag)
          ?.focus(),
      );
      return;
    }
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
  await media.hydrate(root, items);
}
