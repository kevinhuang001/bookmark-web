import {
  t as tr,
  languages,
  getLanguage,
  setLanguage,
  resolveLocale,
  localizeError,
} from "./i18n.js";
import { icon, escapeHtml as esc } from "./icons.js";
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
    ["sync", "refresh", "WebDAV"],
    ["connection", "link", tr("浏览器连接")],
    ["about", "info", tr("关于")],
  ];
  prefs.language ||= "system";
  let active = "general";
  prefs.visiblePlatforms ||= ["web", "x", "reddit", "xiaohongshu"];
  const control = (name, key, type = "number", min, max) =>
    `<label class="settings-row"><span>${name}</span><input aria-label="${name}" data-pref="${key}" type="${type}" ${type === "checkbox" ? (prefs[key] ? "checked" : "") : `value="${esc(prefs[key])}" min="${min}" max="${max}" step="1" required`}></label>`;
  const section = (title, body, note = "") =>
    `<section class="settings-section"><h3>${title}</h3><div class="settings-card">${body}</div>${note ? `<p class="settings-note">${note}</p>` : ""}</section>`;
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
    if (document.getElementById("dav-url")) {
      dav.enabled = document.getElementById("dav-enabled").checked;
      dav.url = document.getElementById("dav-url").value.trim();
      dav.username = document.getElementById("dav-username").value;
      dav.password = document.getElementById("dav-password").value;
    }
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
  document.getElementById("dialog").classList.add("settings-window");
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
          `<label class="settings-row"><span>${tr("语言")}</span><select data-pref="language" aria-label="${tr("语言")}">${languages.map((l) => `<option value="${l.id}" ${prefs.language === l.id ? "selected" : ""}>${l.id === "system" ? tr("跟随系统") : l.name}</option>`).join("")}</select></label>`,
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
          ]
            .map(
              ([id, name]) =>
                `<label class="settings-row"><span>${name}</span><input type="checkbox" data-platform-pref="${id}" ${prefs.visiblePlatforms.includes(id) ? "checked" : ""}></label>`,
            )
            .join(""),
          tr("选择侧边栏显示的来源。隐藏后仍可通过全局搜索查看收藏。"),
        ) +
        section(
          tr("网页默认保存位置"),
          `<label class="settings-row"><span>${tr("默认文件夹")}</span><select data-pref="defaultFolderId" aria-label="${tr("默认文件夹")}"><option value="">${tr("网页 · 根文件夹")}</option>${folders.map((f) => `<option value="${f.id}" ${prefs.defaultFolderId === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></label>`,
          tr("扩展优先保留你上次选择的位置；首次收藏使用这里的默认值。"),
        );
    if (active === "capture")
      body =
        section(
          tr("帖子与讨论"),
          control(tr("X 默认最多收集条数"), "maxPosts", "number", 1, 1000) +
            control(
              tr("自动加载时长（秒）"),
              "autoLoadSeconds",
              "number",
              1,
              120,
            ),
          tr(
            "包含当前主帖。Reddit 保存页面已加载的全部评论。达到时间或数量上限后保存已收集内容，可手动继续。",
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
    if (active === "sync")
      body =
        section(
          tr("自动同步"),
          `<label class="settings-row"><span>${tr("启用 WebDAV")}</span><input id="dav-enabled" type="checkbox" ${dav.enabled ? "checked" : ""}></label>`,
          tr("启动时、收藏变更后和每分钟自动同步。远端直接保存内容文件。"),
        ) +
        section(
          tr("服务器"),
          `<label>${tr("目录地址")}<input id="dav-url" type="url" placeholder="https://dav.example.com/archive/" value="${esc(dav.url)}"></label><label>${tr("用户名")}<input id="dav-username" value="${esc(dav.username)}" autocomplete="username"></label><label>${tr("应用密码")}<input id="dav-password" type="password" value="${esc(dav.password || "")}" placeholder="${dav.hasPassword ? tr("已保存，留空保留") : tr("输入密码")}" autocomplete="new-password"></label>`,
        ) +
        `<button type="button" id="settings-sync-now" class="secondary">${tr("立即同步")}</button><p id="sync-feedback" class="settings-note">${esc(localizeError(status.sync?.error) || status.sync?.lastSync || "")}</p>`;
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
                `<div class="settings-row"><span>${esc(d.name)}</span><button type="button" class="text-button revoke" data-token="${d.token}">${tr("撤销配对")}</button></div>`,
            )
            .join("") ||
            `<p class="settings-note">${tr("尚无已配对浏览器")}</p>`,
        );
    if (active === "about")
      body = section(
        "Glassmark",
        '<div class="about-app">' +
          icon("logo") +
          `<h3>Glassmark 0.6.0</h3><p>${tr("把值得回看的内容留在本机。")}</p></div>`,
        tr(
          "网页保存一份内容文件；帖子保存正文、评论和媒体。Chromium、Firefox 与 Windows / macOS / Linux。",
        ),
      );
    panel.innerHTML = `<h2>${heading}</h2>${body}`;
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
    if (document.getElementById("settings-sync-now"))
      document.getElementById("settings-sync-now").onclick = async () => {
        try {
          const result = await mutate("/api/sync", {});
          document.getElementById("sync-feedback").textContent =
            localizeError(result.error) || tr("同步完成");
        } catch (e) {
          toast(e.message);
        }
      };
  }
  draw();
}
