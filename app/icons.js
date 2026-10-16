const paths = {
  file: '<path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="10.8" cy="10.8" r="7.3"/><path d="m16.1 16.1 4.4 4.4"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  comment:
    '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.8-4A8.5 8.5 0 1 1 21 11.5Z"/>',
  repeat:
    '<path d="m4 8 4-4 4 4M8 4v12a3 3 0 0 0 3 3h2m7-3-4 4-4-4m4 4V8a3 3 0 0 0-3-3h-2"/>',
  heart:
    '<path d="M20.8 5.6a5.3 5.3 0 0 0-7.5 0L12 6.9l-1.3-1.3a5.3 5.3 0 0 0-7.5 7.5L12 22l8.8-8.9a5.3 5.3 0 0 0 0-7.5Z"/>',
  share: '<path d="M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7"/>',
  chart: '<path d="M5 20v-8m5 8V4m5 16V9m5 11V2"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  back: '<path d="m11 5-7 7 7 7M4 12h16"/>',
  arrowUp: '<path d="m5 11 7-7 7 7m-7-7v17"/>',
  arrowDown: '<path d="m5 13 7 7 7-7m-7 7V3"/>',
  folder: '<path d="M3 7V4h7l3 3h8v13H3z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  settings:
    '<path d="m9 3-.8 3-2.7 1.5-3-.8-1 3 2.2 2.3v3l-2.2 2.3 1 3 3-.8L8.2 21l.8 3h3l.8-3 2.7-1.5 3 .8 1-3-2.2-2.3v-3l2.2-2.3-1-3-3 .8L12.8 6 12 3z" transform="translate(2 -1) scale(.9)"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
};
export function icon(name, className = "") {
  if (name === "x")
    return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.9-9L1 2h6.5l4.4 6.7L18.9 2ZM17.8 20h1.7L6.5 3.9H4.7L17.8 20Z"/></svg>`;
  if (name === "reddit")
    return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#ff4500"/><g fill="white"><ellipse cx="12" cy="14.3" rx="7.4" ry="5.2"/><circle cx="4.8" cy="11" r="2"/><circle cx="19.2" cy="11" r="2"/><circle cx="18" cy="5.4" r="1.7"/></g><path d="m12 9.2 1-5 3.5.8" stroke="white" stroke-width="1.2" fill="none"/><circle cx="8.9" cy="13.3" r="1.1" fill="#ff4500"/><circle cx="15.1" cy="13.3" r="1.1" fill="#ff4500"/><path d="M8.9 16.3q3.1 2.2 6.2 0" stroke="#ff4500" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg>`;
  if (name === "verified")
    return `<svg class="icon verified ${className}" viewBox="0 0 24 24" aria-label="已认证"><path d="m12 1 3 2 3.6.5 1.2 3.4 2.5 2.6-1 3.5.4 3.6-3 2-1.9 3-3.6-.5-3.5 1-2.6-2.5L3.7 18l-.5-3.6-2-3 2-3 .5-3.6 3.4-1.2L9.7 1Z" fill="currentColor"/><path d="m7 12 3 3 7-7" stroke="white" stroke-width="2" fill="none"/></svg>`;
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.more}</svg>`;
}
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
