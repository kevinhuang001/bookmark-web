import { videoSources } from "./video.js";
/** DOM adapters deliberately use the user's rendered session, never private APIs. */
export function platform(host) {
  if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) return "x";
  if (/(^|\.)reddit\.com$/.test(host)) return "reddit";
  if (/(^|\.)xiaohongshu\.com$/.test(host)) return "xiaohongshu";
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
    !node.parentElement?.closest("shreddit-comment,.thing.comment") ||
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
  const sources = videoSources(el, doc);
  for (const video of [...el.querySelectorAll("video,shreddit-player")].filter(
    owned,
  )) {
    const direct = video.currentSrc || video.src || "";
    const playable = /^https?:/.test(direct)
      ? direct
      : sources.find((u) => /\.m3u8(?:\?|$)/.test(u)) || sources[0] || direct;
    const hls = sources.find((u) => /\.m3u8(?:\?|$)/.test(u));
    media.push({
      type: "video",
      url: hls || playable,
      poster: video.poster || video.getAttribute("poster") || "",
      alt: "视频",
      sources,
    });
  }
  const seenMedia = new Set();
  for (let i = media.length - 1; i >= 0; i--) {
    const m = media[i];
    let key = m.url;
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
    id,
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
    parentId:
      el.getAttribute("parentid") || el.getAttribute("parent-id") || null,
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
      ? el.id || text(".content,.note-text")
      : new URL(doc.URL).pathname,
    isComment: comment,
    depth: comment ? 1 : 0,
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
    stats: {
      likes: text(".like-wrapper .count,.like .count"),
      comments: text(".chat-wrapper .count"),
      saves: text(".collect-wrapper .count"),
    },
    media: media.filter((m, i, a) => a.findIndex((x) => x.url === m.url) === i),
    capturedAt: new Date().toISOString(),
  };
}
