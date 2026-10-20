import { t as tr } from "../i18n.js";

/** A post's archived gallery owns its viewer, including the original video player. */
export function attachMediaViewer(root) {
  let viewer,
    restoredVideo,
    tiles = [],
    index = 0,
    trigger;
  const restoreVideo = () => {
    if (!restoredVideo) return;
    const { video, placeholder, controls } = restoredVideo;
    video.pause();
    video.controls = controls;
    placeholder.replaceWith(video);
    restoredVideo = null;
  };
  const close = (restoreFocus = true) => {
    if (!viewer) return;
    restoreVideo();
    viewer.remove();
    viewer = null;
    document.removeEventListener("keydown", viewerKeys, true);
    if (restoreFocus && trigger?.isConnected)
      trigger.focus({ preventScroll: true });
  };
  const show = () => {
    restoreVideo();
    const stage = viewer.querySelector(".archive-viewer-stage");
    stage.replaceChildren();
    const original = tiles[index].querySelector("video, img");
    if (original?.tagName === "VIDEO") {
      const placeholder = document.createElement("span");
      placeholder.hidden = true;
      original.replaceWith(placeholder);
      restoredVideo = {
        video: original,
        placeholder,
        controls: original.controls,
      };
      original.controls = true;
      stage.append(original);
      original.play().catch(() => {});
    } else if (original) {
      const img = document.createElement("img");
      img.src = original.currentSrc || original.src;
      img.alt = original.alt;
      stage.append(img);
    }
    viewer.querySelector(".archive-viewer-counter").textContent =
      `${index + 1} / ${tiles.length}`;
    viewer
      .querySelectorAll("[data-viewer-step]")
      .forEach((button) => (button.hidden = tiles.length < 2));
  };
  const move = (offset) => {
    index = (index + offset + tiles.length) % tiles.length;
    show();
  };
  function viewerKeys(event) {
    if (!viewer) return;
    if (["Escape", "ArrowRight", "ArrowLeft"].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") close();
      else move(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === "Tab") {
      const buttons = [
        ...viewer.querySelectorAll("button:not([hidden]),video"),
      ];
      const first = buttons[0],
        last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      event.stopPropagation();
    }
  }
  const open = (tile) => {
    const gallery = tile.closest(".social-media-grid");
    if (!gallery) return false;
    close(false);
    tiles = [...gallery.querySelectorAll(".social-media")].filter(
      (el) =>
        !el.classList.contains("media-unavailable") &&
        el.querySelector("img[src],video[src]"),
    );
    index = tiles.indexOf(tile);
    if (index < 0) return false;
    trigger = tile;
    viewer = document.createElement("div");
    viewer.className = "archive-media-viewer";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    viewer.setAttribute("aria-label", tr("查看已保存的媒体"));
    viewer.innerHTML = `<button class="archive-viewer-close" aria-label="${tr("关闭")}">×</button><button class="archive-viewer-prev" data-viewer-step="-1" aria-label="${tr("上一张")}">‹</button><div class="archive-viewer-stage"></div><button class="archive-viewer-next" data-viewer-step="1" aria-label="${tr("下一张")}">›</button><div class="archive-viewer-counter"></div>`;
    document.body.append(viewer);
    viewer.querySelector(".archive-viewer-close").onclick = () => close();
    viewer
      .querySelectorAll("[data-viewer-step]")
      .forEach(
        (button) =>
          (button.onclick = () => move(Number(button.dataset.viewerStep))),
      );
    viewer.onclick = (event) => {
      if (event.target === viewer) close();
    };
    document.addEventListener("keydown", viewerKeys, true);
    show();
    viewer.querySelector(".archive-viewer-close").focus();
    return true;
  };
  const click = (event) => {
    const tile = event.target.closest(".social-media-grid .social-media");
    if (!tile) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(tile);
  };
  const key = (event) => {
    if (
      ["Enter", " "].includes(event.key) &&
      event.target.matches(".social-media[tabindex]")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      open(event.target);
    }
  };
  root.addEventListener("click", click, true);
  root.addEventListener("keydown", key, true);
  return {
    open,
    destroy() {
      close(false);
      root.removeEventListener("click", click, true);
      root.removeEventListener("keydown", key, true);
    },
  };
}
