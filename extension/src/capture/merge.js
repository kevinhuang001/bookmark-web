/** Media arrive lazily; seeing a post again enriches it instead of freezing its first frame. */
export function mediaKey(media) {
  if (media.id) return media.type + ":" + media.id;
  const value = media.type === "video" ? media.poster || media.url : media.url;
  try {
    const url = new URL(value);
    if (url.hostname === "pbs.twimg.com")
      return media.type + ":" + url.origin + url.pathname;
  } catch {}
  return media.type + ":" + value;
}
export function mergePost(previous, current) {
  if (!previous) return current;
  const media = new Map((previous.media || []).map((m) => [mediaKey(m), m]));
  for (const entry of current.media || []) {
    const key = mediaKey(entry),
      old = media.get(key);
    const sources = [
      ...new Set([...(old?.sources || []), ...(entry.sources || [])]),
    ];
    media.set(key, {
      ...old,
      ...entry,
      url: /^https?:/.test(entry.url || "") ? entry.url : old?.url || entry.url,
      sources,
    });
  }
  // Virtualized social UIs may briefly drop author/relationship/time fields.
  // A later incomplete DOM pass must not destroy provenance already captured.
  const merged = { ...previous, ...current, media: [...media.values()] };
  for (const field of ["parentId", "threadRootId", "replyToName", "replyToHandle", "postedAt", "postedAtText", "author", "authorName", "authorHandle", "avatarUrl"]) {
    if (!current[field] && previous[field]) merged[field] = previous[field];
  }
  return merged;
}
