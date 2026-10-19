import { videoSources } from "../video.js";
import { adapterFor } from "../platforms.js";
import { xPostIdentity, ownsXContent } from "../identity.js";
export function extractTimeline(el, kind, doc = document) {
  const config = adapterFor(kind, doc);
  const identity = kind === "x" ? xPostIdentity(el, doc) : null;
  const rawLink =
    kind === "x"
      ? identity?.url
      : el.getAttribute("permalink") ||
        (config.link && el.querySelector(config.link)?.getAttribute("href"));
  const permalink = rawLink
    ? new URL(rawLink, doc.URL).href.split("?")[0]
    : null;
  const id =
    kind === "x"
      ? identity?.id || null
      : el.getAttribute("thingid") ||
        el.getAttribute("thing-id") ||
        el.getAttribute("id") ||
        permalink ||
        el.getAttribute("permalink") ||
        el.textContent.trim().slice(0, 160);
  const owned = (node) =>
    kind === "x"
      ? ownsXContent(el, node)
      : !node.parentElement?.closest("shreddit-comment,.thing.comment") ||
        node.parentElement.closest("shreddit-comment,.thing.comment") === el;
  const find = (selector) => [...el.querySelectorAll(selector)].find(owned);
  const username = find('[data-testid="User-Name"]');
  const author =
    el.getAttribute("author") ||
    (config.author && find(config.author)?.textContent.trim()) ||
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
  const read = (selector) => find(selector)?.textContent.trim() || "";
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
  const profileImage = find(
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
    text: (body?.innerText || body?.textContent || "").trim(),
    title:
      kind === "reddit"
        ? el.getAttribute("post-title") ||
          el.querySelector("h1,h2,h3")?.textContent.trim() ||
          ""
        : "",
    community,
    isComment: el.matches("shreddit-comment,.thing.comment"),
    replyToHandle:
      kind === "x"
        ? [...el.querySelectorAll("div,span")]
            .map((node) => {
              const value = node.textContent?.trim() || "";
              return !node.closest(
                '[data-testid="tweetText"],[data-testid="quoteTweet"]',
              ) &&
                value.length <= 120 &&
                /^(?:replying to|正在回复|回复给)\s+@[A-Za-z0-9_]+/i.test(value)
                ? value.match(/@[A-Za-z0-9_]+/)?.[0]
                : null;
            })
            .find(Boolean) || ""
        : "",
    parentId:
      (
        el.getAttribute("parentid") ||
        el.getAttribute("parent-id") ||
        el.getAttribute("data-parent-id") ||
        el.getAttribute("data-in-reply-to-status-id") ||
        (kind === "reddit"
          ? (() => {
              const parent = el.parentElement?.closest(
                "shreddit-comment,.thing.comment",
              );
              return (
                parent?.getAttribute("thingid") ||
                parent?.getAttribute("thing-id") ||
                parent?.id
              );
            })()
          : "") ||
        ""
      ).replace(/^t[13]_/, "") || null,
    url:
      permalink ||
      (el.getAttribute("permalink")
        ? new URL(el.getAttribute("permalink"), doc.URL).href
        : null),
    depth: Number(el.getAttribute("depth") || 0),
    postedAt:
      find("time")?.getAttribute("datetime") ||
      el.getAttribute("created-timestamp") ||
      null,
    stats,
    media,
    capturedAt: new Date().toISOString(),
  };
}
