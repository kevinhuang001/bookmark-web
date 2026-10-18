import {
  t as tr,
  setLanguage,
  translateDOM,
  localizeError,
} from "../../../app/i18n.js";
import { hydrateIcons, icon } from "../../../app/icons.js";
import { api, BASE, request, connected } from "../api.js";
import { pageContext } from "../context.js";
hydrateIcons();
translateDOM();
const $ = (id) => document.getElementById(id);
$("extension-version").textContent = api.runtime.getManifest?.().version || "";
let currentTab,
  context,
  threadPage,
  busy = false,
  captureLanguage = "system",
  captureSeconds = 60;
const esc = (s) =>
  String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function error(message) {
  $("status").textContent = localizeError(message);
  $("status").classList.add("error");
}
async function init() {
  $("status").classList.remove("error");
  const live = await connected();
  let options;
  if (live) {
    options = await (await request("/api/capture-options")).json();
    captureLanguage =
      options.preferences?.resolvedLanguage ||
      options.preferences?.language ||
      "system";
    captureSeconds = Math.max(60, options.preferences?.autoLoadSeconds || 60);
    setLanguage(captureLanguage);
  } else {
    const stored = await api.storage.local.get("uiLanguage");
    captureLanguage = stored.uiLanguage || "system";
    setLanguage(captureLanguage);
  }
  translateDOM();
  await api.storage.local.set({ uiLanguage: captureLanguage });
  $("connection-badge").textContent = live ? tr("已连接") : tr("未连接");
  $("connection-badge").classList.toggle("online", live);
  $("status").textContent = live
    ? tr("已就绪 · 收藏将发送到 Glassmark")
    : tr("客户端未连接，请打开客户端后收藏");
  [currentTab] = await api.tabs.query({ active: true, currentWindow: true });
  context = pageContext(currentTab?.url);
  threadPage = context.isPost || context.isQuestion;
  $("page-title").textContent = currentTab?.title || tr("当前标签页");
  $("page-host").textContent = context.host || tr("浏览器内部页面");
  $("page-kind").textContent = threadPage
    ? context.platform === "x"
      ? tr("X · 帖子与讨论")
      : context.platform === "xiaohongshu"
        ? tr("小红书 · 笔记与评论")
        : context.platform === "zhihu"
          ? tr("知乎 · 回答、文章与评论")
          : tr("Reddit · 帖子与评论")
    : tr("网页内容");
  $("context-icon").innerHTML = icon(threadPage ? context.platform : "globe");
  const blockedFeed = context.platform === "x" && !context.isPost;
  $("actions").hidden = !live || !context.supported || blockedFeed;
  if (live && blockedFeed)
    error(tr("请先打开要收藏的 X 帖子详情，不支持收藏信息流"));
  if (live && !context.supported)
    error(tr("此页面不能收藏，请打开一个 HTTP/HTTPS 网页"));
  $("save-post").hidden = !threadPage;
  $("save-page").hidden = threadPage;
  document.querySelector(".selection-action").hidden = threadPage;
  $("save-post-label").textContent =
    context.platform === "zhihu" &&
    !/\/p\/\d+/.test(new URL(currentTab.url).pathname)
      ? tr("选择回答并保存评论")
      : context.platform === "x"
        ? tr("保存当前帖子与回复")
        : tr("保存当前帖子与已加载评论");
  $("folder-field").hidden = threadPage;
  $("tags-field").hidden = !threadPage;
  try {
    const health = await fetch(BASE + "/health", {
      signal: AbortSignal.timeout(1500),
    });
    $("pair").hidden = !health.ok || live;
    if (live) {
      const config = options.preferences || {};
      const stored = await api.storage.local.get("capturePreferences");
      const prefs = stored.capturePreferences || {};
      const folders = options.folders || [];
      const folderPath = (f, seen = new Set()) => {
        if (!f || seen.has(f.id)) return "";
        seen.add(f.id);
        return (
          (f.parentId
            ? folderPath(
                folders.find((p) => p.id === f.parentId),
                seen,
              ) + " / "
            : "") + f.name
        );
      };
      $("destination-folder").innerHTML =
        `<option value="">${tr("网页 · 根文件夹")}</option>` +
        folders
          .map(
            (f) =>
              `<option value="${esc(f.id)}">${esc(folderPath(f))}</option>`,
          )
          .join("");
      $("destination-folder").value =
        prefs.folderId === undefined
          ? config.defaultFolderId || ""
          : prefs.folderId || "";
      const selected = new Set(prefs[context.platform]?.tags || []);
      const names = [
        ...new Set(
          (options.tags || [])
            .filter((t) => t.platform === context.platform)
            .map((t) => t.name),
        ),
      ];
      $("destination-tags").innerHTML =
        names
          .map(
            (t) =>
              `<label><input type="checkbox" value="${esc(t)}" ${selected.has(t) ? "checked" : ""}><span>${esc(t)}</span></label>`,
          )
          .join("") ||
        `<p class="muted">${tr("还没有标签，可先在客户端新建。")}</p>`;
    }
  } catch (e) {
    $("pair").hidden = true;
    if (live) error(tr("无法读取保存位置：") + e.message);
  }
}
$("pairButton").onclick = async () => {
  if (busy) return;
  busy = true;
  $("pairButton").disabled = true;
  try {
    if (!/^\d{6}$/.test($("code").value.trim()))
      throw new Error(tr("请输入 6 位数字配对码"));
    const response = await fetch(BASE + "/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: $("code").value.trim(),
        name: navigator.userAgent.includes("Firefox") ? "Firefox" : "Chromium",
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(tr("配对码无效，请在客户端重新生成"));
    await api.storage.local.set({ connection: await response.json() });
    await init();
  } catch (e) {
    error(e.message);
  } finally {
    busy = false;
    $("pairButton").disabled = false;
  }
};
$("disconnect").onclick = async () => {
  await api.storage.local.remove("connection");
  await init();
};
$("retry-connection").onclick = init;
for (const button of document.querySelectorAll("[data-mode]"))
  button.onclick = async () => {
    if (busy) return;
    busy = true;
    document
      .querySelectorAll("[data-mode]")
      .forEach((b) => (b.disabled = true));
    try {
      await request("/api/status");
      const tab = await api.tabs.get(currentTab.id);
      if (tab.url !== currentTab.url)
        throw new Error(tr("来源页面已变化，请重新打开扩展"));
      const mode = button.dataset.mode;
      const tags =
        threadPage && mode === "thread"
          ? [...$("destination-tags").querySelectorAll("input:checked")].map(
              (i) => i.value,
            )
          : [];
      if (tags.some((t) => new TextEncoder().encode(t).length > 100))
        throw new Error(tr("每个标签不能超过 100 字节"));
      const folderId =
        mode === "thread" ? null : $("destination-folder").value || null;
      const stored = await api.storage.local.get("capturePreferences");
      const prefs = stored.capturePreferences || {};
      prefs.folderId = $("destination-folder").value || null;
      if (threadPage) prefs[context.platform] = { tags };
      await api.storage.local.set({
        capturePreferences: prefs,
        ["pendingCapture_" + tab.id]: {
          mode,
          expectedUrl: tab.url,
          tags,
          folderId,
          createdAt: Date.now(),
        },
      });
      if (
        mode === "selection" ||
        (mode === "thread" &&
          context.platform === "zhihu" &&
          !/\/p\/\d+/.test(new URL(tab.url).pathname))
      ) {
        await api.scripting.executeScript({
          target: { tabId: tab.id },
          func: (language, pickerMode, seconds) => {
            globalThis.__glassmarkLanguage = language;
            globalThis.__glassmarkPickerMode = pickerMode;
            globalThis.__glassmarkZhihuOpenSeconds = seconds;
          },
          args: [
            captureLanguage,
            mode === "thread" ? "zhihu-answer" : "selection",
            captureSeconds,
          ],
        });
        await api.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["picker.js"],
        });
      } else
        await api.tabs.create({
          active: mode !== "thread",
          url:
            api.runtime.getURL("capture.html") +
            "?tab=" +
            tab.id +
            "&mode=" +
            mode,
        });
      window.close();
    } catch (e) {
      error(e.message);
    } finally {
      busy = false;
      document
        .querySelectorAll("[data-mode]")
        .forEach((b) => (b.disabled = false));
    }
  };
init().catch((e) => error(e.message));
