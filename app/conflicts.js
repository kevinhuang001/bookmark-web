import { t as tr, locale } from "./i18n.js";
import { escapeHtml as esc } from "./icons.js";
import { json, mutate } from "./api.js";

export async function renderConflicts(
  root,
  { folders = [], onResolved, toast },
) {
  try {
    const conflicts = await json("/api/conflicts");
    if (!root.isConnected) return;
    const folderName = (id) =>
      folders.find((f) => f.id === id)?.name || tr("未分类");
    root.innerHTML = `<div class="conflict-heading"><h3>${tr("同步冲突")}</h3><button type="button" data-conflict-refresh>${tr("刷新")}</button></div>${conflicts.length ? `<p class="settings-note">${tr("并发修改的版本均已保留。选择要使用的版本，处理结果会同步到其他设备。")}</p>` : `<p class="settings-note">${tr("没有待处理的冲突")}</p>`}${conflicts
      .map((c) => {
        const current = c.versions.find((v) => v.current) || c.versions[0];
        const merge =
          c.kind === "item" &&
          c.versions.every(
            (v) =>
              !v.data.deleted &&
              v.data.title === current.data.title &&
              v.data.folderId === current.data.folderId,
          );
        return `<section class="conflict-card"><h4>${esc(current.data.title || current.data.name || tr("收藏"))}</h4><div class="conflict-versions">${c.versions.map((v) => `<article><header><strong>${v.current ? tr("当前显示版本") : tr("其他版本")}</strong><time>${esc(v.data.modifiedAt ? new Date(v.data.modifiedAt).toLocaleString(locale()) : "")}</time></header><dl><dt>${tr("标题")}</dt><dd>${esc(v.data.title || v.data.name || "—")}</dd><dt>${tr("文件夹")}</dt><dd>${esc(folderName(c.kind === "folder" ? v.data.parentId : v.data.folderId))}</dd><dt>${tr("标签")}</dt><dd>${esc((v.data.tags || []).join(" · ") || "—")}</dd><dt>${tr("状态")}</dt><dd>${v.data.deleted ? tr("删除") : tr("保留")}</dd></dl>${v.data.deleted ? `<p class="conflict-deletion">${tr("此版本会删除这条记录。")}</p>` : ""}<button type="button" class="secondary ${v.data.deleted ? "danger" : ""}" data-conflict-id="${esc(c.id)}" data-conflict-choice="${esc(v.revision)}">${v.data.deleted ? tr("确认删除") : tr("使用此版本")}</button></article>`).join("")}</div>${merge ? `<button type="button" class="secondary" data-conflict-id="${esc(c.id)}" data-conflict-choice="${esc(current.revision)}" data-merge-tags>${tr("合并全部标签")}</button>` : ""}</section>`;
      })
      .join("")}`;
    root.querySelector("[data-conflict-refresh]").onclick = () =>
      renderConflicts(root, { folders, onResolved, toast });
    for (const button of root.querySelectorAll("[data-conflict-choice]"))
      button.onclick = async () => {
        for (const control of root.querySelectorAll("button"))
          control.disabled = true;
        try {
          const conflict = conflicts.find(
            (c) => c.id === button.dataset.conflictId,
          );
          await mutate(`/api/conflicts/${conflict.id}/resolve`, {
            heads: conflict.versions.map((v) => v.revision),
            revision: button.dataset.conflictChoice,
            mergeTags: button.hasAttribute("data-merge-tags"),
          });
          await onResolved();
          toast(tr("冲突已处理"));
        } catch (error) {
          toast(error.message);
        }
        await renderConflicts(root, { folders, onResolved, toast });
      };
  } catch (error) {
    if (root.isConnected)
      root.textContent = tr("冲突列表加载失败，请重新打开设置重试");
    toast(error.message);
  }
}
