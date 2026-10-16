import { hydrateIcons } from "../../../app/icons.js";
hydrateIcons();
import { api, BASE, request, connected } from "../api.js";
const $ = (id) => document.getElementById(id);
async function init() {
  const live = await connected();
  $("status").textContent = live
    ? "客户端已连接"
    : "客户端未连接，收藏操作已停用";
  $("actions").hidden = !live;
  try {
    const response = await fetch(BASE + "/health", {
      signal: AbortSignal.timeout(1500),
    });
    $("pair").hidden = !response.ok || live;
  } catch {
    $("pair").hidden = true;
  }
}
$("pairButton").onclick = async () => {
  try {
    const response = await fetch(BASE + "/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: $("code").value,
        name: navigator.userAgent.includes("Firefox") ? "Firefox" : "Chromium",
      }),
    });
    if (!response.ok)
      throw new Error("配对失败，请检查配对码或在客户端重新生成");
    const connection = await response.json();
    await api.storage.local.set({ connection });
    await init();
  } catch (e) {
    $("status").textContent = e.message;
  }
};
$("disconnect").onclick = async () => {
  await api.storage.local.remove("connection");
  await init();
};
for (const button of document.querySelectorAll("[data-mode]"))
  button.onclick = async () => {
    try {
      await request("/api/status");
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!/^https?:/.test(tab.url))
        throw new Error("仅支持普通 HTTP/HTTPS 网页");
      if (button.dataset.mode === "selection")
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
            button.dataset.mode,
        });
      window.close();
    } catch (e) {
      $("status").textContent = e.message;
    }
  };
init();
