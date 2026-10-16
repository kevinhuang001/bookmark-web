import { request } from "./api.js";
/** Every displayed social image is either an archived blob or inline image data. */
export class ArchiveMedia {
  #cache = new Map();
  #urls = new Set();
  #controller = new AbortController();
  async resolve(item, url, mime) {
    if (!url) return null;
    if (/^data:image\//i.test(url)) return url;
    const resource = (item.resources || []).find(
      (r) =>
        r.status === "saved" && (r.url === url || "assets/" + r.name === url),
    );
    if (!resource) return null;
    const key = item.id + "/" + resource.name;
    if (!this.#cache.has(key))
      this.#cache.set(
        key,
        (async () => {
          const response = await request(
            `/api/items/${item.id}/assets/${resource.name}`,
            { signal: this.#controller.signal },
          );
          const value = URL.createObjectURL(
            new Blob([await response.arrayBuffer()], {
              type: mime || resource.mime,
            }),
          );
          if (this.#controller.signal.aborted) {
            URL.revokeObjectURL(value);
            return null;
          }
          this.#urls.add(value);
          return value;
        })(),
      );
    return this.#cache.get(key);
  }
  async hydrate(root, items) {
    const jobs = [...root.querySelectorAll("[data-archive-media]")].map(
      async (el) => {
        const item = items.find((i) => i.id === el.dataset.archiveId);
        if (!item) return;
        try {
          const url = await this.resolve(
            item,
            el.dataset.archiveMedia,
            el.dataset.mime,
          );
          if (!el.isConnected || this.#controller.signal.aborted) return;
          if (url) {
            el.src = url;
            el.closest(".media-loading")?.classList.remove("media-loading");
          } else {
            el.closest(".social-media")?.classList.add("media-unavailable");
            el.remove();
          }
        } catch (e) {
          if (e.name !== "AbortError" && el.isConnected) {
            el.closest(".social-media")?.classList.add("media-unavailable");
            el.remove();
          }
        }
      },
    );
    await Promise.allSettled(jobs);
  }
  release() {
    this.#controller.abort();
    this.#urls.forEach((url) => URL.revokeObjectURL(url));
    this.#urls.clear();
    this.#cache.clear();
  }
}
