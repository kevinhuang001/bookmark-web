import { extractTimeline } from "./adapters/timeline.js";
import { extractNote } from "./adapters/note.js";
import { extractZhihu } from "./adapters/zhihu.js";
export { platform, adapterFor } from "./platforms.js";
/** One entry point dispatches to isolated, source-specific DOM readers. */
export function extractPost(element, kind, doc = document) {
  if (kind === "zhihu") return extractZhihu(element, doc);
  if (kind === "xiaohongshu") return extractNote(element, doc);
  return extractTimeline(element, kind, doc);
}
