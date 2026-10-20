import { t as tr, locale, localizeError } from "./i18n.js";

export function syncStatus(status) {
  const sync = status.sync || {};
  const phases = {
    prepare: tr("正在准备同步"),
    connect: tr("正在连接 WebDAV"),
    local: tr("正在同步本地文件夹"),
    upload: tr("正在检查并上传文件"),
    download: tr("正在下载文件"),
    index: tr("正在读取远端索引"),
  };
  const stage = phases[sync.stage] || tr("正在同步…");
  let timestamp = "";
  if (sync.lastSync && Number.isFinite(Date.parse(sync.lastSync)))
    timestamp = new Intl.DateTimeFormat(locale(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    }).format(new Date(sync.lastSync));
  const lastSync = timestamp
    ? tr("上次同步：{time}", { time: timestamp })
    : tr("尚未同步");
  const message = status.running
    ? stage + (sync.detail ? " · " + sync.detail : "")
    : sync.error
      ? tr("同步失败：{reason}", { reason: localizeError(sync.error) })
      : sync.lastSync && !sync.localOnly
        ? tr("同步完成")
        : tr("本地已保存");
  const conflict = status.conflicts
    ? tr("有 {count} 项同步冲突，点击设置处理", { count: status.conflicts })
    : "";
  return {
    message,
    lastSync,
    conflict,
    full: [message, lastSync, conflict].filter(Boolean).join("\n"),
  };
}
