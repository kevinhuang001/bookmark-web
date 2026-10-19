import { t as tr } from "../i18n.js";
import { threadComments, redditThreads, nativeComment } from "./comments.js";

/** Comments expand or scroll in the current view and never select another page. */
export function commentActions(
  root,
  { kind, selected, items, renderX, hydrate },
) {
  return (event, action) => {
    if (!["comments", "x-comments"].includes(action?.dataset.socialAction))
      return false;
    event.preventDefault();
    event.stopPropagation();
    const item = items.find((entry) => entry.id === action.dataset.id);
    if (!item) return true;
    if (selected) {
      root
        .querySelector(
          ".x-thread-group,.reddit-comments-title,.zhihu-comments,.note-comments",
        )
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    }
    const card = action.closest(".x-post,.reddit-post,.zhihu-post");
    if (!card) return true;
    const existing = card.querySelector(":scope > .inline-comments");
    if (existing) {
      existing.remove();
      action.setAttribute("aria-expanded", "false");
      return true;
    }
    const panel = document.createElement("section");
    panel.className = `inline-comments ${kind === "x" ? "x-inline-comments" : kind + "-inline-comments"}`;
    panel.innerHTML =
      (kind === "x"
        ? threadComments(
            item,
            kind,
            (post) =>
              `<div class="x-thread-entry">${renderX(post, item)}</div>`,
          )
        : kind === "reddit"
          ? redditThreads(item)
          : threadComments(item, kind, (post, depth) =>
              nativeComment(post, item, kind, depth),
            )) || `<p class="note-no-comments">${tr("暂无已收藏评论")}</p>`;
    card.append(panel);
    action.setAttribute("aria-expanded", "true");
    void hydrate(panel, item);
    return true;
  };
}
