/** Build saved conversations without inventing parents from position or depth. */
export function commentThreads(posts = []) {
  const comments = posts.slice(1);
  const known = new Map(
    posts.filter((p) => p.id).map((p) => [String(p.id), p]),
  );
  const children = new Map();
  const roots = [];
  const parents = new Map();
  for (const post of comments) {
    let parent = known.get(String(post.parentId || ""));
    if (!parent && (post.replyToName || post.replyToHandle)) {
      const target = String(post.replyToHandle || post.replyToName)
        .replace(/^(?:回复|Replying to)\s*/i, "")
        .trim();
      const matches = posts.filter(
        (p) =>
          p !== post &&
          [p.authorName, p.authorHandle, p.author].some(
            (name) => name === target,
          ),
      );
      // An explicit reply target can identify a parent only when unambiguous.
      if (matches.length === 1) parent = matches[0];
    }
    if (!parent) parent = known.get(String(post.threadRootId || ""));
    if (parent && parent !== post) parents.set(post, parent);
    if (parent && parent !== post && parent !== posts[0]) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(post);
    } else roots.push(post);
  }
  const visited = new Set();
  const walk = (post, depth, entries) => {
    if (visited.has(post)) return;
    visited.add(post);
    entries.push({ post, depth, parent: parents.get(post) || null });
    for (const child of children.get(post) || [])
      walk(child, depth + 1, entries);
  };
  const groups = [];
  // Preserve every saved comment, including orphans and malformed cycles.
  for (const post of [...roots, ...comments]) {
    if (visited.has(post)) continue;
    const entries = [];
    walk(post, 0, entries);
    groups.push(entries);
  }
  return groups;
}
