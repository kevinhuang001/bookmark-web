/** Resource graph and rewrites shared by capture, source exports and tests. */
export const DEFAULT_BUDGET = 500 * 1024 * 1024;
export function dependencies(text, mime, base) {
  const found = new Set();
  const add = (value) => {
    try {
      const u = new URL(value, base);
      if (["http:", "https:"].includes(u.protocol)) found.add(u.href);
    } catch {}
  };
  if (/css/.test(mime)) {
    for (const match of text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g))
      add(match[1]);
    for (const match of text.matchAll(/@import\s*["']([^"']+)["']/g))
      add(match[1]);
  }
  if (/javascript|ecmascript/.test(mime)) {
    for (const match of text.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g,
    ))
      if (/^(\.|\/|https?:)/.test(match[1])) add(match[1]);
  }
  return [...found];
}
export function extensionFor(mime) {
  const map = {
    "text/css": "css",
    "text/javascript": "js",
    "application/javascript": "js",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "font/woff2": "woff2",
    "font/woff": "woff",
  };
  return map[mime.split(";")[0]] || "bin";
}
export function rewrite(text, resources, relative = "assets/") {
  let result = text;
  for (const item of [...resources]
    .filter((r) => r.status === "saved")
    .sort((a, b) => b.url.length - a.url.length)) {
    const target = relative + item.name;
    result = result
      .split(item.url)
      .join(target)
      .split(item.url.replaceAll("&", "&amp;"))
      .join(target);
  }
  return result;
}
export async function readBounded(response, state, approve, signal) {
  const chunks = [];
  let size = 0;
  async function permit(bytes) {
    if (state.total + bytes > state.limit) {
      if (!(await approve(state.total + bytes)))
        throw new Error("超过下载上限，已跳过此资源");
      state.limit = Math.max(state.limit + DEFAULT_BUDGET, state.total + bytes);
    }
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length) await permit(length);
  const reader = response.body.getReader();
  try {
    while (true) {
      if (signal?.aborted) throw new Error("已取消");
      const { done, value } = await reader.read();
      if (done) break;
      await permit(value.byteLength);
      state.total += value.byteLength;
      size += value.byteLength;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function archiveResources(
  urls,
  { upload, approve, progress, signal, fetcher = fetch },
) {
  const queue = [...new Set(urls)];
  const seen = new Set();
  const resources = [];
  const state = { total: 0, limit: DEFAULT_BUDGET };
  while (queue.length && seen.size < 2000) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    if (signal?.aborted) throw new Error("已取消收藏");
    const record = { url, status: "failed", bytes: 0 };
    resources.push(record);
    if (!/^https?:/.test(url)) {
      record.error = "该资源不是可下载的 HTTP 地址";
      continue;
    }
    progress?.({
      done: seen.size,
      total: seen.size + queue.length,
      bytes: state.total,
      url,
    });
    try {
      const response = await fetcher(url, {
        credentials: "omit",
        redirect: "follow",
        signal: AbortSignal.any([
          signal || new AbortController().signal,
          AbortSignal.timeout(90000),
        ]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      record.mime =
        response.headers.get("content-type") || "application/octet-stream";
      const bytes = await readBounded(response, state, approve, signal);
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      record.name = hash + "." + extensionFor(record.mime);
      record.bytes = bytes.length;
      if (/mpegurl|dash\+xml/.test(record.mime))
        record.warning = "流式媒体仅保存了播放清单，分片与 DRM 内容未归档";
      await upload(record.name, bytes, record.mime);
      record.status = "saved";
      if (/css|javascript|ecmascript/.test(record.mime))
        for (const dependency of dependencies(
          new TextDecoder().decode(bytes),
          record.mime,
          response.url || url,
        ))
          if (!seen.has(dependency)) queue.push(dependency);
    } catch (error) {
      if (signal?.aborted) throw error;
      record.error = error.message;
    }
  }
  if (queue.length)
    resources.push({
      url: "resource-limit",
      status: "failed",
      error: "资源数量超过 2000，请缩小收藏范围",
      bytes: 0,
    });
  return resources;
}
