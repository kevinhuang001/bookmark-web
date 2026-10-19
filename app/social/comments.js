import { t as tr } from "../i18n.js";
import { icon, escapeHtml as esc } from "../icons.js";
import { rootPost } from "../library.js";
import { commentThreads } from "../threads.js";
import {
  authorName,
  avatar,
  bodyText,
  commentTime,
  stamp,
  menu,
  mediaMarkup,
} from "./format.js";
// Resolve relationships only from saved identifiers or explicit source metadata.
export function replyTarget(post, item) {
  const parentId = String(post.parentId || "");
  const parent =
    parentId &&
    (item.posts || []).find(
      (candidate) =>
        String(candidate.id || "") === parentId && candidate !== post,
    );
  const explicit = String(post.replyToName || post.replyToHandle || "")
    .replace(/^(?:回复|Replying to)\s*/i, "")
    .trim();
  const name = explicit || (parent ? authorName(parent) : "");
  return { name, parent: !!parent };
}
export function replyIndicator(post, item, kind) {
  const { name } = replyTarget(post, item);
  if (!name) return "";
  const label = kind === "x" ? tr("正在回复") : tr("回复");
  return `<span class="reply-target reply-target-${kind}">${label} <strong>${esc(name)}</strong></span>`;
}
export function threadComments(item, kind, render) {
  return commentThreads(item.posts)
    .map((entries) => {
      const content = entries
        .map(({ post, depth, parent }) => render(post, depth, parent))
        .join("");
      return kind === "reddit"
        ? content
        : `<div class="${kind}-thread-group">${content}</div>`;
    })
    .join("");
}

function redditComment(post, item) {
  const op = authorName(post) === authorName(rootPost(item));
  return `<article class="reddit-comment"><div class="reddit-comment-author">${avatar(post, item)}<strong>${esc(authorName(post))}</strong>${op ? '<span class="reddit-op">OP</span>' : ""}<span class="reddit-comment-time">· ${commentTime(post) || stamp(item)}</span>${menu(item)}</div><div class="reddit-comment-body"><p>${bodyText(post.text)}</p>${mediaMarkup(post, item, { comment: true })}<div class="reddit-comment-actions"><span class="reddit-comment-votes">${icon("arrowUp")}<b>${esc(post.stats?.votes || "")}</b>${icon("arrowDown")}</span><span>${icon("comment")}${tr("回复")}</span><button data-social-action="copy" data-id="${item.id}">${icon("share")}${tr("分享")}</button></div></div></article>`;
}
export function redditThreads(item) {
  let index = 0;
  const render = (entries, start, end) => {
    let html = "";
    for (let i = start; i < end; ) {
      const { post, depth } = entries[i];
      let next = i + 1;
      while (next < end && entries[next].depth > depth) next++;
      const id = `reddit-comment-body-${item.id}-${index++}`;
      html += `<section class="reddit-comment-node"><button class="reddit-thread-toggle" aria-expanded="true" aria-controls="${id}" aria-label="${tr("折叠讨论串")}"><span>−</span></button><div class="reddit-node-header">${redditComment(post, item)}</div><div class="reddit-child-comments" id="${id}">${render(entries, i + 1, next)}</div></section>`;
      i = next;
    }
    return html;
  };
  return commentThreads(item.posts)
    .map((entries) => render(entries, 0, entries.length))
    .join("");
}

export function nativeComment(
  post,
  item,
  kind = "xiaohongshu",
  threadDepth = 0,
) {
  const root = rootPost(item);
  const target =
    String(post.parentId || "") === String(root.id) &&
    !post.replyToName &&
    !post.replyToHandle
      ? ""
      : replyTarget(post, item).name;
  const rootAuthor = authorName(rootPost(item));
  const isAuthor = authorName(post) === rootAuthor;
  const badge = isAuthor
    ? `<span class="comment-author-badge">${tr("作者")}</span>`
    : "";
  const prefix = target
    ? `<span class="comment-reply-prefix">${tr("回复")} <span>${esc(target)}</span>： </span>`
    : "";
  const actions = `<div class="native-comment-actions"><span>${icon("heart")}${esc(post.stats?.likes || "")}</span><span>${icon("comment")}${esc(post.stats?.comments || tr("回复"))}</span></div>`;
  const date = `<span class="native-comment-date">${commentTime(post)}</span>`;
  return `<article class="note-comment native-comment ${kind}-comment ${threadDepth > 0 ? "comment-child" : ""}">${avatar(post, item)}<div class="native-comment-content"><header><strong>${esc(authorName(post))}</strong>${badge}${menu(item)}</header><p>${prefix}${bodyText(post.text)}</p>${mediaMarkup(post, item, { comment: true })}${kind === "zhihu" ? `<footer>${date}${actions}</footer>` : `${date}${actions}`}</div></article>`;
}
