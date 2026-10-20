import { t as tr, locale } from "../i18n.js";
import { icon, escapeHtml as esc } from "../icons.js";
export const stamp = (item) =>
  new Date(item.capturedAt).toLocaleDateString(locale(), {
    month: "short",
    day: "numeric",
  });
export function authorName(post) {
  return (
    post.authorName || post.author?.split("@")[0].trim() || tr("收藏的作者")
  );
}
export function avatar(post, item) {
  const name = authorName(post);
  const hue = [...name].reduce((n, c) => n + c.codePointAt(0), 0) % 360;
  return `<span class="social-avatar" style="--avatar-color:hsl(${hue} 24% 45%)">${esc([...name][0])}${post.avatarUrl ? `<img alt="" data-archive-id="${item.id}" data-archive-media="${esc(post.avatarUrl)}">` : ""}</span>`;
}
export function bodyText(text) {
  const pattern = /(https?:\/\/[^\s<]+|@[\w_]+|#[^\s<]+)/g;
  return String(text || "")
    .split(pattern)
    .map((part, index) =>
      index % 2 ? `<span class="social-link">${esc(part)}</span>` : esc(part),
    )
    .join("");
}

export function mediaMarkup(post, item, { comment = false } = {}) {
  const records = post.media || [];
  if (!records.length) return "";
  return `<div class="social-media-grid ${comment ? "comment-media" : ""} media-count-${records.length}">${records.map((m) => `<div class="social-media media-loading ${m.type === "video" ? "video-media" : ""}" tabindex="0" role="button" aria-label="${tr("查看已保存的媒体")}">${m.type === "video" ? `<video preload="metadata" playsinline ${m.poster ? `data-archive-poster="${esc(m.poster)}"` : ""} data-archive-id="${item.id}" data-archive-media="${esc(m.url)}"></video>` : `<img loading="lazy" alt="${esc(m.alt || tr("收藏的图片"))}" data-archive-id="${item.id}" data-archive-media="${esc(m.url)}">`}${m.type === "video" ? '<span class="media-play" aria-hidden="true">▶</span>' : ""}<span class="media-fallback">${tr("媒体未归档")}</span><button type="button" class="media-expand" data-media-expand aria-label="${tr("查看已保存的媒体")}">${icon("external")}</button></div>`).join("")}</div>`;
}
export function menu(item) {
  return `<details class="post-menu"><summary aria-label="${tr("更多收藏操作")}">${icon("more")}</summary><div><button data-social-action="tags" data-id="${item.id}">${tr("编辑标签")}</button><button data-social-action="info" data-id="${item.id}">${tr("保存详情")}</button><button class="danger" data-social-action="delete" data-id="${item.id}">${tr("删除收藏")}</button></div></details>`;
}
export function commentTime(post) {
  const raw = post.postedAt;
  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime()))
      return date.toLocaleString(locale(), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
  }
  return esc(post.postedAtText || "");
}
