import { hydrateIcons, icon } from "../../../app/icons.js";
import { api, BASE, request, connected } from "../api.js";
import { pageContext } from "../context.js";
hydrateIcons();
const $ = (id) => document.getElementById(id);
let currentTab,
  context,
  busy = false;
const esc = (s) =>
  String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function error(message) {
  $("status").textContent = message;
  $("status").classList.add("error");
}
async function init() {
  $("status").classList.remove("error");
  const live = await connected();
  $("connection-badge").textContent = live ? "已连接" : "未连接";
  $("connection-badge").classList.toggle("online", live);
  $("status").textContent = live
    ? "已就绪 · 收藏将发送到 Glassmark"
    : "请打开客户端并连接，收藏操作已停用";
  [currentTab] = await api.tabs.query({ active: true, currentWindow: true });
  context = pageContext(currentTab?.url);
  $("page-title").textContent = currentTab?.title || "当前标签页";
  $("page-host").textContent = context.host || "浏览器内部页面";
  $("page-kind").textContent = context.isPost
    ? context.platform === "x"
      ? "X · 帖子与讨论"
      : "Reddit · 帖子与评论"
    : "网页快照";
  $("context-icon").innerHTML = icon(
    context.isPost ? context.platform : "globe",
  );
  $("actions").hidden = !live || !context.supported;
  if (live && !context.supported)
    error("此页面不能收藏，请打开一个 HTTP/HTTPS 网页");
  $("save-post").hidden = !context.isPost;
  $("save-page").classList.toggle("secondary", context.isPost);
  $("save-post-label").textContent =
    context.platform === "x"
      ? "保存当前帖子与回复"
      : "保存当前帖子与已加载评论";
  $("folder-field").hidden = context.isPost;
  $("tags-field").hidden = !context.isPost;
  $("capture-scope").textContent = context.isPost
    ? context.platform === "x"
      ? "锁定当前主帖，自动加载最多 100 条帖子；完成后可继续收集。"
      : "锁定当前主帖，包含页面已加载的全部评论与回复。"
    : context.platform !== "web"
      ? "当前不是帖子详情页。若需收藏讨论，请先点进一条帖子。"
      : "保存 HTML、计算样式和原始脚本，支持多个区域与视频归档。";
  try {
    const health = await fetch(BASE + "/health", {
      signal: AbortSignal.timeout(1500),
    });
    $("pair").hidden = !health.ok || live;
    if (live) {
      const options = await (await request("/api/capture-options")).json();
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
        '<option value="">网页 · 根文件夹</option>' +
        folders
          .map(
            (f) =>
              `<option value="${esc(f.id)}">${esc(folderPath(f))}</option>`,
          )
          .join("");
      $("destination-folder").value = prefs.folderId || "";
      $("destination-tags").value = (prefs[context.platform]?.tags || []).join(
        ", ",
      );
      $("tag-suggestions").innerHTML = [
        ...new Set(
          (options.tags || [])
            .filter((t) => t.platform === context.platform)
            .map((t) => t.name),
        ),
      ]
        .map((t) => `<option value="${esc(t)}"></option>`)
        .join("");
    }
  } catch (e) {
    $("pair").hidden = true;
    if (live) error("无法读取保存位置：" + e.message);
  }
}
$("pairButton").onclick = async () => {
  if (busy) return;
  busy = true;
  $("pairButton").disabled = true;
  try {
    if (!/^\d{6}$/.test($("code").value.trim()))
      throw new Error("请输入 6 位数字配对码");
    const response = await fetch(BASE + "/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: $("code").value.trim(),
        name: navigator.userAgent.includes("Firefox") ? "Firefox" : "Chromium",
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("配对码无效，请在客户端重新生成");
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
        throw new Error("来源页面已变化，请重新打开扩展");
      const mode = button.dataset.mode;
      const tags =
        context.isPost && mode === "thread"
          ? [
              ...new Set(
                $("destination-tags")
                  .value.split(/[,，]/)
                  .map((t) => t.trim())
                  .filter(Boolean),
              ),
            ]
          : [];
      if (tags.some((t) => new TextEncoder().encode(t).length > 100))
        throw new Error("每个标签不能超过 100 字节");
      const folderId =
        mode === "thread" ? null : $("destination-folder").value || null;
      const stored = await api.storage.local.get("capturePreferences");
      const prefs = stored.capturePreferences || {};
      prefs.folderId = $("destination-folder").value || null;
      if (context.isPost) prefs[context.platform] = { tags };
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
      if (mode === "selection")
        await api.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["picker.js"],
        });
      else
        await api.tabs.create({
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
