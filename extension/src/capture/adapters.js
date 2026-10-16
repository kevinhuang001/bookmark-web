/** DOM adapters deliberately use the user's rendered session, never private APIs. */
export function platform(host) {
  if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) return "x";
  if (/(^|\.)reddit\.com$/.test(host)) return "reddit";
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
  const config = adapterFor(kind, doc);
  const rawLink =
    config.link && el.querySelector(config.link)?.getAttribute("href");
  const permalink = rawLink
    ? new URL(rawLink, doc.URL).href.split("?")[0]
    : null;
  const id =
    el.getAttribute("thingid") ||
    el.getAttribute("id") ||
    permalink ||
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
  for (const image of el.querySelectorAll("img")) {
    const url = image.currentSrc || image.src;
    if (
      url &&
      !/profile_images|avatar|emoji|community[_-]?icon|snoovatar|award|badge/i.test(
        url,
      ) &&
      !image.closest(
        '[data-testid*="UserAvatar"],[data-testid="Tweet-User-Avatar"]',
      )
    )
      media.push({ type: "image", url, alt: image.alt || "" });
  }
  for (const video of el.querySelectorAll("video"))
    media.push({
      type: "video",
      url: video.currentSrc || video.src,
      poster: video.poster || "",
      alt: "视频",
    });
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
  const body = el.querySelector(config.body);
  const profileImage = el.querySelector(
    'img[src*="profile_images"],[data-testid*="UserAvatar"] img,[data-testid="Tweet-User-Avatar"] img',
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
    avatarUrl: profileImage?.currentSrc || profileImage?.src || "",
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
    url: permalink,
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
