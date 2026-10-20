import { icon } from "./icons.js";

// Keep the select as the form value; render a keyboard-accessible in-app menu.
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
    const close = () => {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };
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
        trigger.focus();
      };
      menu.append(button);
    }
    trigger.onclick = (event) => {
      event.preventDefault();
      menu.hidden = !menu.hidden;
      trigger.setAttribute("aria-expanded", String(!menu.hidden));
      if (!menu.hidden)
        (
          menu.querySelector('[aria-selected="true"]') || menu.firstChild
        )?.focus();
    };
    wrapper.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        trigger.focus();
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        const choices = [...menu.children].filter((b) => !b.disabled);
        const index = choices.indexOf(document.activeElement);
        choices[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? choices.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  choices.length) %
                choices.length
        ]?.focus();
      }
    };
    wrapper.addEventListener("focusout", (event) => {
      if (!wrapper.contains(event.relatedTarget)) close();
    });
    select.addEventListener("change", update);
    wrapper.append(trigger, menu);
    update();
    close();
  }
}
