/** Runs in the page's MAIN world; reads only data belonging to visible posts. */
export function readPageData() {
  const snapshot = () => {
    const posts = {};
    const http = (value) => {
      if (typeof value !== "string") return "";
      try {
        const url = new URL(value, location.href);
        return /^https?:$/.test(url.protocol) ? url.href : "";
      } catch {
        return "";
      }
    };
    if (/(^|\.)xiaohongshu\.com$/.test(location.hostname)) {
      const id = location.pathname.match(
        /\/(?:explore|discovery\/item)\/([a-z\d]+)/i,
      )?.[1];
      const map = globalThis.__INITIAL_STATE__?.note?.noteDetailMap;
      const entry = map?.[id] || map?.value?.[id];
      const note = entry?.note || entry?.value?.note;
      if (note && String(note.noteId || note.id || id) === id) {
        const media = [];
        for (const image of note.imageList || []) {
          const url = http(
            image.urlDefault ||
              image.urlPre ||
              image.url ||
              image.infoList?.find((i) => i.imageScene === "WB_DFT")?.url ||
              image.infoList?.[0]?.url,
          );
          if (url)
            media.push({
              type: "image",
              url,
              ...(image.fileId ? { id: image.fileId } : {}),
            });
        }
        const streams = Object.values(note.video?.media?.stream || {}).flatMap(
          (value) => (Array.isArray(value) ? value : []),
        );
        const urls = streams
          .sort(
            (a, b) =>
              (b.avgBitrate || b.videoBitrate || 0) -
              (a.avgBitrate || a.videoBitrate || 0),
          )
          .flatMap((stream) => [stream.masterUrl, ...(stream.backupUrls || [])])
          .map(http)
          .filter(Boolean);
        const direct = http(note.video?.consumer?.originVideoKey);
        if (direct && /\.mp4(?:\?|$)/i.test(direct)) urls.push(direct);
        if (urls.length) {
          const poster = media[0]?.url || "";
          media.splice(0, media.length, {
            type: "video",
            url: urls[0],
            sources: [urls[0]],
            poster,
          });
        }
        if (media.length) posts["note:" + id] = { media, complete: true };
      }
    }
    if (!/(^|\.)(?:x\.com|twitter\.com)$/.test(location.hostname)) return posts;
    for (const article of document.querySelectorAll(
      'article[data-testid="tweet"]',
    )) {
      const link = [...article.querySelectorAll('a[href*="/status/"]')].find(
        (node) =>
          node.querySelector("time") &&
          !node.closest('[data-testid="quoteTweet"]'),
      );
      const id = link?.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
      if (!id) continue;
      const queue = [];
      for (const node of [
        article,
        ...article.querySelectorAll(
          '[data-testid="tweetText"],[data-testid="tweetPhoto"],[data-testid="User-Name"]',
        ),
      ]) {
        for (const key of Object.keys(node))
          if (/^__react(?:Props|Fiber)\$/.test(key)) queue.push(node[key]);
      }
      const seen = new WeakSet();
      let count = 0;
      while (count < queue.length && count < 12000) {
        const value = queue[count++];
        if (
          !value ||
          typeof value !== "object" ||
          seen.has(value) ||
          value instanceof Node
        )
          continue;
        seen.add(value);
        const legacy = value.legacy || value;
        if (
          String(value.rest_id || legacy.id_str || "") === id &&
          (legacy.extended_entities ||
            legacy.entities?.media ||
            Object.hasOwn(legacy, "in_reply_to_status_id_str"))
        ) {
          const media = [];
          for (const entry of legacy.extended_entities?.media ||
            legacy.entities?.media ||
            []) {
            const poster = http(entry.media_url_https || entry.media_url);
            if (entry.type === "photo" && poster) {
              const url = new URL(poster);
              url.searchParams.set("name", "orig");
              media.push({
                type: "image",
                id: entry.id_str,
                url: url.href,
                alt: entry.ext_alt_text || "",
              });
            } else if (["video", "animated_gif"].includes(entry.type)) {
              const variants = (entry.video_info?.variants || []).filter((v) =>
                http(v.url),
              );
              const mp4 = variants
                .filter((v) => v.content_type === "video/mp4")
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
              const url =
                mp4[0]?.url ||
                variants.find((v) => /mpegurl/i.test(v.content_type))?.url;
              if (url)
                media.push({
                  type: "video",
                  id: entry.id_str,
                  url,
                  poster,
                  sources: [url],
                });
            }
          }
          posts[id] = {
            parentId: legacy.in_reply_to_status_id_str || null,
            replyToHandle: legacy.in_reply_to_screen_name
              ? "@" + legacy.in_reply_to_screen_name
              : "",
            media,
            complete: media.length > 0,
          };
          break;
        }
        for (const key of Object.keys(value)) {
          if (
            [
              "return",
              "child",
              "sibling",
              "stateNode",
              "_owner",
              "quoted_status_result",
              "retweeted_status_result",
            ].includes(key)
          )
            continue;
          try {
            if (value[key] && typeof value[key] === "object")
              queue.push(value[key]);
          } catch {}
        }
      }
    }
    return posts;
  };
  const key = "__glassmarkPageData";
  if (arguments[0] === "stop") {
    const session = globalThis[key];
    clearInterval(session?.timer);
    clearTimeout(session?.timeout);
    delete globalThis[key];
    return { ...session?.posts, ...snapshot() };
  }
  const posts = snapshot();
  if (arguments[0] === "start") {
    clearInterval(globalThis[key]?.timer);
    clearTimeout(globalThis[key]?.timeout);
    const session = { posts };
    session.timer = setInterval(() => {
      try {
        Object.assign(session.posts, snapshot());
      } catch {}
    }, 500);
    session.timeout = setTimeout(() => {
      clearInterval(session.timer);
      delete globalThis[key];
    }, 180000);
    globalThis[key] = session;
  }
  return posts;
}

export function enrichPost(post, kind, pageData = {}) {
  const key =
    kind === "xiaohongshu"
      ? "note:" + String(post.id).split("/").filter(Boolean).at(-1)
      : String(post.id);
  const data = pageData[key];
  if (!data || (post.isComment && kind !== "x")) return post;
  return {
    ...post,
    parentId: data.parentId || post.parentId,
    replyToHandle: data.replyToHandle || post.replyToHandle,
    media: data.complete ? data.media : post.media,
  };
}

export function enrichCapture(capture, pageData, options = {}) {
  const resources = new Set(capture.resources);
  capture.posts = capture.posts.map((post) => {
    const result = enrichPost(post, capture.platform, pageData);
    result.media = (result.media || []).filter((m) =>
      m.type === "video"
        ? options.includeVideos !== false
        : options.includeImages !== false,
    );
    for (const media of result.media)
      for (const url of [media.url, media.poster, ...(media.sources || [])])
        if (/^https?:/.test(url || "")) resources.add(url);
    return result;
  });
  capture.resources = [...resources];
  return capture;
}
