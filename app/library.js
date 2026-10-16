/** One classification rule shared by navigation, folder counts and feed rendering. */
export function itemPlatform(item) {
  if (["web", "x", "reddit", "xiaohongshu", "zhihu"].includes(item.platform))
    return item.platform;
  try {
    const host = new URL(item.url).hostname;
    if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) return "x";
    if (/(^|\.)reddit\.com$/.test(host)) return "reddit";
    if (/(^|\.)xiaohongshu\.com$/.test(host)) return "xiaohongshu";
    if (/(^|\.)zhihu\.com$/.test(host)) return "zhihu";
  } catch {}
  return "web";
}
export function descendants(folders, id, seen = new Set()) {
  if (seen.has(id)) return seen;
  seen.add(id);
  for (const folder of folders)
    if (folder.parentId === id) descendants(folders, folder.id, seen);
  return seen;
}
export function itemsInView(
  items,
  { view = "web", folder = null, tag = null, folders = [] } = {},
) {
  const ids = folder && view === "web" ? descendants(folders, folder) : null;
  return items.filter(
    (item) =>
      itemPlatform(item) === view &&
      (!ids || ids.has(item.folderId)) &&
      (!tag || (item.tags || []).includes(tag)),
  );
}
export function rootPost(item) {
  return (
    item.posts?.find((p) => !p.isComment) ||
    item.posts?.[0] || {
      id: item.id,
      author: "",
      text: item.text,
      title: item.title,
      url: item.url,
    }
  );
}
export function metric(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/,/g, "");
  const found = cleaned.match(/([\d.]+)\s*([kmb万亿]?)/i);
  if (!found) return 0;
  return (
    Number(found[1]) *
    ({ k: 1000, m: 1000000, b: 1000000000, 万: 10000, 亿: 100000000 }[
      found[2].toLowerCase()
    ] || 1)
  );
}
export function feedItems(
  items,
  { threads = false, author = "", community = "", sort = "recent" } = {},
) {
  return items
    .filter(
      (item) =>
        (!threads || (item.posts?.length || 0) > 1) &&
        (!author ||
          (rootPost(item).authorName || rootPost(item).author) === author) &&
        (!community ||
          (rootPost(item).community || communityFromUrl(item.url)) ===
            community),
    )
    .sort((a, b) =>
      sort === "best"
        ? metric(rootPost(b).stats?.votes || rootPost(b).stats?.likes) -
          metric(rootPost(a).stats?.votes || rootPost(a).stats?.likes)
        : String(b.capturedAt).localeCompare(String(a.capturedAt)),
    );
}
export function communityFromUrl(url) {
  try {
    return new URL(url).pathname.match(/\/r\/([^/]+)/)?.[1] || "reddit";
  } catch {
    return "reddit";
  }
}
