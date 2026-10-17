/** Full capture-page regression: a saved answer permalink is not a document redirect. */
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { launchBrowser } from "../scripts/browser.mjs";
import { fixtureBridge } from "../scripts/fixture-bridge.mjs";
import { staticServer } from "../scripts/dev.mjs";
const root = ".test-data/zhihu-flow";
await rm(root, { recursive: true, force: true });
const bridge = await fixtureBridge(root);
const server = await staticServer(bridge.connection);
const browser = await launchBrowser();
try {
  const context = await browser.newContext();
  const source = await context.newPage();
  await source.route("https://www.zhihu.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      path: "tests/fixtures/zhihu-question.html",
    }),
  );
  await source.route("http://127.0.0.1:1420/fixtures/**", (route) =>
    route.continue(),
  );
  const captureScript = await readFile(
    "dist/extension-chromium/content.js",
    "utf8",
  );
  const pickerScript = await readFile(
    "dist/extension-chromium/picker.js",
    "utf8",
  );
  const headers = { Authorization: "Bearer " + bridge.connection.token };
  const preferences = await (
    await fetch(bridge.connection.base + "/api/preferences", { headers })
  ).json();
  await fetch(bridge.connection.base + "/api/preferences", {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ...preferences, language: "zh-CN" }),
  });
  const list = async () =>
    (await fetch(bridge.connection.base + "/api/items", { headers })).json();
  for (const [url, navigate] of [
    ["https://www.zhihu.com/question/123", false],
    [
      "https://www.zhihu.com/question/123/answer/222?utm_source=test#comments",
      false,
    ],
    ["https://www.zhihu.com/question/123", true],
  ]) {
    await source.goto(url);
    await source.evaluate(() => {
      globalThis.__glassmarkLanguage = "zh-CN";
      globalThis.__glassmarkPickerMode = "zhihu-answer";
      globalThis.chrome = { runtime: { sendMessage: async () => {} } };
    });
    await source.addScriptTag({ content: pickerScript });
    await source
      .locator(".AnswerItem")
      .nth(1)
      .locator(".RichContent-inner")
      .click();
    await source
      .getByRole("button", { name: "保存回答与评论", exact: true })
      .click();
    const before = (await list()).length;
    const storage = {
      connection: { token: bridge.connection.token },
      pendingCapture_1: {
        mode: "thread",
        expectedUrl: url,
        tags: [],
        folderId: null,
        createdAt: Date.now(),
      },
    };
    const progress = await context.newPage();
    // Simulate only the WebExtension transport. Run the real collector, capture UI,
    // resource downloader and persistence endpoint without replacing their results.
    await progress.exposeFunction("extensionCall", async (method, value) => {
      if (method === "getTab") return { id: 1, url: source.url() };
      if (method === "getStorage") return { [value]: storage[value] };
      if (method === "setStorage") return Object.assign(storage, value);
      if (method === "removeStorage") {
        delete storage[value];
        return;
      }
      if (method === "script") {
        if (value.files) {
          await source.addScriptTag({ content: captureScript });
          return [];
        }
        const capture = await source.evaluate(
          (options) => globalThis.GlassmarkCapture.collect(options),
          value.args[0],
        );
        if (navigate)
          await source.evaluate(() =>
            history.pushState({}, "", "/question/999"),
          );
        return [{ result: capture }];
      }
    });
    await progress.addInitScript(() => {
      globalThis.browser = {
        runtime: { onMessage: { addListener() {} } },
        tabs: {
          get: () => extensionCall("getTab"),
          getCurrent: async () => ({ id: 2 }),
          update: async (id) => ({ id }),
        },
        storage: {
          local: {
            get: (key) => extensionCall("getStorage", key),
            set: (value) => extensionCall("setStorage", value),
            remove: (key) => extensionCall("removeStorage", key),
          },
        },
        scripting: {
          executeScript: (options) =>
            extensionCall("script", {
              files: options.files,
              args: options.args,
            }),
        },
      };
    });
    await progress.goto(
      "http://127.0.0.1:1420/extension/capture.html?tab=1&mode=thread",
    );
    await progress.waitForFunction(
      () =>
        ["已收藏，留待慢慢读", "收藏未完成"].includes(
          document.getElementById("title")?.textContent,
        ),
      { timeout: 20000 },
    );
    const title = await progress.locator("#title").textContent();
    const detail = await progress.locator("#detail").textContent();
    const items = await list();
    if (navigate) {
      assert.equal(title, "收藏未完成");
      assert.match(detail, /捕获过程中来源页面已跳转/);
      assert.equal(items.length, before);
      console.log(
        "PASS actual document navigation after collection blocks persistence",
      );
    } else {
      assert.equal(title, "已收藏，留待慢慢读", detail);
      assert.equal(items.length, before + 1);
      const saved = items.find((item) => item.sourceUrl === url);
      assert.ok(saved);
      assert.equal(saved.url, "https://www.zhihu.com/question/123/answer/222");
      assert.equal(saved.posts[0].id, "222");
      assert.deepEqual(
        saved.posts.map((post) => post.id),
        ["222", "c1", "reply1", "c2", "c3"],
      );
      assert.ok(
        saved.resources.some((resource) => resource.status === "saved"),
      );
      console.log(
        "PASS selected Zhihu answer reaches capture UI, media archive and persistence from " +
          url,
      );
    }
    await progress.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => bridge.server.close(resolve));
}
