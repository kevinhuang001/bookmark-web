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
    dir: "artifacts/demo-v3-raw",
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
  await page.locator('[data-view="x"]').click();
  await page.locator(".x-post").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await writeFile(
    "artifacts/demo-trim-start.txt",
    String((Date.now() - recordingEpoch) / 1000),
  );
  await pause(2600);
  await page
    .locator("#reader")
    .evaluate((el) => el.scrollTo({ top: 450, behavior: "smooth" }));
  await pause(2200);
  const rootPost = page
    .locator(".x-post")
    .filter({ has: page.getByText("Lin", { exact: true }) })
    .first();
  await rootPost.scrollIntoViewIfNeeded();
  await pause(800);
  await rootPost.locator(".x-post-text").click();
  await page.locator(".x-reply").first().waitFor();
  await pause(2400);
  await page.getByRole("button", { name: "返回信息流", exact: true }).click();
  await pause(700);
  await page.locator('[data-view="reddit"]').click();
  await page.locator(".reddit-post").first().waitFor();
  await pause(2600);
  await page
    .locator("#reader")
    .evaluate((el) => el.scrollTo({ top: 360, behavior: "smooth" }));
  await pause(1600);
  await page
    .locator(".reddit-post")
    .filter({
      has: page.getByRole("heading", {
        name: "What makes a personal archive actually useful?",
        exact: true,
      }),
    })
    .locator("h1")
    .click();
  await page.locator(".reddit-comment").first().waitFor();
  await pause(2800);
  await page.getByRole("button", { name: "返回信息流", exact: true }).click();
  const community = await page
    .locator(".saved-community option")
    .nth(1)
    .getAttribute("value");
  await page.locator(".saved-community").selectOption(community);
  await pause(1600);
  await page.locator('[data-view="web"]').click();
  await page.locator("#snapshot").waitFor({ state: "visible" });
  await pause(2400);
  const parent = page.locator("[data-folder]").filter({ hasText: "灵感花园" });
  await parent.click();
  const collapse = page.locator("[data-collapse]").first();
  await collapse.click();
  await pause(800);
  await collapse.click();
  await pause(1000);
  await page.locator("[data-folder]").filter({ hasText: "网页设计" }).click();
  await page.locator(".tree-file").first().click();
  await pause(1800);
  await page.locator("#search").pressSequentially("生活", { delay: 180 });
  await pause(1800);
  await page.locator("#search").fill("");
  await pause(700);
  await page.locator('[data-view="x"]').click();
  await page.locator("#reader").evaluate((el) => (el.scrollTop = 0));
  await pause(2000);
  await page.screenshot({ path: "artifacts/glassmark-v3-x.png" });
  await page.locator('[data-view="reddit"]').click();
  await pause(1200);
  await page.screenshot({ path: "artifacts/glassmark-v3-reddit.png" });
  await page.locator('[data-view="web"]').click();
  await pause(1200);
  await page.screenshot({ path: "artifacts/glassmark-v3-web.png" });
} finally {
  const video = page.video();
  await context.close();
  await writeFile("artifacts/demo-video-path.txt", await video.path());
  await browser.close();
  await new Promise((r) => server.close(r));
  await new Promise((r) => bridge.server.close(r));
}
