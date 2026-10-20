/** Attachment identity is shared by capture, incremental merging and display. */
export function imageIdentity(raw = "") {
  try {
    const url = new URL(raw);
    if (url.hostname === "pbs.twimg.com")
      return (
        url.origin +
        url.pathname.replace(/\.(?:jpe?g|png|webp|gif)(?::\w+)?$/i, "")
      );
    if (/(^|\.)xhscdn\.com$/.test(url.hostname))
      return "xhscdn:" + url.pathname.split("/").at(-1).split("!")[0];
  } catch {}
  return raw;
}

const sources = (media) => [
  ...new Set(
    [media.url, ...(media.sources || [])].filter(
      (url) => url && !/^blob:/i.test(url),
    ),
  ),
];
const videoIdentity = (media) =>
  sources(media)
    .map(
      (url) =>
        url.match(
          /video\.twimg\.com\/(?:ext_tw_video|amplify_video)\/(\w+)\//,
        )?.[1],
    )
    .find(Boolean);
const posterId = (media) =>
  media.poster?.match(
    /(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/(\w+)/,
  )?.[1];

function sameVideo(a, b) {
  if (a.id && b.id && a.id === b.id) return true;
  if (sources(a).some((url) => sources(b).includes(url))) return true;
  const aVideo = videoIdentity(a),
    bVideo = videoIdentity(b);
  return !!aVideo && aVideo === bVideo;
}

export function normalizeMedia(records = []) {
  const result = [];
  for (const entry of records) {
    let matches = result.filter(
      (old) =>
        old.type === entry.type &&
        (entry.type === "video"
          ? sameVideo(old, entry)
          : imageIdentity(old.url) === imageIdentity(entry.url)),
    );
    if (!matches.length && entry.type === "video" && entry.poster) {
      // A DOM player can expose only a blob and a resized poster. Match it to
      // one known attachment, without collapsing two identified video clips.
      matches = result.filter(
        (old) =>
          old.type === "video" &&
          old.poster &&
          imageIdentity(old.poster) === imageIdentity(entry.poster) &&
          !(
            old.id &&
            entry.id &&
            old.id !== entry.id &&
            !(old.id === posterId(old) && !sources(old).length) &&
            !(entry.id === posterId(entry) && !sources(entry).length)
          ) &&
          (!sources(old).length ||
            !sources(entry).length ||
            !!old.id !== !!entry.id),
      );
    }
    const old = matches.length === 1 ? matches[0] : null;
    if (!old) {
      result.push({ ...entry });
      continue;
    }
    if (entry.type === "video") {
      const urls = [...new Set([...sources(old), ...sources(entry)])];
      Object.assign(old, {
        ...entry,
        ...old,
        id: old.id || entry.id,
        poster: old.poster || entry.poster || "",
        url: urls[0] || "",
        sources: urls,
      });
    }
  }
  const posters = new Set(
    result
      .filter((m) => m.type === "video" && m.poster)
      .map((m) => imageIdentity(m.poster)),
  );
  return result.filter(
    (m) =>
      m.type !== "image" ||
      (!posters.has(imageIdentity(m.url)) &&
        !/^https?:\/\/pbs\.twimg\.com\/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//i.test(
          m.url || "",
        )),
  );
}
