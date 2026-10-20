import { t as tr } from "./i18n.js";
import { request } from "./api.js";
/** Every displayed social image is either an archived blob or inline image data. */
export class ArchiveMedia {
  #cache = new Map();
  #urls = new Set();
  #controller = new AbortController();
  #players = new Set();
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
    const posters = [...root.querySelectorAll("[data-archive-poster]")].map(
      async (el) => {
        const item = items.find((i) => i.id === el.dataset.archiveId);
        if (!item) return;
        const url = await this.resolve(item, el.dataset.archivePoster);
        if (url && el.isConnected && !this.#controller.signal.aborted)
          el.poster = url;
      },
    );
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
            const resource = (item.resources || []).find(
              (r) => r.url === el.dataset.archiveMedia,
            );
            if (
              el.tagName === "VIDEO" &&
              (/mpegurl/i.test(resource?.mime || "") ||
                /\.m3u8(?:\?|$)/.test(el.dataset.archiveMedia))
            )
              await this.hls(el, item);
            else el.src = url;
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
    await Promise.allSettled([...jobs, ...posters]);
  }
  async hls(el, item) {
    const { default: Hls } = await import("./vendor/hls.mjs");
    if (this.#controller.signal.aborted) return;
    if (!Hls.isSupported()) throw new Error(tr("当前系统不支持离线 HLS 播放"));
    const archive = this;
    class LocalLoader {
      constructor() {
        this.stats = {
          aborted: false,
          loaded: 0,
          total: 0,
          retry: 0,
          chunkCount: 0,
          bwEstimate: 0,
          loading: { start: 0, first: 0, end: 0 },
          parsing: { start: 0, end: 0 },
          buffering: { start: 0, first: 0, end: 0 },
        };
      }
      load(context, config, callbacks) {
        this.context = context;
        this.stats.loading.start = performance.now();
        (async () => {
          const local = await archive.resolve(item, context.url);
          if (!local) throw new Error(tr("视频分片未归档"));
          const response = await fetch(local, {
            signal: archive.#controller.signal,
          });
          let bytes = await response.arrayBuffer();
          if (context.rangeEnd)
            bytes = bytes.slice(context.rangeStart || 0, context.rangeEnd);
          if (this.stats.aborted) return;
          this.stats.loaded = this.stats.total = bytes.byteLength;
          this.stats.chunkCount = 1;
          this.stats.loading.first = this.stats.loading.end = performance.now();
          const data =
            context.responseType === "arraybuffer"
              ? bytes
              : new TextDecoder().decode(bytes);
          callbacks.onSuccess(
            { url: context.url, data },
            this.stats,
            context,
            null,
          );
        })().catch((error) => {
          if (!this.stats.aborted)
            callbacks.onError(
              { code: 0, text: error.message },
              context,
              null,
              this.stats,
            );
        });
      }
      abort() {
        this.stats.aborted = true;
      }
      destroy() {
        this.abort();
      }
    }
    const player = new Hls({ loader: LocalLoader, enableWorker: false });
    this.#players.add(player);
    player.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        el.closest(".social-media")?.classList.add("media-unavailable");
        el.dataset.error = data.details;
      }
    });
    player.loadSource(el.dataset.archiveMedia);
    player.attachMedia(el);
  }
  release() {
    this.#players.forEach((player) => player.destroy());
    this.#players.clear();
    this.#controller.abort();
    this.#urls.forEach((url) => URL.revokeObjectURL(url));
    this.#urls.clear();
    this.#cache.clear();
  }
}
