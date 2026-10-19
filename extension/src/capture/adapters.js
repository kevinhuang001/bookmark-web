import { videoSources } from "./video.js";
import {
  zhihuIdentity,
  ZHIHU_COMMENTS,
  ZHIHU_COMMENT_BODY,
  zhihuCommentOwner,
} from "./zhihu.js";
/** DOM adapters deliberately use the user's rendered session, never private APIs. */
export function platform(host) {
  if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) return "x";
  if (/(^|\.)reddit\.com$/.test(host)) return "reddit";
  if (/(^|\.)xiaohongshu\.com$/.test(host)) return "xiaohongshu";
  if (/(^|\.)zhihu\.com$/.test(host)) return "zhihu";
  return "web";
}
export function adapterFor(kind, doc = document) {
  const configs = {
    x: {
      selector: 'article[data-testid="tweet"]',
      body: '[data-testid="tweetText"]',
      author: '[data-testid="User-Name"]',
      link: 'a[href*="/status/"]',
      title: "X · 讨论串",
    },
    reddit: {
      selector: "shreddit-post,shreddit-comment,.thing.link,.thing.comment",
      body: '[slot="text-body"],[data-test-id="comment"],.md',
      author: "[author],.author",
      link: 'a[href*="/comments/"]',
      title: "Reddit · 讨论",
    },
    xiaohongshu: {
      selector: ".note-detail-mask .note-container,.note-container",
      body: "#detail-desc,.note-text,.desc",
      author: ".author-container .username,.author .username",
      link: 'a[href*="/explore/"],a[href*="/discovery/item/"]',
      title: "小红书 · 笔记",
    },
    zhihu: {
      selector: ".AnswerItem,.Post-Main",
      body: ".RichContent-inner,.Post-RichTextContainer",
      title: "知乎",
    },
    web: {
      selector: "body",
      body: "body",
      author: "",
      link: "",
      title: doc.title,
    },
  };
  return configs[kind] || configs.web;
}
export function extractPost(el, kind, doc = document) {
  if (kind === "zhihu") return extractZhihu(el, doc);
  if (kind === "xiaohongshu") return extractNote(el, doc);
  const config = adapterFor(kind, doc);
  const timeLink = el.querySelector("time")?.closest("a[href]");
  const rawLink =
    el.getAttribute("permalink") ||
    (kind === "x" ? timeLink?.getAttribute("href") : null) ||
    (config.link &&
      [...el.querySelectorAll(config.link)]
        .find(
          (a) =>
            !a.parentElement?.closest('[role="link"][tabindex]') ||
            a.querySelector("time"),
        )
        ?.getAttribute("href"));
  const permalink = rawLink
    ? new URL(rawLink, doc.URL).href.split("?")[0]
    : null;
  const id =
    (kind === "x" ? permalink?.match(/\/status\/(\d+)/)?.[1] : null) ||
    el.getAttribute("thingid") ||
    el.getAttribute("thing-id") ||
    el.getAttribute("id") ||
    (kind === "x" ? permalink?.match(/\/status\/(\d+)/)?.[1] : permalink) ||
    el.getAttribute("permalink") ||
    el.textContent.trim().slice(0, 160);
  const username = el.querySelector('[data-testid="User-Name"]');
  const author =
    el.getAttribute("author") ||
    (config.author && el.querySelector(config.author)?.textContent.trim()) ||
    "";
  const handle =
    username?.textContent.match(/@[\w_]+/)?.[0] ||
    (kind === "x" && permalink
      ? "@" + new URL(permalink).pathname.split("/")[1]
      : "");
  const firstName =
    username?.querySelector('a:not([href*="/status/"])')?.textContent.trim() ||
    author.split("@")[0].replace(/[✓✔]/g, "").trim();
  const media = [];
  const owned = (node) =>
    kind === "x"
      ? node.closest('article[data-testid="tweet"]') === el &&
        !node.closest('[data-testid="quoteTweet"]')
      : !node.parentElement?.closest("shreddit-comment,.thing.comment") ||
        node.parentElement.closest("shreddit-comment,.thing.comment") === el;
  for (const image of [...el.querySelectorAll("img")].filter(owned)) {
    const url = image.currentSrc || image.src;
    if (
      url &&
      (kind !== "x" ||
        image.closest('[data-testid="tweetPhoto"],.photo') ||
        /pbs\.twimg\.com\/media\//.test(url) ||
        (image.naturalWidth > 80 && image.naturalHeight > 60)) &&
      !/profile_images|avatar|emoji|community[_-]?icon|snoovatar|award|badge/i.test(
        url,
      ) &&
      !image.closest(
        '[data-testid*="UserAvatar"],[data-testid="Tweet-User-Avatar"],[data-testid="videoComponent"]',
      )
    )
      media.push({ type: "image", url, alt: image.alt || "" });
  }
  const containers =
    kind === "x"
      ? [...el.querySelectorAll('[data-testid="videoComponent"]')].filter(owned)
      : [];
  const loose = [...el.querySelectorAll("video,shreddit-player")].filter(
    (node) =>
      owned(node) && !containers.some((container) => container.contains(node)),
  );
  for (const container of [...containers, ...loose]) {
    const video = container.matches("video,shreddit-player")
      ? container
      : container.querySelector("video");
    const poster =
      video?.poster ||
      video?.getAttribute("poster") ||
      container.querySelector("img")?.currentSrc ||
      container.querySelector("img")?.src ||
      "";
    const sources = videoSources(container, doc);
    const direct = video?.currentSrc || video?.src || "";
    const hls = sources.find((u) => /\.m3u8(?:\?|$)/.test(u));
    const playable =
      hls || (/^https?:/.test(direct) ? direct : sources[0] || "");
    const id = poster.match(
      /(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/(\w+)/,
    )?.[1];
    media.push({
      type: "video",
      url: playable,
      poster,
      alt: "视频",
      sources,
      ...(id ? { id } : {}),
    });
  }
  const seenMedia = new Set();
  for (let i = media.length - 1; i >= 0; i--) {
    const m = media[i];
    let key = m.id
      ? m.type + ":" + m.id
      : m.url || m.poster || `unresolved-${i}`;
    try {
      const u = new URL(m.url);
      if (u.hostname === "pbs.twimg.com") key = u.origin + u.pathname;
    } catch {}
    if (seenMedia.has(key)) media.splice(i, 1);
    else seenMedia.add(key);
  }
  const read = (selector) =>
    el.querySelector(selector)?.textContent.trim() || "";
  const stats =
    kind === "x"
      ? {
          replies:
            read('[data-testid="reply"]') ||
            el.getAttribute("data-replies") ||
            "",
          reposts:
            read('[data-testid="retweet"]') ||
            read(".stats > span:nth-child(2)").replace(/[^\d.,kKmM万]/g, ""),
          likes:
            read('[data-testid="like"],[data-testid="unlike"]') ||
            el.getAttribute("data-likes") ||
            "",
          views:
            read('a[href$="/analytics"]') ||
            read(".stats > span:nth-child(3)").replace(/[^\d.,kKmM万]/g, ""),
        }
      : {
          votes:
            el.getAttribute("score") || el.getAttribute("data-score") || "",
          comments: el.getAttribute("comment-count") || "",
        };
  const body = [...el.querySelectorAll(config.body)].find(owned);
  const profileImage = el.querySelector(
    'img[src*="profile_images"],[data-testid*="UserAvatar"] img,[data-testid="Tweet-User-Avatar"] img,img[src*="avatar"],img[src*="snoovatar"],[slot="authorIcon"] img,.author img',
  );
  const main =
    el.closest("shreddit-post") || doc.querySelector("shreddit-post");
  const community =
    el.getAttribute("subreddit-prefixed-name")?.replace(/^r\//, "") ||
    el.getAttribute("subreddit-name") ||
    main?.getAttribute("subreddit-prefixed-name")?.replace(/^r\//, "") ||
    doc.URL.match(/\/r\/([^/]+)/)?.[1] ||
    "";
  return {
    // Reddit DOM ids use t1_/t3_ prefixes while parentid refers to the same ids.
    id: kind === "reddit" ? String(id).replace(/^t[13]_/, "") : id,
    author,
    authorName: kind === "x" ? firstName : author,
    authorHandle: handle,
    avatarUrl:
      el.getAttribute("author-icon") ||
      el.getAttribute("icon-url") ||
      profileImage?.currentSrc ||
      profileImage?.src ||
      "",
    verified: !!el.querySelector('[data-testid="icon-verified"],.verified'),
    text: (
      body?.innerText ||
      body?.textContent ||
      el.innerText ||
      el.textContent
    ).trim(),
    title:
      kind === "reddit"
        ? el.getAttribute("post-title") ||
          el.querySelector("h1,h2,h3")?.textContent.trim() ||
          ""
        : "",
    community,
    isComment: el.matches("shreddit-comment,.thing.comment"),
    replyToHandle: kind === "x" ? (
      [...el.querySelectorAll('div,span')].map((node) => {
        const value = node.textContent?.trim() || "";
        return value.length <= 120 && /(?:replying to|正在回复|回复给)\\s+@[A-Za-z0-9_]+/i.test(value)
          ? value.match(/@[A-Za-z0-9_]+/)?.[0] : null;
      }).find(Boolean) || ""
    ) : "",
    parentId: (
      el.getAttribute("parentid") || el.getAttribute("parent-id") ||
      el.getAttribute("data-parent-id") || ""
    ).replace(/^t[13]_/, "") || null,
    url:
      permalink ||
      (el.getAttribute("permalink")
        ? new URL(el.getAttribute("permalink"), doc.URL).href
        : null),
    depth: Number(el.getAttribute("depth") || 0),
    postedAt:
      el.querySelector("time")?.getAttribute("datetime") ||
      el.getAttribute("created-timestamp") ||
      null,
    stats,
    media,
    capturedAt: new Date().toISOString(),
  };
}

function extractNote(el, doc) {
  const comment = el.matches(".comment-item");
  const text = (selector) =>
    el.querySelector(selector)?.textContent.trim() || "";
  const avatar = el.querySelector(
    ".author-container img,.author img,.avatar img,img.avatar",
  );
  const media = [
    ...el.querySelectorAll(
      comment ? ".comment-content img" : ".swiper-slide img,.note-slider img",
    ),
  ]
    .map((i) => ({
      type: "image",
      url: i.currentSrc || i.src || i.dataset.src,
      alt: i.alt || "",
    }))
    .filter((m) => /^https?:/.test(m.url));
  for (const v of el.querySelectorAll("video")) {
    const sources = videoSources(el, doc);
    media.push({
      type: "video",
      url: sources[0] || v.currentSrc || v.src,
      poster: v.poster || "",
      sources,
    });
  }
  return {
    id: comment
      ? el.getAttribute("data-comment-id") || el.getAttribute("data-id") || el.id || text(".content,.note-text")
      : new URL(doc.URL).pathname,
    isComment: comment,
    depth: comment ? 1 : 0,
    parentId: comment ? (
      el.getAttribute("data-parent-id") ||
      el.getAttribute("parent-id") ||
      el.getAttribute("data-reply-to-id") ||
      el.parentElement?.closest(".comment-item")?.getAttribute("data-comment-id") ||
      el.parentElement?.closest(".comment-item")?.getAttribute("data-id") ||
      el.parentElement?.closest(".comment-item")?.id ||
      null
    ) : null,
    replyToName: comment ? text(".reply-to,.reply-user,.reply-name,.reply-target,.reply-info .username") : "",
    author: text(".author-container .username,.author .username,.author .name"),
    authorName: text(
      ".author-container .username,.author .username,.author .name",
    ),
    avatarUrl: avatar?.currentSrc || avatar?.src || "",
    title: comment ? "" : text("#detail-title,.note-title"),
    text: text(
      comment ? ".content,.note-text" : "#detail-desc,.note-text,.desc",
    ),
    url: comment ? null : doc.URL,
    postedAt: el.querySelector("time")?.getAttribute("datetime") || el.querySelector("[datetime]")?.getAttribute("datetime") || null,
    postedAtText: comment ? text(".date,.time,.comment-time,.date-time,.create-time,.comment-info .date") : "",
    stats: {
      likes: text(".like-wrapper .count,.like .count"),
      comments: text(".chat-wrapper .count"),
      saves: text(".collect-wrapper .count"),
    },
    media: media.filter((m, i, a) => a.findIndex((x) => x.url === m.url) === i),
    capturedAt: new Date().toISOString(),
  };
}

/** Scope every field to this answer/article; recommendations are never a root. */
function extractZhihu(el, doc) {
  const comment =
    el.matches(ZHIHU_COMMENTS + "," + ZHIHU_COMMENT_BODY) ||
    (el.hasAttribute("data-id") && !!el.querySelector(ZHIHU_COMMENT_BODY));
  const owned = (node) =>
    !comment ||
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
          const explicit = el.getAttribute("data-parent-id") ||
            el.getAttribute("parent-id") || el.getAttribute("data-reply-to-id");
          const parent = el.parentElement && zhihuCommentOwner(el.parentElement);
          return explicit || (parent && parent !== el ? (
            parent.getAttribute("data-comment-id") ||
            parent.getAttribute("data-id") || parent.id || null
          ) : null);
        })()
      : null,
    depth: comment ? 1 : 0,
    replyToName: comment ? read(".CommentItem-replyTo,.CommentItemV2-replyTo,.reply-to,.reply-user") : "",
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
    postedAtText: comment ? read(".CommentItem-time,.CommentItemV2-time,.ContentItem-time,.comment-time,.time") : "",
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
