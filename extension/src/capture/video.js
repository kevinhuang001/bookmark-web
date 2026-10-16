/** Read only media already exposed by the rendered document and its resource timing. */
export function videoSources(element, doc = document) {
  const found = new Set();
  const add = (value) => {
    if (typeof value !== "string") return;
    try {
      const u = new URL(value, doc.URL);
      if (
        /^https?:$/.test(u.protocol) &&
        /\.(mp4|webm|m3u8)(?:\?|$)/i.test(u.href)
      )
        found.add(u.href);
    } catch {}
  };
  const videos = [
    ...(element.matches?.("video,source,shreddit-player,video-player")
      ? [element]
      : []),
    ...element.querySelectorAll("video,source,shreddit-player,video-player"),
  ];
  for (const node of [element, ...videos]) {
    add(node.currentSrc);
    add(node.src);
    for (const attr of node.attributes) {
      add(attr.value);
      if (/json|video|media|playback/i.test(attr.name)) {
        try {
          const walk = (v) => {
            if (typeof v === "string") add(v);
            else if (v && typeof v === "object") Object.values(v).forEach(walk);
          };
          walk(JSON.parse(attr.value));
        } catch {}
      }
    }
  }
  const posters =
    videos.map((v) => v.poster || v.getAttribute("poster") || "").join(" ") +
    " " +
    [...element.querySelectorAll("img")]
      .map((i) => i.currentSrc || i.src)
      .join(" ");
  const ids = [
    ...posters.matchAll(
      /(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/(\w+)/g,
    ),
  ].map((m) => m[1]);
  const timings =
    doc.defaultView?.performance.getEntriesByType("resource") || [];
  for (const entry of timings) {
    const url = entry.name;
    if (ids.some((id) => url.includes("/" + id + "/"))) add(url);
    if (
      /v\.redd\.it\//.test(url) &&
      [...videos].some((v) =>
        [v.src, v.currentSrc, ...[...v.attributes].map((a) => a.value)].some(
          (x) =>
            typeof x === "string" &&
            x.includes(new URL(url).pathname.split("/")[1]),
        ),
      )
    )
      add(url);
  }
  // Reddit exposes a silent DASH rendition in <video>; its public HLS manifest
  // contains the associated audio track and is archived as a bounded VOD graph.
  for (const url of [...found])
    if (/^https:\/\/v\.redd\.it\/[^/]+\/DASH_/.test(url))
      add(new URL("HLSPlaylist.m3u8", url).href);
  return [...found];
}
