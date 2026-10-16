import { request } from "./api.js";
let active = [];
export function releasePreview() {
  for (const url of active) URL.revokeObjectURL(url);
  active = [];
}
/** A separate, opaque-origin sandbox renders untrusted archives without IPC or scripts. */
export async function preview(item, signal) {
  let html = await (
    await request(`/api/items/${item.id}/content/snapshot.html`, { signal })
  ).text();
  const local = [];
  try {
    for (const resource of item.resources.filter((r) => r.status === "saved")) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const response = await request(
        `/api/items/${item.id}/assets/${resource.name}`,
        { signal },
      );
      const url = URL.createObjectURL(
        new Blob([await response.arrayBuffer()], { type: resource.mime }),
      );
      local.push(url);
      html = html.split("assets/" + resource.name).join(url);
    }
    // Template content is inert: unlike DOMParser it does not fetch image URLs
    // while the archive is being sanitized in the privileged parent document.
    const template = document.createElement("template");
    template.innerHTML = html
      .replace(/<body\b/gi, "<div data-glassmark-body")
      .replace(/<\/body\s*>/gi, "</div>");
    template.content
      .querySelectorAll("script,iframe,object,embed,base,meta,link,title")
      .forEach((el) => el.remove());
    const localUrl = (value) => /^(?:blob:|data:|#)/i.test(value.trim());
    const cleanCss = (css) =>
      css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (whole, _quote, value) =>
        localUrl(value) ? whole : "none",
      );
    template.content.querySelectorAll("*").forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (
          /^on/i.test(attr.name) ||
          ["formaction", "srcdoc", "srcset"].includes(attr.name)
        )
          el.removeAttribute(attr.name);
        else if (
          ["src", "href", "xlink:href", "poster"].includes(attr.name) &&
          !localUrl(attr.value)
        )
          el.removeAttribute(attr.name);
      }
      if (el.hasAttribute("style"))
        el.setAttribute("style", cleanCss(el.getAttribute("style")));
      if (el.tagName === "STYLE") el.textContent = cleanCss(el.textContent);
      if (el.tagName === "A") {
        el.removeAttribute("href");
        el.style.cursor = "default";
      }
    });
    const csp =
      "default-src 'none'; img-src blob: data:; media-src blob: data:; font-src blob: data:; style-src 'unsafe-inline' blob:; script-src 'none'; connect-src 'none'; form-action 'none'";
    const documentHtml =
      '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
      csp +
      '"></head><body style="margin:0">' +
      template.innerHTML +
      "</body></html>";
    const url = URL.createObjectURL(
      new Blob([documentHtml], { type: "text/html" }),
    );
    local.push(url);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    releasePreview();
    active = local;
    return url;
  } catch (error) {
    local.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}
