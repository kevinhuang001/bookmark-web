import { videoSources } from "../video.js";
import {
  zhihuIdentity,
  ZHIHU_COMMENTS,
  ZHIHU_COMMENT_BODY,
  zhihuCommentOwner,
} from "../zhihu.js";
import { commentIdentity } from "./comments.js";
/** Scope every field to this answer/article; recommendations are never a root. */
export function extractZhihu(el, doc) {
  const comment =
    el.matches(ZHIHU_COMMENTS + "," + ZHIHU_COMMENT_BODY) ||
    (el.hasAttribute("data-id") && !!el.querySelector(ZHIHU_COMMENT_BODY));
  const owned = (node) =>
    (!comment && !zhihuCommentOwner(node)) ||
    node === el ||
    zhihuCommentOwner(node) === el ||
    (el.matches(ZHIHU_COMMENT_BODY) && el.contains(node));
  const find = (selector) =>
    el.matches(selector) ? el : [...el.querySelectorAll(selector)].find(owned);
  const read = (selector) => find(selector)?.textContent.trim() || "";
  const content = find(
    comment
      ? ZHIHU_COMMENT_BODY + ",.RichText"
      : ".RichContent-inner,.Post-RichTextContainer,.RichText",
  );
  const avatar = find(
    "img.AuthorInfo-avatar,.CommentItem-avatar img,.UserLink-avatar img,img.Avatar",
  );
  const identity = comment ? null : zhihuIdentity(el, doc);
  const url = identity?.url || null;
  const data = (() => {
    try {
      return JSON.parse(el.getAttribute("data-zop") || "{}");
    } catch {
      return {};
    }
  })();
  const media = [...(content?.querySelectorAll("img") || [])]
    .filter(owned)
    .map((i) => ({
      type: "image",
      url:
        i.getAttribute("data-original") ||
        i.getAttribute("data-actualsrc") ||
        i.currentSrc ||
        i.src,
      alt: i.alt || "",
    }))
    .filter((m) => /^https?:/.test(m.url));
  for (const v of content?.querySelectorAll("video") || []) {
    const sources = videoSources(content, doc);
    media.push({
      type: "video",
      url: sources[0] || v.currentSrc || v.src,
      poster: v.poster || "",
      sources,
    });
  }
  const author =
    read(".AuthorInfo-name,.CommentItem-meta .UserLink-link,.UserLink-link") ||
    (comment
      ? [...el.querySelectorAll('a[href*="/people/"],a[href*="/org/"]')]
          .find((node) => owned(node) && node.textContent.trim())
          ?.textContent.trim()
      : "") ||
    data.authorName ||
    "";
  return {
    id: comment
      ? el.getAttribute("data-comment-id") ||
        el.getAttribute("data-id") ||
        (el.matches(ZHIHU_COMMENT_BODY)
          ? el.parentElement?.getAttribute("data-id")
          : "") ||
        el.id ||
        author + ":" + (content?.textContent.trim() || "")
      : identity?.id || String(data.itemId || url),
    isComment: comment,
    parentId: comment
      ? (() => {
          const explicit =
            el.getAttribute("data-parent-id") ||
            el.getAttribute("parent-id") ||
            el.getAttribute("data-reply-to-id");
          const parent =
            el.parentElement && zhihuCommentOwner(el.parentElement);
          return (
            explicit ||
            (parent && parent !== el
              ? parent.getAttribute("data-comment-id") ||
                parent.getAttribute("data-id") ||
                parent.id ||
                null
              : null)
          );
        })()
      : null,
    depth: comment ? 1 : 0,
    threadRootId: comment
      ? (() => {
          const group = el.closest(
            ".NestComment,.NestCommentV2,.CommentItemV2-root",
          );
          const root =
            group &&
            [...group.querySelectorAll(ZHIHU_COMMENTS)].find(
              (node) => node !== group,
            );
          return root && root !== el
            ? commentIdentity(root, ZHIHU_COMMENT_BODY)
            : null;
        })()
      : null,
    replyToName: comment
      ? read(
          ".CommentItem-replyTo,.CommentItemV2-replyTo,.reply-to,.reply-user",
        ) ||
        (() => {
          const meta = find(".CommentItem-meta,.CommentItemV2-meta");
          return meta && /回复|replying to/i.test(meta.textContent)
            ? [...meta.querySelectorAll(".UserLink-link")]
                .filter(owned)[1]
                ?.textContent.trim() || ""
            : "";
        })()
      : "",
    author,
    authorName: author,
    avatarUrl: avatar?.currentSrc || avatar?.src || "",
    title: comment
      ? ""
      : doc
          .querySelector(".QuestionHeader-title,.Post-Title,h1")
          ?.textContent.trim() || doc.title,
    text: (content?.innerText || content?.textContent || "").trim(),
    url,
    postedAt:
      el
        .querySelector('meta[itemprop="datePublished"]')
        ?.getAttribute("content") ||
      el.querySelector("time")?.getAttribute("datetime") ||
      null,
    postedAtText: comment
      ? read(
          ".CommentItem-time,.CommentItemV2-time,.ContentItem-time,.comment-time,.time",
        )
      : "",
    stats: {
      ...(comment
        ? {
            likes:
              [...el.querySelectorAll("button")]
                .find(
                  (node) =>
                    owned(node) &&
                    node.querySelector(
                      ".ZDI--HeartFill24,.Zi--Like,.Zi--Heart",
                    ),
                )
                ?.textContent.replace(/[\u200b-\u200f\ufeff]/g, "")
                .trim() || "",
          }
        : {}),
      votes: read(
        '.VoteButton--up,button[aria-label*="赞同"],.Post-NormalMain .VoteButton',
      ),
      comments: read(".ContentItem-action button,.ContentItem-action"),
    },
    media: media.filter((m, i, a) => a.findIndex((x) => x.url === m.url) === i),
    capturedAt: new Date().toISOString(),
  };
}
