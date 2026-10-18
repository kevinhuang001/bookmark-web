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
      path: route.request().url().includes("/question/125")
        ? "tests/fixtures/zhihu-inline.html"
        : route.request().url().includes("/question/124")
          ? "tests/fixtures/zhihu-comments.html"
          : "tests/fixtures/zhihu-question.html",
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
    body: JSON.stringify({
      ...preferences,
      language: "zh-CN",
      maxPosts: 1,
      autoLoadSeconds: 8,
    }),
  });
  const list = async () =>
    (await fetch(bridge.connection.base + "/api/items", { headers })).json();
  for (const [url, navigate] of [
    ["https://www.zhihu.com/question/123", false],
    [
      "https://www.zhihu.com/question/123/answer/222?utm_source=test#comments",
      false,
    ],
    ["https://www.zhihu.com/question/124", false],
    ["https://www.zhihu.com/question/125", false],
    ["https://www.zhihu.com/question/125?preview=1", false],
    ["https://www.zhihu.com/question/125?opened=1", false],
    ["https://www.zhihu.com/question/125?staged=1", false],
    ["https://www.zhihu.com/question/125?unrelated=1", false],
    ["https://www.zhihu.com/question/125?unstable=1", false],
    ["https://www.zhihu.com/question/125?adsonly=1", false],
    [
      "https://www.zhihu.com/question/125?skeleton=1&delay=1200&pageDelay=800",
      false,
    ],
    [
      "https://www.zhihu.com/question/125?opened=1&skeleton=1&delay=1200",
      false,
    ],
    ["https://www.zhihu.com/question/125?staleempty=1&delay=1200", false],
    ["https://www.zhihu.com/question/125?skeleton=1&blocked=1", false],
    ["https://www.zhihu.com/question/125?preview=1&blocked=1", false],
    ["https://www.zhihu.com/question/124?blocked=1", false],
    ["https://www.zhihu.com/question/124?empty=1&delay=50", false],
    ["https://www.zhihu.com/question/123", true],
  ]) {
    await source.goto(url);
    await source.evaluate(() => {
      globalThis.__glassmarkLanguage = "zh-CN";
      globalThis.__glassmarkPickerMode = "zhihu-answer";
      globalThis.__glassmarkZhihuOpenSeconds = 8;
      globalThis.__pickerReady = false;
      globalThis.chrome = {
        runtime: {
          sendMessage: async () => {
            globalThis.__pickerAtReady = {
              loaded: document.body.dataset.commentsLoaded,
              clicks: document.body.dataset.commentClicks,
              panels: globalThis.__glassmarkZhihuAnswer.comments?.panels.length,
              controlsReady: document.body.dataset.controlsReady,
              sinceFirstBody:
                performance.now() - Number(document.body.dataset.firstBodyAt),
            };
            globalThis.__pickerReady = true;
          },
        },
      };
    });
    await source.addScriptTag({ content: pickerScript });
    await source
      .locator(".AnswerItem")
      .nth(url.includes("/question/125") ? 0 : 1)
      .locator(".RichContent-inner")
      .click();
    await source
      .getByRole("button", { name: "保存回答与评论", exact: true })
      .click();
    if (/blocked=1|unstable=1/.test(url)) {
      await source.waitForFunction(() =>
        document
          .querySelector("[data-glassmark-ui] [role=status]")
          ?.textContent.match(/评论未能加载|仍在加载/),
      );
      assert.equal(
        await source.evaluate(() => globalThis.__pickerReady),
        false,
        "a failed automatic opening must not start capture",
      );
      assert.equal(
        await source.locator("body").getAttribute("data-comment-clicks"),
        "1",
      );
      console.log(
        "PASS failed automatic comment opening stays on source page without starting capture",
      );
      continue;
    }
    await source.waitForFunction(() => globalThis.__pickerReady === true);
    if (url.includes("staged=1")) {
      const ready = await source.evaluate(() => globalThis.__pickerAtReady);
      assert.equal(
        ready.controlsReady,
        "1",
        "late comment controls must render before capture starts",
      );
      assert.ok(
        ready.sinceFirstBody >= 3900,
        "wait at least three seconds after a body and 1.5 seconds after the last control change",
      );
    }
    if (/skeleton=1|staleempty=1/.test(url)) {
      assert.equal(
        await source.evaluate(() => globalThis.__pickerAtReady.loaded),
        "1",
        "capture must wait for the actual comment bodies, not an expanded button or empty skeletons",
      );
    }

    if (
      url.includes("/question/124") ||
      (url.includes("/question/125") && !url.includes("opened=1"))
    ) {
      const ready = await source.evaluate(() => globalThis.__pickerAtReady);
      assert.equal(
        ready.clicks,
        "1",
        "the comment click must happen BEFORE selection-ready starts capture",
      );
      assert.ok(
        ready.panels > 1,
        "the opened panel must be handed to the collector",
      );
    }

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
        const capture = await source.evaluate(async (options) => {
          try {
            return await globalThis.GlassmarkCapture.collect(options);
          } catch (error) {
            return { captureError: error.message };
          }
        }, value.args[0]);
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
    const modern = url.includes("/question/124");
    if (modern) {
      assert.equal(
        await source.locator("body").getAttribute("data-comment-clicks"),
        "1",
      );
      assert.equal(
        await source.locator("body").getAttribute("data-hidden-clicks"),
        null,
      );
      assert.equal(
        await source.locator("body").getAttribute("data-wrong-clicks"),
        null,
      );
    }
    if (url.includes("adsonly=1")) {
      assert.equal(title, "收藏未完成");
      assert.match(detail, /评论未能加载/);
      assert.equal(items.length, before);
      console.log(
        "PASS inaccessible comments do not silently save an answer-only success",
      );
    } else if (navigate) {
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
      assert.equal(
        saved.url,
        url.includes("/question/125")
          ? "https://www.zhihu.com/question/125/answer/222"
          : modern
            ? "https://www.zhihu.com/question/124/answer/222"
            : "https://www.zhihu.com/question/123/answer/222",
      );
      assert.equal(saved.posts[0].id, "222");
      assert.deepEqual(
        saved.posts.map((post) => post.id),
        url.includes("/question/125")
          ? ["222", "c1", "c2", "reply1", "reply2", "reply3", "c3"]
          : url.includes("empty=1")
            ? ["222"]
            : ["222", "c1", "reply1", "c2", "c3"],
      );
      if (url.includes("/question/125")) {
        assert.equal(
          await source.locator("body").getAttribute("data-comment-clicks"),
          url.includes("opened=1") ? null : "1",
          "the plugin must open the selected answer comments without a manual click",
        );
        assert.equal(
          await source.locator("body").getAttribute("data-all-comment-clicks"),
          "1",
        );
        assert.equal(
          await source.locator("body").getAttribute("data-reply-clicks"),
          "1",
        );
        const first = saved.posts.find((post) => post.id === "c1");
        assert.equal(first.authorName, "读者1");
        assert.match(first.avatarUrl, /avatar\.svg/);
        assert.equal(first.stats.likes, "7");
        assert.equal(first.media.length, 1);
        assert.equal(
          new Set(saved.posts.map((post) => post.id)).size,
          saved.posts.length,
        );
      }
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
