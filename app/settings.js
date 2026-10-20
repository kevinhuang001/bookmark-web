import { renderSupport, SUPPORT_ADDRESS } from "./settings/support.js";
import { syncStatus } from "./sync-status.js";
import { enhanceSelects } from "./controls.js";
import {
  renderSyncSettings,
  readSyncDraft,
  validateSyncDraft,
} from "./settings/sync.js";
import {
  t as tr,
  languages,
  getLanguage,
  setLanguage,
  resolveLocale,
  localizeError,
} from "./i18n.js";
import { icon, escapeHtml as esc } from "./icons.js";
import { renderConflicts } from "./conflicts.js";
import { json, mutate } from "./api.js";
export async function openSettings({ modal, folders, onSaved, toast }) {
  const [prefs, dav, pairing, devices, status] = await Promise.all([
    json("/api/preferences"),
    json("/api/settings"),
    mutate("/api/pairing", {}),
    json("/api/devices"),
    json("/api/status"),
  ]);
  const categories = [
    ["general", "settings", tr("通用")],
    ["capture", "threads", tr("内容收藏")],
    ["media", "archive", tr("媒体下载")],
    ["sync", "refresh", tr("同步")],
    ["connection", "link", tr("浏览器连接")],
    ["about", "info", tr("关于")],
  ];
  prefs.language ||= "system";
  dav.mode ||= "webdav";
  dav.localPath ||= "";
  let active = "general";
  prefs.visiblePlatforms ||= ["web", "x", "reddit", "xiaohongshu", "zhihu"];
  const control = (name, key, type = "number", min, max) =>
    `<label class="settings-row sync-config-row"><span class="sync-row-copy"><strong>${name}</strong></span><input aria-label="${name}" data-pref="${key}" type="${type}" ${type === "checkbox" ? 'class="sync-toggle" role="switch"' : ""} ${type === "checkbox" ? (prefs[key] ? "checked" : "") : `value="${esc(prefs[key])}" min="${min}" max="${max}" step="1" required`}></label>`;
  const section = (title, body, note = "") =>
    `<section class="settings-section sync-config-card"><header><span class="sync-config-icon">${icon(categories.find((c) => c[0] === active)?.[1] || "settings")}</span><div><h3>${title}</h3>${note ? `<p>${note}</p>` : ""}</div></header><div class="settings-card sync-config-fields">${body}</div></section>`;
  function collect() {
    const platforms = document.querySelectorAll("[data-platform-pref]");
    if (platforms.length)
      prefs.visiblePlatforms = [...platforms]
        .filter((i) => i.checked)
        .map((i) => i.dataset.platformPref);
    for (const input of document.querySelectorAll(
      "#settings-panel [data-pref]",
    ))
      prefs[input.dataset.pref] =
        input.type === "checkbox"
          ? input.checked
          : input.tagName === "SELECT"
            ? input.value || null
            : Number(input.value);
    readSyncDraft(dav);
  }
  async function save() {
    for (const input of document.querySelectorAll(
      "#settings-panel input[type=number]",
    )) {
      if (!input.checkValidity())
        throw new Error(
          tr("数值范围错误", {
            field: input.getAttribute("aria-label"),
            min: input.min,
            max: input.max,
          }),
        );
    }
    collect();
    validateSyncDraft(dav);
    prefs.resolvedLanguage = resolveLocale(prefs.language);
    await mutate("/api/preferences", prefs, "PUT");
    await mutate("/api/settings", dav, "PUT");
    document.getElementById("dialog").close();
    if (prefs.language !== getLanguage()) {
      setLanguage(prefs.language);
      location.reload();
      return;
    }
    await onSaved();
    toast(tr("设置已保存，下一次收藏使用新配置"));
  }
  modal(
    tr("设置"),
    `<div class="settings-layout"><nav id="settings-nav" class="settings-nav" aria-label="${tr("设置分类")}"></nav><section id="settings-panel" class="settings-panel"></section></div>`,
    [{ label: tr("保存设置"), primary: true, run: save }],
  );
  const dialog = document.getElementById("dialog");
  dialog.classList.add("settings-window");
  const updateSync = (event) => {
    const next = event.detail;
    const changed =
      next.sync?.lastSync !== status.sync?.lastSync ||
      next.conflicts !== status.conflicts;
    Object.assign(status, next);
    const feedback = dialog.querySelector("#sync-feedback");
    if (feedback) feedback.textContent = syncStatus(next).full;
    if (changed && !next.running) {
      const root = dialog.querySelector("#sync-conflicts");
      if (root) renderConflicts(root, { folders, onResolved: onSaved, toast });
    }
  };
  dialog.addEventListener("sync-status", updateSync);
  dialog.addEventListener(
    "close",
    () => dialog.removeEventListener("sync-status", updateSync),
    { once: true },
  );
  function draw() {
    document.getElementById("settings-nav").innerHTML =
      `<div class="settings-app">${icon("logo")}<strong>Glassmark<small>${tr("偏好设置")}</small></strong></div>` +
      categories
        .map(
          ([id, glyph, name]) =>
            `<button type="button" data-settings-category="${id}" class="${active === id ? "active" : ""}">${icon(glyph)}${name}</button>`,
        )
        .join("");
    const panel = document.getElementById("settings-panel");
    const heading = categories.find((c) => c[0] === active)[2];
    let body = "";
    if (active === "general")
      body =
        section(
          tr("界面语言"),
          `<label class="settings-row sync-config-row"><span class="sync-row-copy"><strong>${tr("语言")}</strong></span><select data-pref="language" aria-label="${tr("语言")}">${languages.map((l) => `<option value="${l.id}" ${prefs.language === l.id ? "selected" : ""}>${l.id === "system" ? tr("跟随系统") : l.name}</option>`).join("")}</select></label>`,
          tr("保存后应用于客户端和浏览器扩展。"),
        ) +
        section(
          tr("阅读与操作"),
          control(tr("显示保存时间"), "showSavedTime", "checkbox") +
            control(tr("显示资源状态"), "showMediaStats", "checkbox") +
            control(tr("删除收藏前确认"), "confirmDelete", "checkbox"),
        ) +
        section(
          tr("侧边栏平台"),
          [
            ["web", tr("网页")],
            ["x", "X"],
            ["reddit", "Reddit"],
            ["xiaohongshu", tr("小红书")],
            ["zhihu", tr("知乎")],
          ]
            .map(
              ([id, name]) =>
                `<label class="settings-row sync-config-row"><span class="sync-row-copy"><strong>${name}</strong></span><input class="sync-toggle" role="switch" aria-label="${name}" type="checkbox" data-platform-pref="${id}" ${prefs.visiblePlatforms.includes(id) ? "checked" : ""}></label>`,
            )
            .join(""),
          tr("选择侧边栏显示的来源。隐藏后仍可通过全局搜索查看收藏。"),
        ) +
        section(
          tr("网页默认保存位置"),
          `<label class="settings-row sync-config-row"><span class="sync-row-copy"><strong>${tr("默认文件夹")}</strong></span><select data-pref="defaultFolderId" aria-label="${tr("默认文件夹")}"><option value="">${tr("网页 · 根文件夹")}</option>${folders.map((f) => `<option value="${f.id}" ${prefs.defaultFolderId === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></label>`,
          tr("扩展优先保留你上次选择的位置；首次收藏使用这里的默认值。"),
        );
    if (active === "capture")
      body =
        section(
          tr("帖子与讨论"),
          control(tr("单次评论与回复数量上限"), "maxPosts", "number", 1, 1000) +
            control(
              tr("自动加载时长（秒）"),
              "autoLoadSeconds",
              "number",
              1,
              120,
            ),
          tr(
            "每次只收藏当前 URL 对应的一个 X 主帖，数量限制仅用于回复。广告与推荐内容不会导入。",
          ),
        ) +
        section(
          tr("保存的媒体"),
          control(tr("保存正文图片与 GIF"), "includeImages", "checkbox") +
            control(tr("保存作者头像"), "includeAvatars", "checkbox") +
            control(tr("保存视频"), "includeVideos", "checkbox"),
        );
    if (active === "media")
      body =
        section(
          tr("下载"),
          control(
            tr("单次下载上限（MB）"),
            "downloadLimitMb",
            "number",
            10,
            20480,
          ) +
            control(tr("并发下载数"), "downloadConcurrency", "number", 1, 12) +
            control(
              tr("单次资源数量上限"),
              "resourceLimit",
              "number",
              10,
              10000,
            ),
          tr("达到下载上限后暂停询问。所有并发任务共享同一预算。"),
        ) +
        section(
          tr("超时"),
          control(
            tr("图片与字体超时（秒）"),
            "imageTimeoutSeconds",
            "number",
            3,
            120,
          ) +
            control(
              tr("视频资源超时（秒）"),
              "videoTimeoutSeconds",
              "number",
              10,
              600,
            ),
          tr("网络失败会记录在保存报告中，其余资源继续下载。"),
        );
    if (active === "sync") {
      body = renderSyncSettings(dav, status);
    }
    if (active === "connection")
      body =
        section(
          tr("配对浏览器"),
          `<div class="pairing-card"><div><strong>${tr("在扩展中输入配对码")}</strong><p>${tr("5 分钟内有效")}</p></div><div class="pairing-code-actions"><strong id="pairing-code">${esc(pairing.code)}</strong><button type="button" id="copy-pairing-code" class="secondary" aria-label="${tr("复制配对码")}">${tr("{1}复制", { 1: icon("copy") })}</button></div></div>`,
          tr("客户端必须保持运行，扩展才能保存内容。"),
        ) +
        section(
          tr("已连接浏览器"),
          devices
            .map(
              (d) =>
                `<div class="settings-row sync-config-row"><span class="sync-row-copy"><strong>${esc(d.name)}</strong></span><button type="button" class="text-button revoke" data-token="${d.token}">${tr("撤销配对")}</button></div>`,
            )
            .join("") ||
            `<p class="settings-note">${tr("尚无已配对浏览器")}</p>`,
        );
    if (active === "about")
      body =
        `<section class="about-overview"><div class="about-brand-mark">${icon("logo")}</div><h3>GlassMark</h3><p class="about-version">${tr("当前版本")} <strong id="about-current-version">0.8.19</strong></p></section>` +
        section(
          tr("软件更新"),
          `<div class="about-update-row"><div><strong>${tr("检查最新版本")}</strong><p id="about-update-status" aria-live="polite">${tr("尚未检查更新")}</p></div><button type="button" id="about-check-update" class="secondary">${tr("检查更新")}</button></div><a id="about-release-link" href="https://github.com/kevinhuang001/bookmark-web/releases" target="_blank" rel="noopener noreferrer">${tr("查看所有版本")}</a>`,
        ) +
        section("Support", renderSupport()) +
        section(
          tr("项目"),
          `<div class="about-links"><a href="https://github.com/kevinhuang001/bookmark-web" target="_blank" rel="noopener noreferrer">GitHub ${icon("arrowRight")}</a><a href="https://github.com/kevinhuang001/bookmark-web/issues" target="_blank" rel="noopener noreferrer">${tr("反馈问题")} ${icon("arrowRight")}</a></div>`,
        );
    panel.innerHTML = `<h2>${heading}</h2>${body}`;
    enhanceSelects(panel);
    const copyAddress = panel.querySelector("#support-copy-address");
    if (copyAddress)
      copyAddress.onclick = async () => {
        try {
          await navigator.clipboard.writeText(SUPPORT_ADDRESS);
          copyAddress.innerHTML = icon("check") + tr("已复制");
          toast(tr("地址已复制"));
        } catch {
          const range = document.createRange();
          range.selectNodeContents(panel.querySelector("#support-address"));
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          toast(tr("复制失败，请手动复制地址"));
        }
      };
    const checkUpdate = panel.querySelector("#about-check-update");
    if (checkUpdate) {
      const label = panel.querySelector("#about-update-status");
      const versionLabel = panel.querySelector("#about-current-version");
      const releaseLink = panel.querySelector("#about-release-link");
      // The desktop app version is reported by the running backend, not a hard-coded UI value.
      json("/api/status")
        .then((info) => {
          const version = info.version || info.appVersion;
          if (version && versionLabel?.isConnected)
            versionLabel.textContent = version;
        })
        .catch(() => {});
      checkUpdate.onclick = async () => {
        checkUpdate.disabled = true;
        label.textContent = tr("正在检查更新…");
        try {
          const release = await json("/api/latest-release");
          const latest = String(release.tag_name || "").replace(/^v/i, "");
          if (!/^\d+\.\d+\.\d+/.test(latest))
            throw new Error("Invalid release version");
          const current = versionLabel.textContent.trim();
          const numbers = (v) =>
            v
              .split(/[.-]/)
              .slice(0, 3)
              .map((x) => Number(x) || 0);
          const l = numbers(latest),
            c = numbers(current);
          const newer = l.some(
            (n, i) => n > c[i] && l.slice(0, i).every((x, j) => x === c[j]),
          );
          label.textContent = newer
            ? tr("发现新版本：{0}", { 0: latest })
            : tr("已是最新版本");
          if (
            newer &&
            String(release.html_url || "").startsWith(
              "https://github.com/kevinhuang001/bookmark-web/releases/",
            )
          ) {
            releaseLink.href = release.html_url;
            releaseLink.textContent = tr("查看新版本并下载");
          }
        } catch {
          label.textContent = tr("检查失败，请稍后重试");
        } finally {
          checkUpdate.disabled = false;
        }
      };
    }
    const copyCode = panel.querySelector("#copy-pairing-code");
    if (copyCode)
      copyCode.onclick = async () => {
        try {
          await navigator.clipboard.writeText(pairing.code);
          copyCode.innerHTML = icon("check") + tr("已复制");
          toast(tr("配对码已复制"));
        } catch {
          toast(tr("复制失败，请选中配对码手动复制"));
        }
      };
    for (const button of document.querySelectorAll("[data-settings-category]"))
      button.onclick = () => {
        collect();
        active = button.dataset.settingsCategory;
        draw();
      };
    for (const button of panel.querySelectorAll("[data-sync-mode]"))
      button.onclick = () => {
        collect();
        dav.mode = button.dataset.syncMode;
        draw();
      };
    const passwordToggle = panel.querySelector("#sync-password-toggle");
    if (passwordToggle)
      passwordToggle.onclick = () => {
        const input = panel.querySelector("#dav-password");
        const visible = input.type === "password";
        input.type = visible ? "text" : "password";
        passwordToggle.setAttribute("aria-pressed", String(visible));
        passwordToggle.setAttribute(
          "aria-label",
          tr(visible ? "隐藏密码" : "显示密码"),
        );
      };
    for (const button of panel.querySelectorAll(".revoke"))
      button.onclick = async () => {
        try {
          await json("/api/devices/" + button.dataset.token, {
            method: "DELETE",
          });
          devices.splice(
            devices.findIndex((d) => d.token === button.dataset.token),
            1,
          );
          draw();
          toast(tr("配对已撤销"));
        } catch (e) {
          toast(e.message);
        }
      };
    const conflictRoot = document.getElementById("sync-conflicts");
    if (conflictRoot)
      renderConflicts(conflictRoot, { folders, onResolved: onSaved, toast });
    if (document.getElementById("settings-sync-now"))
      document.getElementById("settings-sync-now").onclick = async () => {
        try {
          collect();
          validateSyncDraft(dav);
          await mutate("/api/settings", dav, "PUT");
          await mutate("/api/sync", {});
          const feedback = document.getElementById("sync-feedback");
          if (feedback) feedback.textContent = tr("正在同步…");
          if (conflictRoot?.isConnected)
            await renderConflicts(conflictRoot, {
              folders,
              onResolved: onSaved,
              toast,
            });
        } catch (e) {
          toast(e.message);
        }
      };
  }
  draw();
}
