// A thread container can hold sibling reply rows rather than nested comments.
export function commentIdentity(el, contentSelector) {
  if (!el) return null;
  return (
    el.getAttribute("data-comment-id") ||
    el.getAttribute("data-id") ||
    el.id ||
    el.querySelector(contentSelector)?.textContent.trim() ||
    null
  );
}
export function commentText(content, targetSelector) {
  if (!content) return "";
  const copy = content.cloneNode(true);
  for (const target of copy.querySelectorAll(targetSelector)) target.remove();
  return copy.textContent
    .replace(/^\s*(?:回复|Replying to)\s*[:：]\s*/i, "")
    .trim();
}
