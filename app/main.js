import { connect, json, request, mutate } from "./api.js";
import { preview, releasePreview } from "./preview.js";
import { renderSocial, releaseSocial } from "./social.js";
import { icon } from "./icons.js";
import { itemsInView, itemPlatform } from "./library.js";
const $ = (id) => document.getElementById(id);
const state = {
  items: [],
  allItems: [],
  view: ["web", "x", "reddit"].includes(localStorage.getItem("glassmark-view"))
    ? localStorage.getItem("glassmark-view")
    : "web",
  rawSnapshot: false,
  editing: null,
  filters: { threads: false, sort: "recent", author: "", community: "" },
  collapsed: new Set(),
  feedScroll: { x: 0, reddit: 0 },
  folders: [],
  folder: null,
  tag: null,
  selected: null,
  query: "",
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
const platformLabel = { x: "X", reddit: "Reddit", web: "网页" };
const fmt = (bytes) =>
  bytes >= 1024 ** 2
    ? (bytes / 1024 ** 2).toFixed(1) + " MB"
    : Math.round(bytes / 1024) + " KB";
function toast(message) {
  $("toast").textContent = message;
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
    return "网页";
  }
}
function folderName() {
  return state.folders.find((f) => f.id === state.folder)?.name || "全部网页";
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
function switchView(view) {
  if (state.view === view && view !== "web") {
    state.selected = null;
    state.rawSnapshot = false;
    state.filters = {
      threads: false,
      sort: "recent",
      author: "",
      community: "",
    };
  } else {
    state.view = view;
    state.selected = null;
    state.rawSnapshot = false;
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
  render();
}
function renderPlatforms() {
  $("platforms").innerHTML = [
    ["x", "X", "Twitter"],
    ["reddit", "Reddit", ""],
    ["web", "网页", ""],
  ]
    .map(
      ([view, name, sub]) =>
        `<button data-view="${view}" class="platform-entry ${state.view === view ? "active" : ""}"><span class="platform-symbol ${view}">${icon(view === "web" ? "globe" : view)}</span><span>${name}${sub ? `<small>${sub}</small>` : ""}</span><b>${state.allItems.filter((i) => itemPlatform(i) === view).length}</b></button>`,
    )
    .join("");
  for (const button of $("platforms").querySelectorAll("button"))
    button.onclick = () => switchView(button.dataset.view);
  document.body.dataset.view = state.view;
  $("web-folder-section").hidden = state.view !== "web";
  $("sidebar").classList.toggle("social-sidebar", state.view !== "web");
}
function renderFolders() {
  const webItems = state.allItems.filter((i) => itemPlatform(i) === "web");
  const matches = state.items.filter(
    (i) =>
      itemPlatform(i) === "web" && (!state.tag || i.tags?.includes(state.tag)),
  );
  const filtered = Boolean(state.query || state.tag);
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
        return `<div class="tree-folder" data-tree-folder="${folder.id}"><div class="folder-row ${state.folder === folder.id ? "active" : ""}" style="--depth:${depth}"><button class="folder-disclosure ${collapsed ? "collapsed" : ""}" data-collapse="${folder.id}" ${hasChildren ? "" : "disabled"} aria-label="${collapsed ? "展开" : "折叠"} ${escape(folder.name)}" aria-expanded="${!collapsed}" aria-controls="folder-children-${folder.id}">${hasChildren ? icon("chevron") : ""}</button><button class="folder" data-folder="${folder.id}">${icon("folder")}<span>${escape(folder.name)}</span><small>${webItems.filter((i) => ids.has(i.folderId)).length}</small></button><button class="rename-folder" data-rename="${folder.id}" aria-label="编辑 ${escape(folder.name)}">${icon("more")}</button></div>${collapsed ? "" : `<div class="folder-children" id="folder-children-${folder.id}">${walk(folder.id, depth + 1, next)}${files(folder.id, depth + 1)}</div>`}</div>`;
      })
      .join("");
  }
  $("folders").innerHTML =
    `<button class="folder folder-root ${!state.folder ? "active" : ""}" data-folder="">${icon("globe")}<span>全部网页</span><small>${webItems.length}</small></button>${walk()}${files(null, 0)}${matches.length ? "" : '<div class="tree-empty">没有找到网页</div>'}`;
  $("breadcrumb-current").textContent = state.tag
    ? "# " + state.tag
    : folderName();
  for (const button of $("folders").querySelectorAll("[data-item]")) {
    button.onclick = () => {
      state.selected = button.dataset.item;
      state.folder =
        matches.find((i) => i.id === state.selected)?.folderId || null;
      renderFolders();
      renderReader();
    };
    button.ondragstart = (e) =>
      e.dataTransfer.setData("text/glassmark-id", button.dataset.item);
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
      state.items
        .filter((i) => itemPlatform(i) === state.view)
        .flatMap((item) => item.tags || []),
    ),
  ];
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
async function renderReader() {
  const social = state.view !== "web" && !state.rawSnapshot;
  $("reader").classList.toggle("social-reader", social);
  $("toolbar").hidden = social;
  $("snapshot-back").hidden = !state.rawSnapshot;
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
      "|" +
      String(state.tag) +
      "|" +
      items.map((i) => i.id + i.modifiedAt).join(",");
    if (state.viewKey === key) return;
    state.viewKey = key;
    state.previewController?.abort();
    releasePreview();
    for (const id of ["move", "tag-button", "info", "delete"])
      $(id).disabled = true;
    await renderSocial($("reader"), {
      kind: state.view,
      items,
      selected: state.selected,
      query: state.query,
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
    "|snapshot|" +
    (item ? item.id + "|" + item.modifiedAt : "empty");
  if (state.viewKey === key) return;
  state.viewKey = key;
  state.previewController?.abort();
  state.previewController = new AbortController();
  const signal = state.previewController.signal;
  for (const id of ["move", "tag-button", "info", "delete"])
    $(id).disabled = !item;
  if (!item) {
    releasePreview();
    $("reader").innerHTML =
      '<section class="empty-reader"><div class="glass-emblem">◈</div><p class="eyebrow">YOUR PERSONAL CORNER OF THE WEB</p><h1>让好内容，留下来。</h1><p>一篇文章，一段对话，一瞬灵感。<br>从浏览器收藏，在这里慢慢读。</p><div class="empty-features"><span>◉ 本地保存</span><span>▣ 原站外观</span><span>⟳ 跨设备同步</span></div><button id="connect-start" class="primary">连接浏览器插件 <span>↗</span></button></section>';
    $("connect-start").onclick = guarded(showSettings);
    return;
  }
  $("move").disabled = state.view !== "web";
  const saved = item.resources.filter((r) => r.status === "saved");
  const failed = item.resources.length - saved.length;
  $("reader").innerHTML =
    `<section class="reader-heading"><div class="eyebrow">${escape(platformLabel[item.platform] || "网页")} <span>／</span> ${new Date(item.capturedAt).toLocaleString("zh-CN", { hour12: false })}</div><h1>${escape(item.title)}</h1><div class="reader-meta"><span class="archive-pill">● 离线快照</span><span>${saved.length} 个资源 · ${fmt(saved.reduce((n, r) => n + r.bytes, 0))}</span>${failed ? `<button id="resource-warning" class="text-button">${failed} 个资源未保存</button>` : ""}<button id="source-link" class="source-link">${escape(domain(item))} ↗</button></div><div class="reader-tags">${item.tags.map((t) => `<span># ${escape(t)}</span>`).join("")}</div></section><div class="preview-frame"><div class="preview-chrome"><span>◉</span><span>${escape(item.url)}</span><span>原站快照</span></div><div id="preview-loading">正在还原页面…</div><iframe id="snapshot" title="收藏网页的离线快照" sandbox="" referrerpolicy="no-referrer" hidden></iframe></div>`;
  $("source-link").onclick = () => showSourceLink(item.url);
  if ($("resource-warning")) $("resource-warning").onclick = guarded(showInfo);
  try {
    const url = await preview(item, signal);
    if (signal.aborted) return;
    const frame = $("snapshot");
    if (!frame) return;
    frame.src = url;
    frame.hidden = false;
    $("preview-loading").remove();
  } catch (error) {
    if (error.name !== "AbortError" && $("preview-loading"))
      $("preview-loading").textContent = "预览失败：" + error.message;
  }
}
function render() {
  renderPlatforms();
  renderFolders();
  renderReader();
}
async function refresh() {
  const generation = ++state.generation;
  const [items, folders, allItems] = await Promise.all([
    json("/api/items?q=" + encodeURIComponent(state.query)),
    json("/api/folders"),
    state.query ? json("/api/items") : Promise.resolve(null),
  ]);
  if (generation !== state.generation) return;
  state.items = items;
  state.allItems = allItems || items;
  state.folders = folders;
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
    state.rawSnapshot = false;
    renderReader();
    return;
  }
  if (action === "back") {
    state.selected = null;
    state.rawSnapshot = false;
    state.viewKey = "";
    render();
    return;
  }
  if (action === "snapshot" && item) {
    state.selected = item.id;
    state.rawSnapshot = true;
    state.viewKey = "";
    render();
    return;
  }
  if (action === "info" && item) {
    state.editing = item.id;
    await showInfo();
    return;
  }
  if (action === "tags" && item) {
    state.editing = item.id;
    editTags();
    return;
  }
  if (action === "copy" && item) {
    await navigator.clipboard.writeText(item.url);
    toast("来源链接已复制");
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
$("snapshot-back").onclick = () => {
  state.rawSnapshot = false;
  state.viewKey = "";
  render();
};
function modal(title, body, actions = []) {
  $("dialog-title").textContent = title;
  $("dialog-body").innerHTML = body;
  $("dialog-actions").innerHTML = "";
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
    '<option value="">所有收藏（未归类）</option>' +
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
    "新建文件夹",
    `<label>名称<input id="folder-name" placeholder="例如：设计灵感" maxlength="100" required></label><label>父文件夹<select id="folder-parent">${folderOptions(state.folder)}</select></label>`,
    [
      {
        label: "创建文件夹",
        primary: true,
        run: async () => {
          const name = $("folder-name").value.trim();
          if (!name) throw new Error("请输入文件夹名称");
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
    "编辑文件夹",
    `<label>名称<input id="folder-name" value="${escape(folder.name)}" maxlength="100"></label><label>父文件夹<select id="folder-parent">${folderOptions(folder.parentId)}</select></label>`,
    [
      {
        label: "保存",
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
    "原始网页",
    `<p class="subtle">复制下面的地址，在浏览器中打开原站。</p><input id="original-url" readonly value="${escape(url)}">`,
    [
      {
        label: "复制网址",
        primary: true,
        run: async () => {
          await navigator.clipboard.writeText(url);
          toast("网址已复制");
        },
      },
    ],
  );
}
function editTags() {
  const item = selected();
  if (!item) return;
  modal(
    "编辑标签",
    `<label>用逗号分隔多个标签<input id="tag-input" value="${escape(item.tags.join(", "))}" placeholder="设计, 稍后阅读"></label>`,
    [
      {
        label: "保存标签",
        primary: true,
        run: async () => {
          const tags = [
            ...new Set(
              $("tag-input")
                .value.split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          ];
          await mutate("/api/items/" + item.id, { tags }, "PUT");
          $("dialog").close();
          await refresh();
        },
      },
    ],
  );
}
function moveItem() {
  const item = selected();
  if (!item) return;
  modal(
    "移动收藏",
    `<label>目标文件夹<select id="move-folder">${folderOptions(item.folderId)}</select></label>`,
    [
      {
        label: "移动",
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
    "归档详情",
    `<div class="detail-grid"><span>来源</span><span>${escape(item.url)}</span><span>保存范围</span><span>${escape(item.mode)} · ${item.posts?.length || 0} 个帖子/评论</span><span>归档时间</span><span>${escape(item.capturedAt)}</span></div><h3>保存记录</h3><ul class="report-list">${[...(item.warnings || []), ...item.resources.filter((r) => r.warning).map((r) => r.warning), ...failures.map((r) => r.url + " — " + r.error)].map((w) => `<li>${escape(w)}</li>`).join("") || "<li>本次请求的资源均已保存</li>"}</ul><p class="subtle">原始脚本归档保存；离线预览禁用脚本和网络请求。</p>`,
    [
      { label: "导出 HTML 源码", run: () => download(item, "source.html") },
      { label: "导出资源清单", run: () => download(item, "manifest.json") },
    ],
  );
}
async function showSettings() {
  state.settingsOpen = true;
  const [settings, pairing, devices, status] = await Promise.all([
    json("/api/settings"),
    mutate("/api/pairing", {}),
    json("/api/devices"),
    json("/api/status"),
  ]);
  modal(
    "连接与同步",
    `<section class="pairing-card"><div><h3>连接浏览器插件</h3><p>在插件中输入配对码，有效期 5 分钟</p></div><strong id="pairing-code">${escape(pairing.code)}</strong></section><div class="devices">${devices.map((d) => `<div>${escape(d.name)}<button type="button" class="text-button revoke" data-token="${d.token}">撤销配对</button></div>`).join("") || '<p class="subtle">尚无已配对的浏览器</p>'}</div><hr><h3>WebDAV</h3><p class="subtle">启动、内容变更后和每分钟自动同步。远端文件可直接读取。</p><label class="toggle-row"><span>启用自动同步</span><input id="dav-enabled" type="checkbox" ${settings.enabled ? "checked" : ""}></label><label>服务器目录地址<input id="dav-url" type="url" placeholder="https://dav.example.com/archive/" value="${escape(settings.url)}"></label><div class="form-columns"><label>用户名<input id="dav-username" value="${escape(settings.username)}" autocomplete="username"></label><label>密码或应用密码<input id="dav-password" type="password" autocomplete="new-password" placeholder="${settings.hasPassword ? "已保存，留空保留" : "输入密码"}"></label></div><p id="sync-feedback" class="subtle">${escape(status.sync?.error || "")}</p>`,
    [
      {
        label: "立即同步",
        run: async () => {
          const result = await mutate("/api/sync", {});
          $("sync-feedback").textContent = result.error || "同步完成";
        },
      },
      {
        label: "保存设置",
        primary: true,
        run: async () => {
          await mutate(
            "/api/settings",
            {
              enabled: $("dav-enabled").checked,
              url: $("dav-url").value.trim(),
              username: $("dav-username").value,
              password: $("dav-password").value,
            },
            "PUT",
          );
          toast("设置已保存");
          $("dialog").close();
        },
      },
    ],
  );
  for (const button of document.querySelectorAll(".revoke"))
    button.onclick = guarded(async () => {
      await json("/api/devices/" + button.dataset.token, { method: "DELETE" });
      button.closest("div").remove();
      toast("已撤销配对");
    });
}
$("settings").onclick = guarded(showSettings);
$("new-folder").onclick = guarded(createFolder);
$("tag-button").onclick = guarded(editTags);
$("move").onclick = guarded(moveItem);
$("info").onclick = guarded(showInfo);
$("delete").onclick = guarded(async () => {
  const item = selected();
  if (!item) return;
  modal(
    "删除这份收藏？",
    `<p>「${escape(item.title)}」将从资料库移除。删除记录会同步到其他设备。</p>`,
    [
      {
        label: "删除收藏",
        run: async () => {
          await json("/api/items/" + item.id, { method: "DELETE" });
          state.selected = null;
          state.viewKey = "";
          $("dialog").close();
          await refresh();
        },
      },
    ],
  );
});
$("sync-button").onclick = guarded(async () => {
  toast("正在同步…");
  const result = await mutate("/api/sync", {});
  toast(result.error || "同步完成");
  await refresh();
});
let timer;
$("search").oninput = () => {
  clearTimeout(timer);
  state.query = $("search").value;
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
let busy = false;
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const status = await json("/api/status");
    $("connection-dot").classList.add("online");
    $("connection-status").textContent = status.sync?.error
      ? "同步失败，点击设置查看"
      : status.running
        ? "正在同步…"
        : "本地服务已连接";
    if (!$("dialog").open) await refresh();
  } catch {
    $("connection-dot").classList.remove("online");
    $("connection-status").textContent = "本地服务未连接";
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
    $("connection-status").textContent = "连接失败";
    $("reader").innerHTML =
      '<section class="empty-reader"><h1>暂时无法连接</h1><p>' +
      escape(error.message) +
      "</p></section>";
  }
})();

if (globalThis.__TAURI__) {
  const win = globalThis.__TAURI__.window.getCurrentWindow();
  $("window-close").onclick = () => win.close();
  $("window-minimize").onclick = () => win.minimize();
  $("window-maximize").onclick = () => win.toggleMaximize();
}

if (globalThis.__TAURI__ && /Mac|Windows/.test(navigator.userAgent))
  document.body.classList.add("native-glass");

$("dialog").addEventListener("close", () => {
  state.editing = null;
});
