/** Draw actual parent edges in the avatar gutter, after layout and media loading. */
export function attachXThreadLines(root) {
  let frame;
  const draw = () => {
    frame = null;
    for (const scope of root.querySelectorAll(".x-thread-scope")) {
      const bounds = scope.getBoundingClientRect();
      const articles = [...scope.querySelectorAll(".x-post[data-x-post-id]")];
      if (scope.matches(".x-post[data-x-post-id]")) articles.unshift(scope);
      const posts = new Map(
        articles.map((post) => [post.dataset.xPostId, post]),
      );
      let svg = scope.querySelector(":scope > .x-thread-lines");
      if (!svg) {
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("x-thread-lines");
        svg.setAttribute("aria-hidden", "true");
        scope.append(svg);
      }
      svg.setAttribute("width", String(bounds.width));
      svg.setAttribute("height", String(bounds.height));
      const paths = [];
      for (const entry of scope.querySelectorAll(
        ".x-thread-entry[data-x-parent-id]",
      )) {
        const child = entry.querySelector(".x-post"),
          parent = posts.get(entry.dataset.xParentId);
        const from = parent
          ?.querySelector(":scope > .social-avatar")
          ?.getBoundingClientRect();
        const to = child
          ?.querySelector(":scope > .social-avatar")
          ?.getBoundingClientRect();
        if (!from || !to || from.top >= to.top) continue;
        const x = from.left + from.width / 2 - bounds.left;
        const top = from.bottom - bounds.top + 3,
          bottom = to.top - bounds.top - 3;
        const path = document.createElementNS(svg.namespaceURI, "path");
        const adjacent =
          articles.indexOf(child) === articles.indexOf(parent) + 1;
        const lane = 5 + Math.min(Number(entry.dataset.xDepth || 0), 3) * 3;
        path.setAttribute(
          "d",
          adjacent
            ? `M ${x} ${top} V ${bottom}`
            : `M ${x} ${top} V ${top + 4} H ${lane} V ${to.top + to.height / 2 - bounds.top} H ${to.left - bounds.left - 3}`,
        );
        path.dataset.parentId = entry.dataset.xParentId;
        path.dataset.childId = child.dataset.xPostId;
        paths.push(path);
      }
      svg.replaceChildren(...paths);
    }
    for (const svg of root.querySelectorAll(".x-thread-lines"))
      if (!svg.parentElement.classList.contains("x-thread-scope")) svg.remove();
  };
  const schedule = () => {
    if (frame == null) frame = requestAnimationFrame(draw);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(root);
  const mutations = new MutationObserver((records) => {
    if (
      records.every(
        (record) =>
          record.target.closest?.(".x-thread-lines") ||
          [...record.addedNodes, ...record.removedNodes].every(
            (node) =>
              node.nodeType === 1 && node.classList.contains("x-thread-lines"),
          ),
      )
    )
      return;
    for (const node of root.querySelectorAll(".x-post")) resize.observe(node);
    schedule();
  });
  mutations.observe(root, { childList: true, subtree: true });
  for (const node of root.querySelectorAll(".x-post")) resize.observe(node);
  root.addEventListener("load", schedule, true);
  schedule();
  return () => {
    if (frame != null) cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    root.removeEventListener("load", schedule, true);
  };
}
