import { t as tr, localizeError, locale } from "./i18n.js";
import { openSettings } from "./settings.js";
import { connect, json, request, mutate } from "./api.js";
import { ArchiveMedia } from "./media.js";
let webMedia;
import { preview, releasePreview } from "./preview.js";
import { renderSocial, releaseSocial } from "./social.js";
import { icon, hydrateIcons } from "./icons.js";
hydrateIcons();
import { itemsInView, itemPlatform } from "./library.js";
const $ = (id) => document.getElementById(id);
const state = {
  items: [],
  allItems: [],
  view: ["web", "x", "reddit", "xiaohongshu"].includes(
    localStorage.getItem("glassmark-view"),
  )
    ? localStorage.getItem("glassmark-view")
    : "web",
  editing: null,
  draggingItem: false,
  folderTreeMarkup: null,
  filters: { threads: false, sort: "recent", author: "", community: "" },
  collapsed: new Set(),
  feedScroll: { x: 0, reddit: 0, xiaohongshu: 0 },
  folders: [],
  folder: null,
  tag: null,
  selected: null,
  query: "",
  globalMode: false,
  siteQueries: { x: "", reddit: "", xiaohongshu: "" },
  tagCatalog: [],
  preferences: {},
  generation: 0,
  previewController: null,
  viewKey: "",
  settingsOpen: false,
};
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const platformLabel = {
  x: "X",
  reddit: "Reddit",
  web: tr("网页"),
  xiaohongshu: tr("小红书"),
};
const fmt = (bytes) =>
  bytes >= 1024 ** 2
    ? (bytes / 1024 ** 2).toFixed(1) + " MB"
    : Math.round(bytes / 1024) + " KB";
function toast(message) {
  $("toast").textContent = localizeError(message);
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 3200);
}
function guarded(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      if (error.name !== "AbortError") toast(error.message);
    }
  };
}
function domain(item) {
  try {
    return new URL(item.url).hostname.replace(/^www\./, "");
  } catch {
    return tr("网页");
  }
}
function folderName() {
  return (
    state.folders.find((f) => f.id === state.folder)?.name || tr("全部网页")
  );
}
function descendants(id, seen = new Set()) {
  if (seen.has(id)) return seen;
  seen.add(id);
  for (const folder of state.folders)
    if (folder.parentId === id) descendants(folder.id, seen);
  return seen;
}
function visible() {
  return itemsInView(state.items, {
    view: state.view,
    folder: state.folder,
    tag: state.tag,
    folders: state.folders,
  });
}
async function switchView(view) {
  state.globalMode = false;
  if (state.view === view && view !== "web") {
    state.selected = null;
    state.filters = {
      threads: false,
      sort: "recent",
      author: "",
      community: "",
    };
  } else {
    state.view = view;
    state.selected = null;
    state.folder = null;
    state.tag = null;
    state.filters = {
      threads: false,
      sort: "recent",
      author: "",
      community: "",
    };
  }
  localStorage.setItem("glassmark-view", view);
  state.viewKey = "";
  if (view === "web" && visible().length) state.selected = visible()[0].id;
  revealSelected();
  await refresh();
}
function renderPlatforms() {
  $("social-platforms").innerHTML = [
    ["x", "X", "Twitter"],
    ["reddit", "Reddit", ""],
    ["xiaohongshu", tr("小红书"), ""],
  ]
    .filter(([view]) =>
      (
        state.preferences.visiblePlatforms || [
          "web",
          "x",
          "reddit",
          "xiaohongshu",
        ]
      ).includes(view),
    )
    .map(
      ([view, name, sub]) =>
        `<button data-view="${view}" class="platform-entry ${state.view === view ? "active" : ""}"><span class="platform-symbol ${view}">${icon(view === "web" ? "globe" : view)}</span><span>${name}${sub ? `<small>${sub}</small>` : ""}</span><b>${state.allItems.filter((i) => itemPlatform(i) === view).length}</b></button>`,
    )
    .join("");
  $("web-root-button").className =
    "platform-entry " + (state.view === "web" ? "active" : "");
  $("web-root-button").innerHTML =
    `<span class="platform-symbol web">${icon("globe")}</span><span>${tr("网页")}</span><b>${state.allItems.filter((i) => itemPlatform(i) === "web").length}</b>`;
  const showWeb = (state.preferences.visiblePlatforms || ["web"]).includes(
    "web",
  );
  document.querySelector(".web-root-row").hidden = !showWeb;
  $("folders").hidden = state.view !== "web" || !showWeb;
  for (const button of $("platforms").querySelectorAll("[data-view]"))
    button.onclick = guarded(() => switchView(button.dataset.view));
  document.body.dataset.view = state.view;
  $("global-results-back").hidden = !state.query || state.globalMode;
  $("sidebar").classList.toggle("social-sidebar", state.view !== "web");
}
function renderFolders() {
  if (state.draggingItem) return;
  const webItems = state.allItems.filter((i) => itemPlatform(i) === "web");
  const matches = state.allItems.filter(
    (i) =>
      itemPlatform(i) === "web" && (!state.tag || i.tags?.includes(state.tag)),
  );
  const filtered = Boolean(state.tag);
  function files(parent, depth) {
    return matches
      .filter((i) => (i.folderId || null) === parent)
      .map(
        (item) =>
          `<button class="tree-file ${state.selected === item.id ? "selected" : ""}" style="--depth:${depth}" data-item="${item.id}" aria-current="${state.selected === item.id ? "page" : "false"}" title="${escape(item.title)} · ${escape(item.url)}" draggable="true">${icon("file")}<span>${escape(item.title)}</span></button>`,
      )
      .join("");
  }
  function walk(parent = null, depth = 0, seen = new Set()) {
    return state.folders
      .filter((f) => (f.parentId || null) === parent && !seen.has(f.id))
      .map((folder) => {
        const next = new Set([...seen, folder.id]);
        const ids = descendants(folder.id);
        if (filtered && !matches.some((i) => ids.has(i.folderId))) return "";
        const hasChildren =
          state.folders.some((f) => f.parentId === folder.id) ||
          matches.some((i) => i.folderId === folder.id);
        const collapsed = !filtered && state.collapsed.has(folder.id);
        return `<div class="tree-folder" data-tree-folder="${folder.id}"><div class="folder-row ${state.folder === folder.id ? "active" : ""}" style="--depth:${depth}"><button class="folder-disclosure ${collapsed ? "collapsed" : ""}" data-collapse="${folder.id}" ${hasChildren ? "" : "disabled"} aria-label="${collapsed ? tr("展开") : tr("折叠")} ${escape(folder.name)}" aria-expanded="${!collapsed}" aria-controls="folder-children-${folder.id}">${hasChildren ? icon("chevron") : ""}</button><button class="folder" data-folder="${folder.id}">${icon("folder")}<span>${escape(folder.name)}</span><small>${webItems.filter((i) => ids.has(i.folderId)).length}</small></button><button class="rename-folder" data-rename="${folder.id}" aria-label="${tr("编辑 {16}", { 16: escape(folder.name) })}">${icon("more")}</button></div>${collapsed ? "" : `<div class="folder-children" id="folder-children-${folder.id}">${walk(folder.id, depth + 1, next)}${files(folder.id, depth + 1)}</div>`}</div>`;
      })
      .join("");
  }
  const treeMarkup = `${walk()}${files(null, 0)}${matches.length ? "" : `<div class="tree-empty">${tr("从浏览器收藏网页")}</div>`}`;
  if (state.folderTreeMarkup !== treeMarkup) {
    $("folders").innerHTML = treeMarkup;
    state.folderTreeMarkup = treeMarkup;
  }
  $("breadcrumb-current").textContent = state.tag
    ? "# " + state.tag
    : folderName();
  for (const button of $("folders").querySelectorAll("[data-item]")) {
    button.onclick = () => {
      state.selected = button.dataset.item;
      state.folder =
        matches.find((i) => i.id === state.selected)?.folderId || null;
      state.globalMode = false;
      state.items = state.allItems;
      render();
    };
    button.ondragstart = (e) => {
      state.draggingItem = true;
      e.dataTransfer.setData("text/glassmark-id", button.dataset.item);
    };
    button.ondragend = () => {
      state.draggingItem = false;
      renderFolders();
    };
  }
  for (const button of $("folders").querySelectorAll("[data-folder]")) {
    button.onclick = () => {
      state.folder = button.dataset.folder || null;
      state.tag = null;
      state.collapsed.delete(state.folder);
      state.selected = visible()[0]?.id || null;
      revealSelected();
      render();
    };
    button.ondragover = (e) => {
      e.preventDefault();
      button.classList.add("drop-target");
    };
    button.ondragleave = () => button.classList.remove("drop-target");
    button.ondrop = guarded(async (e) => {
      e.preventDefault();
      state.draggingItem = false;
      button.classList.remove("drop-target");
      const id = e.dataTransfer.getData("text/glassmark-id");
      if (id) {
        const item = state.allItems.find((i) => i.id === id);
        if (!item || itemPlatform(item) !== "web") return;
        await mutate(
          "/api/items/" + id,
          { folderId: button.dataset.folder || null },
          "PUT",
        );
        state.collapsed.delete(button.dataset.folder);
        await refresh();
      }
    });
  }
  for (const button of $("folders").querySelectorAll("[data-collapse]"))
    button.onclick = () => {
      const id = button.dataset.collapse;
      state.collapsed.has(id)
        ? state.collapsed.delete(id)
        : state.collapsed.add(id);
      renderFolders();
    };
  for (const button of $("folders").querySelectorAll("[data-rename]"))
    button.onclick = () => editFolder(button.dataset.rename);
  const tags = [
    ...new Set(
      state.allItems
        .filter((i) => itemPlatform(i) === state.view)
        .flatMap((item) => item.tags || []),
    ),
  ];
  $("tags").hidden = state.view !== "web";
  $("tags").innerHTML = tags
    .map(
      (tag) =>
        `<button data-tag="${escape(tag)}" class="${state.tag === tag ? "active" : ""}"># ${escape(tag)}</button>`,
    )
    .join("");
  for (const button of $("tags").querySelectorAll("button"))
    button.onclick = () => {
      state.tag = state.tag === button.dataset.tag ? null : button.dataset.tag;
      state.selected = null;
      render();
    };
}
function revealSelected() {
  let id = state.items.find((i) => i.id === state.selected)?.folderId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    state.collapsed.delete(id);
    id = state.folders.find((f) => f.id === id)?.parentId;
  }
}
function renderGlobalResults() {
  $("page-metadata").hidden = true;
  $("reader").classList.remove("immersive-web");
  releaseSocial();
  releasePreview();
  webMedia?.release();
  state.previewController?.abort();
  const key =
    "global|" +
    state.query +
    state.items.map((i) => i.id + i.modifiedAt).join();
  $("reader").classList.remove("social-reader");
  $("toolbar").hidden = false;
  $("breadcrumb-current").textContent = tr("全局搜索");
  for (const id of ["move", "tag-button", "info", "delete"])
    $(id).disabled = true;
  if (state.viewKey === key) return;
  state.viewKey = key;
  $("reader").innerHTML =
    `<section class="global-results"><p class="eyebrow">${tr("SEARCH YOUR LIBRARY")}</p><h1>${escape(state.query)}</h1><p>${tr("{1} 份收藏 · 网页与平台内容", { 1: state.items.length })}</p>${state.items.map((i) => `<button class="global-result" data-global-id="${i.id}">${icon(itemPlatform(i) === "web" ? "file" : itemPlatform(i))}<span><strong>${escape(i.title)}</strong><small>${platformLabel[itemPlatform(i)]} · ${escape(domain(i))} · ${(i.tags || []).map((t) => "#" + escape(t)).join(" ")}</small><p>${escape((i.text || "").slice(0, 140))}</p></span></button>`).join("") || `<p>${tr("没有找到匹配的内容")}</p>`}</section>`;
  $("reader").onclick = guarded(async (e) => {
    clearTimeout(timer);
    state.generation++;
    const button = e.target.closest("[data-global-id]");
    if (!button) return;
    const item = state.items.find((i) => i.id === button.dataset.globalId);
    if (!item) return;
    state.globalMode = false;
    state.view = itemPlatform(item);
    state.folder = item.folderId || null;
    state.tag = null;
    state.siteQueries[state.view] = "";
    state.selected = item.id;
    state.viewKey = "";
    await refresh();
    revealSelected();
    render();
  });
}
async function renderReader() {
  if (state.globalMode && state.query) {
    renderGlobalResults();
    return;
  }
  const social = state.view !== "web";
  $("page-metadata").hidden = social || !state.selected;
  $("reader").classList.toggle(
    "immersive-web",
    !social && Boolean(state.selected),
  );
  $("reader").classList.toggle("social-reader", social);
  $("toolbar").hidden = social;
  if (social) {
    const items = visible();
    const key =
      "social|" +
      state.view +
      "|" +
      state.selected +
      "|" +
      state.query +
      "|" +
      JSON.stringify(state.filters) +
      JSON.stringify(state.tagCatalog) +
      "|" +
      String(state.tag) +
      "|" +
      items.map((i) => i.id + i.modifiedAt).join(",");
    if (state.viewKey === key) return;
    state.viewKey = key;
    state.previewController?.abort();
    releasePreview();
    webMedia?.release();
    for (const id of ["move", "tag-button", "info", "delete"])
      $(id).disabled = true;
    await renderSocial($("reader"), {
      kind: state.view,
      items,
      selected: state.selected,
      query: state.siteQueries[state.view] || "",
      tags: [
        ...new Set([
          ...state.tagCatalog
            .filter((t) => t.platform === state.view)
            .map((t) => t.name),
          ...state.allItems
            .filter((i) => itemPlatform(i) === state.view)
            .flatMap((i) => i.tags || []),
        ]),
      ],
      tag: state.tag,
      filters: state.filters,
      callbacks: { action: guarded(socialAction) },
    });
    if (state.viewKey === key)
      $("reader").scrollTop = state.selected
        ? 0
        : state.feedScroll[state.view] || 0;
    return;
  }
  releaseSocial();
  $("reader").onclick = null;
  $("reader").onkeydown = null;
  const item = state.items.find((i) => i.id === state.selected);
  const key =
    state.view +
    "|content|" +
    (item ? item.id + "|" + item.modifiedAt : "empty") +
    JSON.stringify(state.preferences);
  if (state.viewKey === key) return;
  state.viewKey = key;
  webMedia?.release();
  state.previewController?.abort();
  state.previewController = new AbortController();
  const signal = state.previewController.signal;
  for (const id of ["move", "tag-button", "info", "delete"])
    $(id).disabled = !item;
  if (!item) {
    releasePreview();
    $("reader").innerHTML =
      `<section class="empty-reader"><div class="glass-emblem">${icon("logo")}</div><p class="eyebrow">${tr("YOUR PERSONAL CORNER OF THE WEB")}</p><h1>${tr("让好内容，留下来。")}</h1><p>${tr("一篇文章，一段对话，一瞬灵感。")}<br>${tr("从浏览器收藏，在这里慢慢读。")}</p><div class="empty-features"><span>${tr("{1}本地保存", { 1: icon("archive") })}</span><span>${tr("{2}原站外观", { 2: icon("globe") })}</span><span>${tr("{3}跨设备同步", { 3: icon("refresh") })}</span></div><button id="connect-start" class="primary">${tr("连接浏览器插件 {4}", { 4: icon("external") })}</button></section>`;
    $("connect-start").onclick = guarded(showSettings);
    return;
  }
  $("move").disabled = state.view !== "web";
  const saved = item.resources.filter((r) => r.status === "saved");
  const failed = item.resources.length - saved.length;
  $("page-metadata").innerHTML =
    `<span class="page-title" title="${escape(item.title)}">${escape(item.title)}</span><button id="source-link" class="text-button" title="${escape(item.url)}">${escape(domain(item))}</button><span ${state.preferences.showSavedTime === false ? "hidden" : ""}>${new Date(item.capturedAt).toLocaleString(locale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><button id="resource-warning" ${state.preferences.showMediaStats === false ? "hidden" : ""} class="text-button ${failed ? "has-failures" : ""}" title="${tr("查看保存详情")}">${tr("{8} 个资源 · {9}{10}", { 8: saved.length, 9: fmt(saved.reduce((n, r) => n + r.bytes, 0)), 10: failed ? ` ${tr("· {0} 个失败", { 0: failed })}` : "" })}</button>`;
  $("source-link").onclick = () => showSourceLink(item.url);
  $("resource-warning").onclick = guarded(showInfo);
  $("reader").innerHTML =
    `<div class="preview-frame"><div id="preview-loading">${tr("正在加载保存内容…")}</div><iframe id="saved-page" title="${tr("保存的网页内容")}" sandbox="allow-same-origin" referrerpolicy="no-referrer" hidden></iframe></div>`;
  try {
    const url = await preview(item, signal);
    if (signal.aborted) return;
    const frame = $("saved-page");
    if (!frame) return;
    frame.src = url;
    frame.hidden = false;
    $("preview-loading").remove();
    const streams = (item.videos || []).filter((u) => /\.m3u8(?:\?|$)/.test(u));
    if (streams.length) {
      const section = document.createElement("section");
      section.className = "archived-videos";
      section.innerHTML = `<h2>${tr("离线视频")}</h2>${streams.map((u) => `<div class="social-media"><video controls preload="metadata" data-archive-id="${item.id}" data-archive-media="${escape(u)}"></video><span class="media-fallback">${tr("视频未能归档或当前系统不支持播放")}</span></div>`).join("")}`;
      $("reader").append(section);
      webMedia = new ArchiveMedia();
      await webMedia.hydrate(section, [item]);
    }
  } catch (error) {
    if (error.name !== "AbortError" && $("preview-loading"))
      $("preview-loading").textContent = tr("预览失败：") + error.message;
  }
}
function render() {
  renderPlatforms();
  renderFolders();
  renderReader();
}
async function refresh() {
  const generation = ++state.generation;
  const query = state.globalMode
    ? state.query
    : state.siteQueries[state.view] || "";
  const [items, folders, allItems, catalog, preferences] = await Promise.all([
    json("/api/items?q=" + encodeURIComponent(query)),
    json("/api/folders"),
    query ? json("/api/items") : Promise.resolve(null),
    json("/api/tags"),
    json("/api/preferences"),
  ]);
  if (generation !== state.generation) return;
  state.items = items;
  state.allItems = allItems || items;
  state.folders = folders;
  state.tagCatalog = catalog;
  state.preferences = preferences;
  if (state.view === "web" && !state.selected && visible().length) {
    state.selected = visible()[0].id;
    revealSelected();
  }
  render();
}
async function socialAction(action, data = {}) {
  const item =
    state.items.find((i) => i.id === data.id) ||
    state.items.find((i) => i.id === state.selected);
  if (action === "open" && item) {
    if (state.selected === item.id) {
      $("reader")
        .querySelector(".reddit-comments-title,.x-reply")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    state.feedScroll[state.view] = $("reader").scrollTop;
    state.selected = item.id;
    renderReader();
    return;
  }
  if (action === "bookmarks") {
    state.selected = null;
    state.filters.author = "";
    state.filters.community = "";
    state.feedScroll[state.view] = 0;
    state.viewKey = "";
    state.tag = null;
    state.siteQueries[state.view] = "";
    await refresh();
    return;
  }
  if (action === "search") {
    state.siteQueries[state.view] = String(data.query || "").trim();
    state.globalMode = false;
    state.selected = null;
    state.feedScroll[state.view] = 0;
    await refresh();
    return;
  }
  if (action === "tag-filter") {
    state.tag = data.tag || null;
    state.selected = null;
    state.viewKey = "";
    render();
    return;
  }
  if (action === "new-tag") {
    modal(
      tr("新建平台标签", { platform: platformLabel[state.view] }),
      `<label>${tr("标签名称")}<input id="catalog-tag-name" maxlength="100" placeholder="${tr("例如：设计灵感")}"></label>`,
      [
        {
          label: tr("创建标签"),
          primary: true,
          run: async () => {
            const name = $("catalog-tag-name").value.trim();
            if (!name) throw new Error(tr("请输入标签名称"));
            await mutate("/api/tags", { name, platform: state.view });
            $("dialog").close();
            await refresh();
          },
        },
      ],
    );
    return;
  }
  if (action === "back") {
    state.selected = null;
    state.viewKey = "";
    render();
    return;
  }
  if (action === "info" && item) {
    state.editing = item.id;
    await showInfo();
    return;
  }
  if (action === "delete" && item) {
    confirmDelete(item);
    return;
  }
  if (action === "tags" && item) {
    state.editing = item.id;
    editTags();
    return;
  }
  if (action === "copy" && item) {
    await navigator.clipboard.writeText(item.url);
    toast(tr("来源链接已复制"));
    return;
  }
  if (action === "like" && item) {
    const tags = item.tags || [];
    await mutate(
      "/api/items/" + item.id,
      {
        tags: tags.includes("喜欢")
          ? tags.filter((t) => t !== "喜欢")
          : [...tags, "喜欢"],
      },
      "PUT",
    );
    await refresh();
    return;
  }
  if (action === "author") {
    state.filters.author = data.author;
    state.filters.community = "";
  }
  if (action === "community") {
    state.filters.community = data.community;
    state.filters.author = "";
  }
  if (action === "clear-filter") {
    state.filters.author = "";
    state.filters.community = "";
  }
  if (action === "sort-recent") state.filters.sort = "recent";
  if (action === "sort-best") state.filters.sort = "best";
  state.selected = null;
  state.feedScroll[state.view] = 0;
  state.viewKey = "";
  render();
}
function modal(title, body, actions = []) {
  $("dialog").classList.remove("settings-window");
  $("dialog-title").textContent = title;
  $("dialog-body").innerHTML = body;
  $("dialog-actions").innerHTML =
    `<button type="button" id="dialog-cancel" class="secondary">${tr("取消")}</button>`;
  $("dialog-cancel").onclick = () => $("dialog").close();
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action.primary ? "primary" : "secondary";
    button.textContent = action.label;
    button.onclick = guarded(action.run);
    $("dialog-actions").append(button);
  }
  if (!$("dialog").open) $("dialog").showModal();
}
function folderOptions(current = null) {
  return (
    `<option value="">${tr("所有收藏（未归类）")}</option>` +
    state.folders
      .map(
        (f) =>
          `<option value="${f.id}" ${current === f.id ? "selected" : ""}>${escape(f.name)}</option>`,
      )
      .join("")
  );
}
async function createFolder() {
  modal(
    tr("新建文件夹"),
    `<label>${tr("名称")}<input id="folder-name" placeholder="${tr("例如：设计灵感")}" maxlength="100" required></label><label>${tr("父文件夹")}<select id="folder-parent">${folderOptions(state.folder)}</select></label>`,
    [
      {
        label: tr("创建文件夹"),
        primary: true,
        run: async () => {
          const name = $("folder-name").value.trim();
          if (!name) throw new Error(tr("请输入文件夹名称"));
          await mutate("/api/folders", {
            name,
            parentId: $("folder-parent").value || null,
          });
          $("dialog").close();
          await refresh();
        },
      },
    ],
  );
  $("folder-name").focus();
}
function editFolder(id) {
  const folder = state.folders.find((f) => f.id === id);
  if (!folder) return;
  modal(
    tr("编辑文件夹"),
    `<label>${tr("名称")}<input id="folder-name" value="${escape(folder.name)}" maxlength="100"></label><label>${tr("父文件夹")}<select id="folder-parent">${folderOptions(folder.parentId)}</select></label>`,
    [
      {
        label: tr("保存"),
        primary: true,
        run: async () => {
          await mutate(
            "/api/folders/" + id,
            {
              name: $("folder-name").value.trim(),
              parentId: $("folder-parent").value || null,
            },
            "PUT",
          );
          $("dialog").close();
          await refresh();
        },
      },
    ],
  );
}
const selected = () =>
  state.items.find((i) => i.id === (state.editing || state.selected));
function showSourceLink(url) {
  modal(
    tr("原始网页"),
    `<p class="subtle">${tr("复制下面的地址，在浏览器中打开原站。")}</p><input id="original-url" readonly value="${escape(url)}">`,
    [
      {
        label: tr("复制网址"),
        primary: true,
        run: async () => {
          await navigator.clipboard.writeText(url);
          toast(tr("网址已复制"));
        },
      },
    ],
  );
}
function tagChoices(item) {
  const kind = itemPlatform(item);
  return [
    ...new Set([
      ...state.tagCatalog.filter((t) => t.platform === kind).map((t) => t.name),
      ...state.allItems
        .filter((i) => itemPlatform(i) === kind)
        .flatMap((i) => i.tags || []),
      ...(item.tags || []),
    ]),
  ].sort();
}
function editTags() {
  const item = selected();
  if (!item) return;
  const chosen = new Set(item.tags || []);
  const draw = () => {
    $("tag-choices").innerHTML =
      tagChoices(item)
        .map(
          (tag) =>
            `<label class="tag-choice"><input type="checkbox" name="item-tag" value="${escape(tag)}" ${chosen.has(tag) ? "checked" : ""}>${icon("tag")}<span>${escape(tag)}</span></label>`,
        )
        .join("") ||
      `<p class="subtle">${tr("还没有标签，请先新建标签，再勾选。")}</p>`;
    for (const input of $("tag-choices").querySelectorAll("input"))
      input.onchange = () =>
        input.checked ? chosen.add(input.value) : chosen.delete(input.value);
  };
  modal(
    tr("选择标签"),
    `<p class="subtle">${tr("可多选，取消勾选即可移除标签。")}</p><div id="tag-choices" class="tag-choices"></div><details class="new-tag-inline"><summary>${tr("新建标签")}</summary><label>${tr("名称")}<input id="new-item-tag" maxlength="100" placeholder="${tr("标签名称")}"></label><button type="button" id="create-item-tag" class="secondary">${tr("创建并选中")}</button></details>`,
    [
      {
        label: tr("保存标签"),
        primary: true,
        run: async () => {
          await mutate("/api/items/" + item.id, { tags: [...chosen] }, "PUT");
          $("dialog").close();
          await refresh();
        },
      },
    ],
  );
  draw();
  $("create-item-tag").onclick = guarded(async () => {
    const name = $("new-item-tag").value.trim();
    if (!name) throw new Error(tr("请输入标签名称"));
    const tag = await mutate("/api/tags", {
      name,
      platform: itemPlatform(item),
    });
    state.tagCatalog.push(tag);
    chosen.add(name);
    $("new-item-tag").value = "";
    draw();
  });
}
function moveItem() {
  const item = selected();
  if (!item) return;
  modal(
    tr("移动收藏"),
    `<label>${tr("目标文件夹")}<select id="move-folder">${folderOptions(item.folderId)}</select></label>`,
    [
      {
        label: tr("移动"),
        primary: true,
        run: async () => {
          await mutate(
            "/api/items/" + item.id,
            { folderId: $("move-folder").value || null },
            "PUT",
          );
          state.folder = $("move-folder").value || null;
          $("dialog").close();
          await refresh();
          revealSelected();
          renderFolders();
        },
      },
    ],
  );
}
async function download(item, file) {
  const response = await request(`/api/items/${item.id}/content/${file}`);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${item.title.replace(/[\\/:*?"<>|]/g, "_")}-${file}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function showInfo() {
  const item = selected();
  if (!item) return;
  const failures = item.resources.filter((r) => r.status !== "saved");
  modal(
    tr("归档详情"),
    `<div class="detail-grid"><span>${tr("来源")}</span><span>${escape(item.url)}</span><span>${tr("保存范围")}</span><span>${tr("{1} · {2} 个帖子/评论", { 1: escape(item.mode === "thread" ? tr("帖子与讨论") : item.mode === "selection" ? tr("选定区域") : tr("网页内容")), 2: item.posts?.length || 0 })}</span><span>${tr("归档时间")}</span><span>${escape(new Date(item.capturedAt).toLocaleString(locale()))}</span></div><h3>${tr("保存记录")}</h3><ul class="report-list">${[...(item.warnings || []), ...item.resources.filter((r) => r.warning).map((r) => r.warning), ...failures.map((r) => r.url + " — " + r.error)].map((w) => `<li>${escape(w)}</li>`).join("") || `<li>${tr("本次请求的资源均已保存")}</li>`}</ul><p class="subtle">${tr("正文、评论与媒体保存在本机；网页保留一份用于阅读的内容文件。")}</p>`,
    [
      ...(itemPlatform(item) === "web"
        ? [
            {
              label: tr("导出网页内容"),
              run: () => download(item, "content.html"),
            },
          ]
        : []),
      { label: tr("导出资源清单"), run: () => download(item, "manifest.json") },
    ],
  );
}
async function showSettings() {
  await openSettings({
    modal,
    folders: state.folders,
    onSaved: refresh,
    toast,
  });
}
$("settings").onclick = guarded(showSettings);
$("new-folder").onclick = guarded(createFolder);
$("tag-button").onclick = guarded(editTags);
$("move").onclick = guarded(moveItem);
$("info").onclick = guarded(showInfo);
function confirmDelete(item) {
  if (!item) return;
  if (state.preferences.confirmDelete === false) {
    json("/api/items/" + item.id, { method: "DELETE" })
      .then(async () => {
        state.selected = null;
        state.viewKey = "";
        await refresh();
        toast(tr("收藏已删除"));
      })
      .catch((e) => toast(e.message));
    return;
  }
  modal(
    tr("删除这份收藏？"),
    `<p>${tr("「{0}」将从资料库、搜索结果和标签中移除。删除记录会同步到其他设备。", { 0: escape(item.title) })}</p>`,
    [
      {
        label: tr("删除收藏"),
        run: async () => {
          await json("/api/items/" + item.id, { method: "DELETE" });
          state.selected = null;
          state.editing = null;
          state.viewKey = "";
          $("dialog").close();
          await refresh();
          toast(tr("收藏已删除"));
        },
      },
    ],
  );
}
$("delete").onclick = () => confirmDelete(selected());
$("dialog").querySelector("form").onsubmit = (e) => {
  e.preventDefault();
  $("dialog-actions").querySelector(".primary")?.click();
};
$("dialog-close").onclick = () => $("dialog").close();
$("dialog").addEventListener("click", (e) => {
  if (e.target === $("dialog")) {
    const r = $("dialog").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      $("dialog").close();
  }
});
$("sync-button").onclick = guarded(async () => {
  toast(tr("正在同步…"));
  const result = await mutate("/api/sync", {});
  toast(result.error || tr("同步完成"));
  await refresh();
});
let timer;
$("search").oninput = () => {
  clearTimeout(timer);
  state.generation++;
  state.query = $("search").value.trim();
  state.globalMode = Boolean(state.query);
  timer = setTimeout(
    guarded(async () => {
      state.selected = null;
      await refresh();
    }),
    180,
  );
};
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("search").focus();
  }
});
$("global-results-back").onclick = guarded(async () => {
  state.globalMode = true;
  state.selected = null;
  await refresh();
});
$("search").onkeydown = guarded(async (e) => {
  if (e.key === "Enter") {
    state.globalMode = Boolean(state.query);
    await refresh();
  }
});
let busy = false;
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const status = await json("/api/status");
    $("connection-dot").classList.add("online");
    $("connection-status").textContent = status.sync?.error
      ? tr("同步失败，点击设置查看")
      : status.running
        ? tr("正在同步…")
        : tr("本地服务已连接");
    if (!$("dialog").open) await refresh();
  } catch {
    $("connection-dot").classList.remove("online");
    $("connection-status").textContent = tr("本地服务未连接");
  } finally {
    busy = false;
  }
}
(async () => {
  try {
    await connect();
    await refresh();
    await poll();
    setInterval(poll, 3000);
  } catch (error) {
    $("connection-status").textContent = tr("连接失败");
    $("reader").innerHTML =
      `<section class="empty-reader"><h1>${tr("暂时无法连接")}</h1><p>` +
      escape(error.message) +
      "</p></section>";
  }
})();

if (globalThis.__TAURI__) {
  const win = globalThis.__TAURI__.window.getCurrentWindow();
  if (/Windows/.test(navigator.userAgent))
    document.documentElement.classList.add("native-windows");
  const updateCorners = async () =>
    document.documentElement.classList.toggle(
      "native-maximized",
      await win.isMaximized(),
    );
  win.onResized(updateCorners);
  updateCorners();
  $("window-close").onclick = () => win.close();
  $("window-minimize").onclick = () => win.minimize();
  $("window-maximize").onclick = () => win.toggleMaximize();
  document.addEventListener("mousedown", (e) => {
    if (
      e.button !== 0 ||
      !e.target.closest(".window-drag-handle") ||
      e.target.closest("button,input,select,a,label,form")
    )
      return;
    e.preventDefault();
    if (e.detail === 2)
      win.toggleMaximize().catch((error) => toast(error.message));
    else win.startDragging().catch((error) => toast(error.message));
  });
}

if (globalThis.__TAURI__) document.body.classList.add("native-glass");

$("dialog").addEventListener("close", () => {
  state.editing = null;
});
