import { t as tr } from "../../app/i18n.js";
/** Finite, unencrypted HLS: keep one rendition, its audio and every segment. */
export function hlsPlaylist(text, base) {
  if (!text.trimStart().startsWith("#EXTM3U"))
    throw new Error(tr("无效的 HLS 播放清单"));
  if (/#EXT-X-(?:SESSION-)?KEY:.*METHOD=(?!NONE)[^,\r\n]+/i.test(text))
    throw new Error(tr("加密或 DRM 视频无法归档"));
  if (/#EXTINF:/.test(text) && !/#EXT-X-ENDLIST/.test(text))
    throw new Error(tr("直播播放清单无法完整保存，请在直播结束后重试"));
  const lines = text.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++)
    if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
      let next = i + 1;
      while (
        next < lines.length &&
        (!lines[next].trim() || lines[next].startsWith("#"))
      )
        next++;
      if (next < lines.length)
        variants.push({
          index: i,
          next,
          bandwidth: Number(
            lines[i].match(/(?:^|,)BANDWIDTH=(\d+)/)?.[1] ||
              lines[i].match(/BANDWIDTH=(\d+)/)?.[1] ||
              0,
          ),
        });
    }
  const chosen = variants.sort((a, b) => b.bandwidth - a.bandwidth)[0];
  const remove = new Set(
    variants.filter((v) => v !== chosen).flatMap((v) => [v.index, v.next]),
  );
  const normalized = lines
    .filter((_, i) => !remove.has(i))
    .map((line) => {
      if (!line.trim()) return line;
      if (!line.startsWith("#")) return new URL(line.trim(), base).href;
      return line.replace(
        /URI="([^"]+)"/g,
        (_, uri) => `URI="${new URL(uri, base).href}"`,
      );
    })
    .join("\n");
  const dependencies = [];
  for (const line of normalized.split("\n")) {
    if (line && !line.startsWith("#")) dependencies.push(line.trim());
    for (const m of line.matchAll(/URI="([^"]+)"/g)) dependencies.push(m[1]);
  }
  return { text: normalized, dependencies: [...new Set(dependencies)] };
}
