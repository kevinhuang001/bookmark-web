import {
  t as tr,
  setLanguage,
  translateDOM,
  localizeError,
} from "../../../app/i18n.js";
import { hydrateIcons } from "../../../app/icons.js";
hydrateIcons();
translateDOM();
import { api, request } from "../api.js";
import { archiveResources, rewrite } from "../archive.js";
const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tab"));
const mode = params.get("mode");
const $ = (id) => document.getElementById(id);
let maximum;
let preferences = {};
let controller;
let running = false;
let progressTab;
api.runtime.onMessage.addListener((message) => {
  if (message.type === "capture-progress" && running) {
    $("stats").textContent =
      `${tr("已识别 {0} 条帖子 / 评论，正在按设置加载回复", { 0: message.count })}`;
  }
});
$("retry").onclick = run;
$("cancel").onclick = () => {
  controller?.abort();
  api.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        globalThis.__glassmarkCaptureCanceled = true;
      },
    })
    .catch(() => {});
  $("title").textContent = tr("已取消");
};
$("more").onclick = () => {
  maximum += preferences.maxPosts || 100;
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
  if (running) return;
  running = true;
  $("retry").hidden = true;
  controller = new AbortController();
  $("more").hidden = true;
  $("cancel").hidden = false;
  $("report").hidden = true;
  try {
    await request("/api/status");
    preferences =
      (await (await request("/api/capture-options")).json()).preferences || {};
    setLanguage(
      preferences.resolvedLanguage || preferences.language || "system",
    );
    translateDOM();
    maximum ||= preferences.maxPosts || 100;
    $("limit-message").textContent =
      `${tr("此次下载将超过设置的 {0} MB 上限，是否继续？", { 0: preferences.downloadLimitMb || 500 })}`;
    progressTab = await api.tabs.getCurrent();
    const lockKey = "runningCapture_" + tabId;
    const old = (await api.storage.local.get(lockKey))[lockKey];
    if (old && old !== progressTab?.id) {
      const previous = await api.tabs.get(old).catch(() => null);
      if (previous)
        throw new Error(tr("这个页面已有收藏任务，请先完成或取消该任务"));
    }
    await api.storage.local.set({ [lockKey]: progressTab?.id });
    const stored = await api.storage.local.get("pendingCapture_" + tabId);
    const job = stored["pendingCapture_" + tabId];
    const current = await api.tabs.get(tabId);
    if (job?.expectedUrl && current.url !== job.expectedUrl)
      throw new Error(tr("来源标签页已跳转，请重新从目标帖子发起收藏"));
    const destination =
      job && Date.now() - job.createdAt < 30 * 60 * 1000 && job.mode === mode
        ? { folderId: job.folderId, tags: job.tags }
        : {};
    $("title").textContent = tr("正在收集网页");
    $("detail").textContent =
      mode === "thread"
        ? tr("正在加载讨论，请勿关闭来源标签页…")
        : tr("正在保存元素、样式与页面状态…");
    if (mode === "thread") {
      progressTab = await api.tabs.getCurrent();
      await api.tabs.update(tabId, { active: true });
    }
    if (controller.signal.aborted) throw new Error(tr("已取消收藏"));
    await api.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    const results = await api.scripting.executeScript({
      target: { tabId },
      func: async (options) => {
        try {
          return await globalThis.GlassmarkCapture.collect(options);
        } catch (error) {
          return {
            captureError: error.message,
            cancelled: globalThis.__glassmarkCaptureCanceled === true,
          };
        }
      },
      args: [
        {
          ...preferences,
          language:
            preferences.resolvedLanguage || preferences.language || "system",
          mode,
          maxPosts: maximum,
        },
      ],
    });
    if (progressTab)
      await api.tabs.update(progressTab.id, { active: true }).catch(() => {});
    const capture = results[0]?.result;
    if (!capture) throw new Error(tr("页面捕获未返回内容"));
    if (capture.cancelled) controller.abort();
    if (capture.captureError) throw new Error(capture.captureError);
    if (job?.expectedUrl && capture.url !== job.expectedUrl)
      throw new Error(tr("捕获过程中来源页面已跳转，请重新收藏"));
    if (controller.signal.aborted) throw new Error(tr("已取消收藏"));
    $("step-collect").classList.remove("active");
    $("step-media").classList.add("active");
    $("title").textContent = tr("正在归档图片、视频和页面资源");
    $("detail").textContent = capture.title;
    const resources = await archiveResources(capture.resources, {
      signal: controller.signal,
      concurrency: preferences.downloadConcurrency || 6,
      budget: (preferences.downloadLimitMb || 500) * 1024 * 1024,
      resourceLimit: preferences.resourceLimit || 2000,
      imageTimeoutSeconds: preferences.imageTimeoutSeconds || 15,
      videoTimeoutSeconds: preferences.videoTimeoutSeconds || 90,
      approve,
      progress: ({ done, total, bytes }) => {
        $("progress").max = total;
        $("progress").value = done;
        $("stats").textContent =
          `${tr("{0} / {1} 个资源 · {2} MB", { 0: done, 1: total, 2: (bytes / 1024 / 1024).toFixed(1) })}`;
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
    const content = capture.content
      ? rewrite(capture.content, resources)
      : null;
    $("step-media").classList.remove("active");
    $("step-save").classList.add("active");
    const payload = { ...capture, ...destination, content, resources };
    const response = await request("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const item = await response.json();
    $("title").textContent = tr("已收藏，留待慢慢读");
    $("detail").textContent =
      item.title +
      (item.tags?.length ? tr(" · 标签：") + item.tags.join("、") : "");
    $("progress").value = $("progress").max;
    $("cancel").hidden = true;
    const failed = resources.filter((r) => r.status !== "saved");
    $("stats").textContent =
      `${tr("已保存 {0} / {1} 个资源 · {2} 条帖子 / 评论{3}", { 0: resources.length - failed.length, 1: resources.length, 2: capture.posts?.length || 0, 3: failed.length ? tr(" · 部分媒体保存失败，请查看报告") : "" })}`;
    $("report").open = failed.length > 0;
    $("warnings").textContent =
      [
        ...capture.warnings,
        ...resources.filter((r) => r.warning).map((r) => r.warning),
        ...failed.map((r) => r.url + " — " + r.error),
      ].join("\n") || tr("本次请求的资源均已保存。");
    $("report").hidden = false;
    $("more").hidden = !(capture.platform === "x" && mode === "thread");
  } catch (error) {
    if (progressTab)
      await api.tabs.update(progressTab.id, { active: true }).catch(() => {});
    $("title").textContent = controller.signal.aborted
      ? tr("已取消收藏")
      : tr("收藏未完成");
    $("detail").textContent = localizeError(error.message);
    $("progress").removeAttribute("value");
    $("cancel").hidden = true;
    $("retry").hidden = controller.signal.aborted;
  } finally {
    const lockKey = "runningCapture_" + tabId;
    const current = (await api.storage.local.get(lockKey))[lockKey];
    if (current === progressTab?.id) await api.storage.local.remove(lockKey);
    running = false;
  }
}
run();
