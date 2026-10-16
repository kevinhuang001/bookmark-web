import { hydrateIcons } from "../../../app/icons.js";
hydrateIcons();
import { api, request } from "../api.js";
import { archiveResources, rewrite } from "../archive.js";
const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tab"));
const mode = params.get("mode");
const $ = (id) => document.getElementById(id);
let maximum = 100;
let controller;
$("cancel").onclick = () => {
  controller?.abort();
  $("title").textContent = "已取消";
};
$("more").onclick = () => {
  maximum += 100;
  run();
};
function approve() {
  return new Promise((resolve) => {
    $("limit").hidden = false;
    $("approve").onclick = () => {
      $("limit").hidden = true;
      resolve(true);
    };
    $("skip").onclick = () => {
      $("limit").hidden = true;
      resolve(false);
    };
    controller.signal.addEventListener(
      "abort",
      () => {
        $("limit").hidden = true;
        resolve(false);
      },
      { once: true },
    );
  });
}
async function run() {
  controller = new AbortController();
  $("more").hidden = true;
  $("cancel").hidden = false;
  $("report").hidden = true;
  try {
    await request("/api/status");
    $("title").textContent = "正在收集网页";
    $("detail").textContent =
      mode === "thread"
        ? "正在加载讨论，请勿关闭来源标签页…"
        : "正在保存元素、样式与页面状态…";
    await api.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    const results = await api.scripting.executeScript({
      target: { tabId },
      func: async (options) => globalThis.GlassmarkCapture.collect(options),
      args: [{ mode, maxPosts: maximum }],
    });
    const capture = results[0]?.result;
    if (!capture) throw new Error("页面捕获未返回内容");
    if (controller.signal.aborted) throw new Error("已取消收藏");
    $("title").textContent = "正在归档网页资源";
    $("detail").textContent = capture.title;
    const resources = await archiveResources(capture.resources, {
      signal: controller.signal,
      approve,
      progress: ({ done, total, bytes }) => {
        $("progress").max = total;
        $("progress").value = done;
        $("stats").textContent =
          `${done} / ${total} 个资源 · ${(bytes / 1024 / 1024).toFixed(1)} MB`;
      },
      upload: async (name, bytes, mime) => {
        await request("/api/blobs/" + name, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: bytes,
          signal: controller.signal,
        });
      },
    });
    const snapshot = rewrite(capture.snapshot, resources);
    const payload = { ...capture, snapshot, resources };
    const response = await request("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const item = await response.json();
    $("title").textContent = "已收藏，留待慢慢读";
    $("detail").textContent = item.title;
    $("progress").value = $("progress").max;
    $("cancel").hidden = true;
    const failed = resources.filter((r) => r.status !== "saved");
    $("warnings").textContent =
      [
        ...capture.warnings,
        ...resources.filter((r) => r.warning).map((r) => r.warning),
        ...failed.map((r) => r.url + " — " + r.error),
      ].join("\n") || "本次请求的资源均已保存。";
    $("report").hidden = false;
    $("more").hidden = !(capture.platform === "x" && mode === "thread");
  } catch (error) {
    $("title").textContent = controller.signal.aborted
      ? "已取消收藏"
      : "收藏未完成";
    $("detail").textContent = error.message;
    $("progress").removeAttribute("value");
    $("cancel").hidden = true;
  }
}
run();
