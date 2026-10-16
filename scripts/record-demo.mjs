/** Real UI walkthrough of the split platform feeds and translucent sidebar. */
import { mkdir, cp, rm, symlink, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixtureBridge } from "./fixture-bridge.mjs";
import { staticServer } from "./dev.mjs";
import { launchBrowser } from "./browser.mjs";
const root = path.resolve(".test-data/video");
await rm(root, { recursive: true, force: true });
await cp(".test-data/e2e", root, { recursive: true });
const cache = path.join(os.homedir(), ".cache/ms-playwright/ffmpeg-1011");
await mkdir(cache, { recursive: true });
try {
  await symlink("/usr/bin/ffmpeg", cache + "/ffmpeg-linux");
} catch {}
const bridge = await fixtureBridge(root);
const server = await staticServer(bridge.connection);
const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  timezoneId: "Asia/Shanghai",
  recordVideo: {
    dir: "artifacts/demo-v4-raw",
    size: { width: 1600, height: 1000 },
  },
});
const recordingEpoch = Date.now();
const page = await context.newPage();
try {
  await page.goto("http://localhost:1420");
  await page.addStyleTag({ url: "/test-fonts/400.css" });
  await page.addStyleTag({ url: "/test-fonts/700.css" });
  await page.addStyleTag({
    content:
      "body,button,input,select{font-family:'Noto Sans SC',sans-serif!important}",
  });
  const uiText =
    (
      await Promise.all(
        [
          "app/main.js",
          "app/social.js",
          "app/index.html",
          "tests/fixtures/article.html",
        ].map((file) => readFile(file, "utf8")),
      )
    ).join("") +
    bridge.db.items
      .map((item) =>
        [item.title, item.text, ...(item.posts || []).map((p) => p.text)].join(
          "",
        ),
      )
      .join("");
  const characters = [...new Set([...uiText])].join("");
  await page.evaluate(async (text) => {
    await Promise.all([
      document.fonts.load('400 14px "Noto Sans SC"', text),
      document.fonts.load('700 14px "Noto Sans SC"', text),
    ]);
    await document.fonts.ready;
  }, characters);
  await page.evaluate(() => {
    const note = document.createElement("div");
    note.id = "demo-caption";
    note.textContent = "测试收藏 · 开发测试服务 · 非原生运行";
    note.style.cssText =
      'position:fixed;right:25px;bottom:18px;z-index:9999;font:10px "Noto Sans SC",sans-serif;color:#647b8a;background:#fffffff2;padding:7px 12px;border:1px solid #dce4ea;border-radius:8px;pointer-events:none';
    document.body.append(note);
  });
  const pause = async (ms = 1800) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(ms);
  };
  const caption = async (text) =>
    page.evaluate((text) => {
      document.querySelector("#demo-caption").textContent = text;
    }, text);
  await page.locator('button[data-view="x"]').click();
  await page.locator(".x-post").first().waitFor();
  await writeFile(
    "artifacts/demo-trim-start.txt",
    String((Date.now() - recordingEpoch) / 1000),
  );
  await caption(
    "v0.4 · 全局搜索始终可见，站内搜索独立保留 · 测试数据 / 非原生系统效果",
  );
  await pause(1800);
  await page.locator("#search").fill("What makes a personal archive");
  await page.locator(".global-result").first().waitFor();
  await pause(1700);
  await page.locator(".global-result").first().click();
  await page.locator(".reddit-post-detail").waitFor();
  await caption("跨来源打开 Reddit 收藏与已归档评论 · 测试数据");
  await pause(1700);
  await page
    .locator("#reader")
    .evaluate((el) => el.scrollTo({ top: 450, behavior: "smooth" }));
  await pause(1600);
  await page.locator("#search").fill("");
  await pause(400);
  await page.locator('button[data-view="x"]').click();
  await page.locator('[data-social-action="new-tag"]').click();
  await page.locator("#catalog-tag-name").fill("设计灵感");
  await page.getByRole("button", { name: "创建标签", exact: true }).click();
  await caption("X 与 Reddit 各自建立标签，扩展保存时可直接指定 · 测试数据");
  await pause(1400);
  await page.locator('.saved-tags [data-tag="设计灵感"]').click();
  await pause(1000);
  await page.locator('.saved-tags [data-tag=""]').click();
  await page.locator("#window-close").hover();
  await caption(
    "窗口按钮显示悬停符号与提示；顶部留有独立拖动区 · 原生拖动需实机验收",
  );
  await pause(1600);
  await page.locator('button[data-view="web"]').click();
  await page.locator("#snapshot").waitFor({ state: "visible" });
  await caption("网页入口即根文件夹，文件直接位于目录层级中 · 测试数据");
  await pause(1700);
  await page.locator("[data-collapse]").first().click();
  await pause(600);
  await page.locator("[data-collapse]").first().click();
  await pause(700);
  const videoItem = bridge.db.items.find((i) =>
    i.resources?.some((r) => r.mime?.includes("webm")),
  );
  if (videoItem) {
    videoItem.deleted = false;
    videoItem.tags = ["Video lab"];
    await page.waitForTimeout(3300);
    await page.locator('button[data-view="x"]').click();
    await page.locator('.saved-tags [data-tag="Video lab"]').click();
    const video = page.locator("video").first();
    await video.waitFor();
    await video.evaluate((v) => v.play());
    await caption(
      "实际从归档中播放视频；HLS 点播同时保存清单、音轨和分片 · 测试媒体",
    );
    await pause(2400);
    await page.locator('.saved-tags [data-tag=""]').click();
  }
  // The extension UI below uses the actual bundled popup and the test bridge.
  // Browser APIs are supplied by a preview harness; no capture is simulated.
  await page.addInitScript(
    ({ connection, folderId }) => {
      if (!location.pathname.includes("/extension/popup.html")) return;
      const data = {
        connection,
        capturePreferences: { folderId, x: { tags: ["设计灵感"] } },
      };
      globalThis.chrome = {
        storage: {
          local: {
            get: async (key) => ({ [key]: data[key] }),
            set: async (patch) => Object.assign(data, patch),
            remove: async (key) => delete data[key],
          },
        },
        tabs: {
          query: async () => [
            {
              id: 1,
              url: "https://x.com/lin/status/1001",
              title: "Lin 的设计手记 / X",
            },
          ],
        },
      };
    },
    { connection: bridge.connection, folderId: bridge.db.folders[0]?.id },
  );
  await page.evaluate(() => {
    const backdrop = document.createElement("div");
    backdrop.id = "extension-preview";
    backdrop.style.cssText =
      "position:fixed;inset:0;background:#18324565;z-index:5000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)";
    const iframe = document.createElement("iframe");
    iframe.src = "/extension/popup.html";
    iframe.style.cssText =
      "width:368px;height:690px;border:0;border-radius:18px;box-shadow:0 20px 80px #0004;background:#fafbfc";
    backdrop.append(iframe);
    document.body.append(backdrop);
  });
  await page
    .frameLocator("#extension-preview iframe")
    .locator("#save-post")
    .waitFor();
  const popupFrame = page
    .frames()
    .find((f) => f.url().includes("/extension/popup.html"));
  await popupFrame.addStyleTag({ url: "/test-fonts/400.css" });
  await popupFrame.addStyleTag({ url: "/test-fonts/700.css" });
  await popupFrame.addStyleTag({
    content:
      "body,button,input,select{font-family:'Noto Sans SC',sans-serif!important}",
  });
  await popupFrame.evaluate(async () => {
    await document.fonts.load(
      '400 13px "Noto Sans SC"',
      document.body.innerText,
    );
    await document.fonts.load(
      '700 13px "Noto Sans SC"',
      document.body.innerText,
    );
    await document.fonts.ready;
  });
  await caption(
    "扩展界面预览：自动识别当前帖子、标签保存位置、视频说明与连接状态 · 浏览器 API 使用测试替身",
  );
  await pause(2700);
  await page.screenshot({ path: "artifacts/glassmark-v4-extension.png" });
  await page.evaluate(() =>
    document.querySelector("#extension-preview").remove(),
  );
  await page.locator('button[data-view="x"]').click();
  await pause(500);
  await page.screenshot({ path: "artifacts/glassmark-v4-x.png" });
  await caption(
    "Glassmark v0.4 · 新界面与归档交互演示 · 浏览器预览不代表原生玻璃合成效果",
  );
  await pause(1400);
} finally {
  const video = page.video();
  await context.close();
  await writeFile("artifacts/demo-video-path.txt", await video.path());
  await browser.close();
  await new Promise((r) => server.close(r));
  await new Promise((r) => bridge.server.close(r));
}
