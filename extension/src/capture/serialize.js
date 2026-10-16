const OMIT = new Set([
  "SCRIPT",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "BASE",
  "META",
  "LINK",
]);
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
/** Capture a rendering, including inherited styles, pseudo elements and open shadow roots. */
export function serializeElement(root) {
  const resources = new Set();
  const warnings = [];
  let count = 0;
  const absolute = (value) => {
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return value;
    }
  };
  const cssUrls = (css) =>
    css.replace(/url\(["']?([^"')]+)["']?\)/g, (_, value) => {
      if (/^data:/.test(value)) return `url("${value}")`;
      const url = absolute(value);
      const parsed = new URL(url, document.baseURI);
      if (
        parsed.hash &&
        parsed.origin === location.origin &&
        parsed.pathname === location.pathname
      )
        return `url("${parsed.hash}")`;
      resources.add(url);
      return `url("${url}")`;
    });
  function pseudo(el, kind) {
    const style = getComputedStyle(el, kind);
    const content = style.content;
    if (!content || ["none", "normal", '""'].includes(content)) return "";
    const css = [...style]
      .map((k) => `${k}:${cssUrls(style.getPropertyValue(k))}`)
      .join(";");
    return `<span aria-hidden="true" style="${escapeHtml(css)}">${escapeHtml(content.replace(/^['"]|['"]$/g, ""))}</span>`;
  }
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent);
    if (
      !(node instanceof Element) ||
      OMIT.has(node.tagName) ||
      node.hasAttribute("data-glassmark-ui")
    )
      return "";
    if (++count > 60000)
      throw new Error("页面超过 60000 个元素，请选择较小区域后重试");
    const computed = getComputedStyle(node);
    if (computed.display === "none") return "";
    let clone = node.cloneNode(false);
    if (node.tagName === "BODY") {
      clone = document.createElement("div");
      for (const attr of node.attributes)
        clone.setAttribute(attr.name, attr.value);
    }
    for (const attr of [...clone.attributes]) {
      if (
        /^on/i.test(attr.name) ||
        [
          "srcset",
          "integrity",
          "nonce",
          "crossorigin",
          "formaction",
          "autofocus",
          "contenteditable",
        ].includes(attr.name)
      )
        clone.removeAttribute(attr.name);
    }
    clone.setAttribute(
      "style",
      [...computed]
        .map((key) => `${key}:${cssUrls(computed.getPropertyValue(key))}`)
        .join(";"),
    );
    if (node instanceof HTMLImageElement) {
      const url = node.currentSrc || node.src;
      if (url) {
        if (!url.startsWith("data:")) resources.add(url);
        clone.setAttribute("src", url);
      }
      clone.removeAttribute("loading");
    }
    if (["VIDEO", "AUDIO", "SOURCE"].includes(node.tagName)) {
      const url = node.currentSrc || node.src;
      if (url) {
        if (!url.startsWith("data:")) resources.add(url);
        clone.setAttribute("src", url);
      }
      if (node.poster) {
        resources.add(node.poster);
        clone.setAttribute("poster", node.poster);
      }
      clone.removeAttribute("autoplay");
      if (node.tagName !== "SOURCE") clone.setAttribute("controls", "");
    }
    if (node instanceof HTMLCanvasElement) {
      try {
        return `<img style="${escapeHtml(clone.getAttribute("style"))}" src="${node.toDataURL()}">`;
      } catch {
        warnings.push("受跨域限制的 canvas 未能保存");
      }
    }
    if (node instanceof HTMLAnchorElement) {
      clone.setAttribute("href", node.href);
      clone.setAttribute("target", "_blank");
      clone.setAttribute("rel", "noreferrer noopener");
    }
    if (node instanceof HTMLInputElement) {
      clone.setAttribute("value", node.type === "password" ? "" : node.value);
      if (node.checked) clone.setAttribute("checked", "");
    }
    const container = document.createElement("div");
    container.append(clone);
    const outer = container.innerHTML;
    const openEnd = outer.indexOf(">") + 1;
    if (
      /^(IMG|INPUT|BR|HR|SOURCE|WBR|AREA|COL|PARAM|TRACK)$/.test(node.tagName)
    )
      return outer;
    const children =
      node.tagName === "SLOT" && node.assignedNodes?.().length
        ? node.assignedNodes({ flatten: true })
        : node.shadowRoot
          ? [...node.shadowRoot.childNodes]
          : [...node.childNodes];
    return (
      outer.slice(0, openEnd) +
      pseudo(node, "::before") +
      children.map(walk).join("") +
      pseudo(node, "::after") +
      outer.slice(outer.lastIndexOf("</"))
    );
  }
  return { html: walk(root), resources: [...resources], warnings };
}
export function snapshotDocument(parts, title, background = "#fff") {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; img-src &apos;self&apos; data: blob:; media-src &apos;self&apos; data: blob:; font-src &apos;self&apos; data: blob:; style-src &apos;unsafe-inline&apos;; script-src &apos;none&apos;; connect-src &apos;none&apos;; form-action &apos;none&apos;"><title>' +
    escapeHtml(title) +
    '</title></head><body style="margin:0;background:' +
    escapeHtml(background) +
    '">' +
    parts.join('<div style="height:24px"></div>') +
    "</body></html>"
  );
}
