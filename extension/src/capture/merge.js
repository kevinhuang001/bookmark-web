import { normalizeMedia } from "../../../app/media-records.js";

export function mergePost(previous, current) {
  if (!previous) return { ...current, media: normalizeMedia(current.media) };
  const media = normalizeMedia([
    ...(current.media || []),
    ...(previous.media || []),
  ]);
  // Virtualized social UIs may briefly drop author/relationship/time fields.
  // A later incomplete DOM pass must not destroy provenance already captured.
  const merged = { ...previous, ...current, media };
  for (const field of [
    "parentId",
    "threadRootId",
    "replyToName",
    "replyToHandle",
    "postedAt",
    "postedAtText",
    "author",
    "authorName",
    "authorHandle",
    "avatarUrl",
  ]) {
    if (!current[field] && previous[field]) merged[field] = previous[field];
  }
  return merged;
}
