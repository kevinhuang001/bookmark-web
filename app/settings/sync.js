import { syncStatus } from "../sync-status.js";
import { t as tr } from "../i18n.js";
import { icon, escapeHtml as esc } from "../icons.js";
export function renderSyncSettings(dav, status) {
  const mode = dav.mode === "local" ? "local" : "webdav";
  const row = (title, description, input, extra = "") =>
    `<label class="sync-config-row ${extra}"><span class="sync-row-copy"><strong>${title}</strong><small>${description}</small></span>${input}</label>`;
  const interval = row(
    tr("自动同步周期（秒）"),
    tr("设置自动同步的时间间隔，建议不小于 30 秒"),
    `<input id="dav-interval" aria-label="${tr("自动同步周期（秒）")}" type="number" min="30" max="86400" step="1" required value="${esc(dav.intervalSeconds ?? 60)}">`,
  );
  return `<section class="sync-method-card"><div class="sync-row-copy"><strong>${tr("同步方式")}</strong><small>${tr("选择内容同步的方式")}</small></div>
        <input id="sync-mode" type="hidden" value="${mode}">
        <div class="sync-provider-switch" role="group" aria-label="${tr("同步方式")}">
          <button type="button" data-sync-mode="local" aria-pressed="${mode === "local"}" class="${mode === "local" ? "active" : ""}">${tr("本地文件夹")}</button>
          <button type="button" data-sync-mode="webdav" aria-pressed="${mode === "webdav"}" class="${mode === "webdav" ? "active" : ""}">WebDAV</button>
        </div></section>
        <section class="sync-config-card" data-sync-config="${mode}"><header><span class="sync-config-icon">${icon(mode === "local" ? "folder" : "globe")}</span><div><h3>${mode === "local" ? tr("本地文件夹") : tr("WebDAV 配置")}</h3><p>${mode === "local" ? tr("将内容同步到所选文件夹") : tr("将内容同步到 WebDAV 服务器，支持多数主流云盘服务。")}</p></div></header>
        <div class="sync-config-fields">${
          mode === "local"
            ? row(
                tr("本地同步路径"),
                tr("内容始终保存在本地；留空使用默认路径。"),
                `<input id="sync-local-path" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(dav.defaultLocalPath || "")}" value="${esc(dav.localPath || dav.defaultLocalPath || "")}" data-default-path="${esc(dav.defaultLocalPath || "")}">`,
              )
            : interval +
              row(
                tr("目录地址"),
                tr(
                  "WebDAV 地址下会自动创建 glassmark，其他目录内容不会被修改。",
                ),
                `<input id="dav-url" type="url" placeholder="https://example.com/dav" value="${esc(dav.url)}">`,
              ) +
              row(
                tr("用户名"),
                tr("WebDAV 服务器的登录用户名"),
                `<input id="dav-username" value="${esc(dav.username)}" autocomplete="username">`,
              ) +
              `<div class="sync-config-row"><label class="sync-row-copy" for="dav-password"><strong>${tr("应用密码")}</strong><small>${tr("建议使用应用专用密码，避免使用账号主密码")}</small></label><div class="sync-password"><input id="dav-password" type="password" value="${esc(dav.password || "")}" placeholder="${dav.hasPassword ? tr("已保存，留空保留") : tr("输入密码")}" autocomplete="new-password"><button type="button" id="sync-password-toggle" aria-label="${tr("显示密码")}" aria-pressed="false">${icon("eye")}</button></div></div>`
        }
        </div>${mode === "webdav" ? `<div class="sync-footer"><button type="button" id="settings-sync-now" class="secondary">${icon("refresh")}${tr("立即同步")}</button><p id="sync-feedback" class="settings-note" role="status">${esc(syncStatus(status).full)}</p></div><section id="sync-conflicts" class="settings-section"></section>` : ""}</section>`;
}

export function readSyncDraft(dav) {
  if (document.getElementById("sync-mode")) {
    dav.mode =
      document.getElementById("sync-mode")?.value || dav.mode || "webdav";
    const interval = document.getElementById("dav-interval");
    if (interval) dav.intervalSeconds = Number(interval.value);
    const localPath = document.getElementById("sync-local-path");
    if (localPath)
      dav.localPath =
        localPath.value.trim() === localPath.dataset.defaultPath
          ? ""
          : localPath.value.trim();
    if (document.getElementById("dav-url")) {
      dav.url = document.getElementById("dav-url").value.trim();
      dav.username = document.getElementById("dav-username").value;
      dav.password = document.getElementById("dav-password").value;
    }
  }
}
export function validateSyncDraft(dav) {
  if (dav.mode === "local" && dav.localPath.trim()) {
    const path = dav.localPath.trim();
    const absolute =
      path.startsWith("/") ||
      path.startsWith("\\\\") ||
      (/^[A-Za-z]:/.test(path) && ["/", "\\"].includes(path[2]));
    if (!absolute) throw new Error(tr("本地同步路径不能为空且必须是绝对路径"));
  }
}
