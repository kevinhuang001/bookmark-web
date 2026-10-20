import { icon } from "./icons.js";

// The form value stays on the select; the menu lives above clipping cards.
export function enhanceSelects(root) {
  for (const select of root.querySelectorAll("select:not([data-enhanced])")) {
    select.dataset.enhanced = "true";
    const wrapper = document.createElement("div");
    wrapper.className = "app-select";
    select.before(wrapper);
    wrapper.append(select);
    select.hidden = true;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "app-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.title = select.getAttribute("aria-label") || "";
    const menu = document.createElement("div");
    menu.className = "app-select-menu";
    menu.role = "listbox";
    menu.hidden = true;
    let open = false;
    function close() {
      if (!open) return;
      open = false;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (wrapper.isConnected) wrapper.append(menu);
      else menu.remove();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    }
    function outside(event) {
      if (!wrapper.contains(event.target) && !menu.contains(event.target))
        close();
    }
    function scroll(event) {
      if (!menu.contains(event.target)) close();
    }
    const update = () => {
      trigger.replaceChildren(
        document.createTextNode(select.selectedOptions[0]?.textContent || ""),
      );
      trigger.insertAdjacentHTML("beforeend", icon("chevron"));
      for (const option of menu.children)
        option.setAttribute(
          "aria-selected",
          String(option.dataset.value === select.value),
        );
    };
    function show(focus = true) {
      open = true;
      (select.closest("dialog") || document.body).append(menu);
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      const rect = trigger.getBoundingClientRect();
      const host = menu.parentElement;
      const bounds =
        host.tagName === "DIALOG"
          ? host.getBoundingClientRect()
          : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      const width = Math.min(
        Math.max(rect.width, 180),
        bounds.right - bounds.left - 24,
      );
      const below = Math.min(innerHeight, bounds.bottom) - rect.bottom - 12;
      const above = rect.top - Math.max(0, bounds.top) - 12;
      const upwards = below < 180 && above > below;
      menu.style.width = width + "px";
      menu.style.maxHeight =
        Math.max(60, Math.min(260, upwards ? above : below)) + "px";
      const left = Math.max(
        bounds.left + 12,
        Math.min(rect.left, bounds.right - width - 12),
      );
      const top = upwards
        ? rect.top - menu.getBoundingClientRect().height - 6
        : rect.bottom + 6;
      menu.style.left =
        left - bounds.left - host.clientLeft + host.scrollLeft + "px";
      menu.style.top =
        top - bounds.top - host.clientTop + host.scrollTop + "px";
      if (focus)
        (
          menu.querySelector('[aria-selected="true"]') || menu.firstChild
        )?.focus({ preventScroll: true });
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("scroll", scroll, true);
      window.addEventListener("resize", close);
    }
    for (const option of select.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "option";
      button.dataset.value = option.value;
      button.textContent = option.textContent;
      button.disabled = option.disabled;
      button.onclick = (event) => {
        event.preventDefault();
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        update();
        close();
        trigger.focus({ preventScroll: true });
      };
      menu.append(button);
    }
    trigger.onclick = (event) => {
      event.preventDefault();
      if (open) close();
      else show();
    };
    const keys = (event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        event.stopPropagation();
        close();
        trigger.focus({ preventScroll: true });
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!open) show(false);
        const choices = [...menu.children].filter((b) => !b.disabled);
        const index = choices.indexOf(document.activeElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? choices.length - 1
              : index < 0
                ? event.key === "ArrowUp"
                  ? choices.length - 1
                  : 0
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    choices.length) %
                  choices.length;
        choices[next]?.focus();
      }
    };
    wrapper.onkeydown = menu.onkeydown = keys;
    const blur = (event) => {
      if (
        !wrapper.contains(event.relatedTarget) &&
        !menu.contains(event.relatedTarget)
      )
        close();
    };
    wrapper.addEventListener("focusout", blur);
    menu.addEventListener("focusout", blur);
    select.addEventListener("change", update);
    wrapper.append(trigger, menu);
    select.closest("dialog")?.addEventListener("close", close, { once: true });
    update();
    trigger.setAttribute("aria-expanded", "false");
  }
}
