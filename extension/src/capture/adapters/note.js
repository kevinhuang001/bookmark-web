import { videoSources } from "../video.js";
import { commentIdentity, commentText } from "./comments.js";
import { imageSource } from "../gallery.js";
export function extractNote(el, doc) {
  const comment = el.matches(".comment-item");
  const owned = (node) =>
    comment
      ? node.closest(".comment-item") === el
      : !node.closest(".comment-item");
  const find = (selector) => [...el.querySelectorAll(selector)].find(owned);
  const text = (selector) => find(selector)?.textContent.trim() || "";
  const avatar = find(
    ".author-container img,.author img,.avatar img,img.avatar",
  );
  const media = [
    ...el.querySelectorAll(
      comment ? ".comment-content img" : ".swiper-slide img,.note-slider img",
    ),
  ]
    .filter(owned)
    .map((i) => ({
      type: "image",
      url: imageSource(i),
      alt: i.alt || "",
    }))
    .filter((m) => /^https?:/.test(m.url));
  for (const v of [...el.querySelectorAll("video")].filter(owned)) {
    const sources = videoSources(v, doc);
    media.push({
      type: "video",
      url: sources[0] || v.currentSrc || v.src,
      poster: v.poster || "",
      sources,
    });
  }
  const targetSelector =
    ".reply-to,.reply-user,.reply-name,.reply-target,.reply-info .username";
  const thread = comment ? el.closest(".parent-comment,.comment-thread") : null;
  const threadRoot = thread?.querySelector(".comment-item");
  const parent = comment ? el.parentElement?.closest(".comment-item") : null;
  const replyName = text(targetSelector);
  const body = find(".content,.note-text");
  return {
    id: comment
      ? commentIdentity(el, ".content,.note-text")
      : new URL(doc.URL).pathname,
    isComment: comment,
    depth: comment
      ? 1 +
        (() => {
          let count = 0;
          for (
            let parent = el.parentElement;
            parent;
            parent = parent.parentElement
          )
            if (parent.matches(".comment-item")) count++;
          return count;
        })()
      : 0,
    parentId: comment
      ? el.getAttribute("data-parent-id") ||
        el.getAttribute("parent-id") ||
        el.getAttribute("data-reply-to-id") ||
        commentIdentity(parent, ".content,.note-text")
      : null,
    threadRootId:
      threadRoot !== el
        ? commentIdentity(threadRoot, ".content,.note-text")
        : null,
    replyToName: comment ? replyName : "",
    author: text(".author-container .username,.author .username,.author .name"),
    authorName: text(
      ".author-container .username,.author .username,.author .name",
    ),
    avatarUrl: avatar?.currentSrc || avatar?.src || "",
    title: comment ? "" : text("#detail-title,.note-title"),
    text: comment
      ? replyName
        ? commentText(body, targetSelector)
        : text(".content,.note-text")
      : text("#detail-desc,.note-text,.desc"),
    url: comment ? null : doc.URL,
    postedAt:
      find("time")?.getAttribute("datetime") ||
      find("[datetime]")?.getAttribute("datetime") ||
      null,
    postedAtText: comment
      ? text(
          ".date,.time,.comment-time,.date-time,.create-time,.comment-info .date",
        )
      : "",
    stats: {
      likes: text(".like-wrapper .count,.like .count"),
      comments: text(".chat-wrapper .count"),
      saves: text(".collect-wrapper .count"),
    },
    media: media.filter((m, i, a) => a.findIndex((x) => x.url === m.url) === i),
    capturedAt: new Date().toISOString(),
  };
}
