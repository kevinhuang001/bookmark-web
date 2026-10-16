import { t as tr, setLanguage } from "../../app/i18n.js";
(() => {
  setLanguage(globalThis.__glassmarkLanguage || "system");
  globalThis.__glassmarkPickerCleanup?.();
  const selected = [];
  let hovered;
  const overlay = document.createElement("div");
  overlay.setAttribute("data-glassmark-ui", "");
  overlay.style.cssText =
    "position:fixed;pointer-events:none;border:2px solid #377bf6;background:#377bf620;z-index:2147483646;box-sizing:border-box;border-radius:5px";
  const toolbar = document.createElement("div");
  toolbar.setAttribute("data-glassmark-ui", "");
  toolbar.style.cssText =
    "position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#20232deF;color:white;padding:12px 16px;border-radius:18px;box-shadow:0 12px 50px #0005;font:14px system-ui;display:flex;gap:10px;align-items:center;backdrop-filter:blur(24px)";
  toolbar.innerHTML = `<span>${tr("点击选择 · ↑ 父级 · ↓ 子级")}</span><b>${tr("0 个区域")}</b><button data-action="done">${tr("收藏选区")}</button><button data-action="cancel">${tr("取消")}</button>`;
  toolbar
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.style.cssText =
          "border:0;border-radius:9px;padding:9px 14px;cursor:pointer;background:#3b82f6;color:white"),
    );
  document.documentElement.append(overlay, toolbar);
  const draw = () => {
    if (!hovered) return;
    const r = hovered.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: r.left + "px",
      top: r.top + "px",
      width: r.width + "px",
      height: r.height + "px",
    });
  };
  const move = (e) => {
    if (e.target.closest("[data-glassmark-ui]")) return;
    hovered = e.target;
    draw();
  };
  const click = (e) => {
    if (e.target.closest("[data-glassmark-ui]")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!hovered) return;
    const index = selected.indexOf(hovered);
    if (index >= 0) selected.splice(index, 1);
    else {
      for (let i = selected.length - 1; i >= 0; i--)
        if (selected[i].contains(hovered) || hovered.contains(selected[i]))
          selected.splice(i, 1);
      selected.push(hovered);
    }
    toolbar.querySelector("b").textContent = selected.length + tr(" 个区域");
  };
  const key = (e) => {
    if (e.key === "Escape") cleanup();
    else if (["ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      hovered =
        e.key === "ArrowUp"
          ? hovered?.parentElement || hovered
          : hovered?.firstElementChild || hovered;
      draw();
    }
  };
  function cleanup() {
    overlay.remove();
    toolbar.remove();
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("keydown", key, true);
    window.removeEventListener("scroll", draw, true);
    delete globalThis.__glassmarkPickerCleanup;
  }
  toolbar.addEventListener("click", (e) => {
    const action = e.target.dataset.action;
    if (action === "cancel") cleanup();
    if (action === "done" && selected.length) {
      globalThis.__glassmarkSelection = selected;
      cleanup();
      (globalThis.browser || chrome).runtime.sendMessage({
        type: "selection-ready",
      });
    }
  });
  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
  window.addEventListener("scroll", draw, true);
  globalThis.__glassmarkPickerCleanup = cleanup;
})();
