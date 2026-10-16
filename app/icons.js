import { nodes, brands } from "./icon-data.js";
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
/** Lucide ISC/MIT geometry and Simple Icons CC0 brand marks, bundled locally. */
export function icon(name, className = "") {
  const classes = `icon ${brands[name] ? "brand-icon" : "lucide-icon"} ${name === "verified" ? "verified" : ""} ${className}`;
  return `<svg class="${escapeHtml(classes)}" data-icon-source="${brands[name] ? "simple-icons" : "lucide"}" viewBox="0 0 24 24" aria-hidden="true" ${brands[name] ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'}>${brands[name] || nodes[name] || nodes.info}</svg>`;
}
export function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll("[data-icon]"))
    node.innerHTML = icon(node.dataset.icon);
}
