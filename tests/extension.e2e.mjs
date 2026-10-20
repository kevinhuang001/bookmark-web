/** Real installed Chromium MV3 extension against the native Rust bridge (CI).
 * This is separate from the collector/UI tests, which can run on headless_shell.
 */
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { staticServer } from "../scripts/dev.mjs";
const root = path.resolve(".test-data/extension");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await mkdir("artifacts", { recursive: true });
const file = root + "/connection.json";
const child = spawn(path.resolve(process.env.GLASSMARK_BRIDGE_BIN), [], {
  env: {
    ...process.env,
    GLASSMARK_DATA: root,
    GLASSMARK_CONNECTION_FILE: file,
  },
  stdio: "inherit",
});
let context, server;
try {
  let connection;
  for (let i = 0; i < 100; i++) {
    try {
      connection = JSON.parse(await readFile(file, "utf8"));
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(connection);
  server = await staticServer(connection);
  const ext = path.resolve("dist/extension-chromium");
  context = await chromium.launchPersistentContext(root + "/profile", {
    headless: true,
    channel: "chromium",
    args: ["--disable-extensions-except=" + ext, "--load-extension=" + ext],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const auth = { Authorization: "Bearer " + connection.token };
  const preferences = await (
    await fetch(connection.base + "/api/preferences", { headers: auth })
  ).json();
  await fetch(connection.base + "/api/preferences", {
    method: "PUT",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ ...preferences, language: "zh-CN" }),
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator("#pair").waitFor({ state: "visible" });
  const pairing = await (
    await fetch(connection.base + "/api/pairing", {
      method: "POST",
      headers: { Authorization: "Bearer " + connection.token },
    })
  ).json();
  await popup.locator("#code").fill(pairing.code);
  await popup.locator("#pairButton").click();
  await popup.locator("#connection-badge.online").waitFor();
  const source = await context.newPage();
  await source.goto("http://127.0.0.1:1420/fixtures/article.html");
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url?.includes("/fixtures/article.html")).id;
  });
  const progress = await context.newPage();
  await progress.goto(
    `chrome-extension://${extensionId}/capture.html?tab=${tabId}&mode=page`,
  );
  await progress
    .getByText("收藏完成", { exact: true })
    .waitFor({ timeout: 60000 });
  const items = await (
    await fetch(connection.base + "/api/items", {
      headers: { Authorization: "Bearer " + connection.token },
    })
  ).json();
  assert.equal(items.length, 1);
  assert.equal(items[0].version, 2);
  assert.equal(
    items[0].resources.some((r) => /javascript/.test(r.mime)),
    false,
  );
  await source.route("https://x.com/**", (route) =>
    route.fulfill({ contentType: "text/html", path: "tests/fixtures/x.html" }),
  );
  await source.goto("https://x.com/lin/status/1001");
  await source.evaluate(() => {
    const articles = [
      ...document.querySelectorAll('article[data-testid="tweet"]'),
    ];
    articles[0].querySelector(".photo img").src =
      "http://127.0.0.1:1420/fixtures/note-cover.svg?unmounted=1&name=orig";
    articles[0].__reactProps$mediaTest = {
      tweet: {
        rest_id: "1001",
        legacy: {
          in_reply_to_status_id_str: null,
          extended_entities: {
            media: [1, 2, 3, 4].map((n) => ({
              type: "photo",
              id_str: "p" + n,
              media_url_https: `http://127.0.0.1:1420/fixtures/note-cover.svg?unmounted=${n}`,
            })),
          },
        },
      },
    };
    const reply = articles[1],
      id = reply
        .querySelector('a[href*="/status/"]')
        ?.getAttribute("href")
        .match(/\/status\/(\d+)/)?.[1];
    reply.__reactProps$mediaTest = {
      tweet: {
        rest_id: id,
        legacy: {
          in_reply_to_status_id_str: "1001",
          in_reply_to_screen_name: "lin",
          extended_entities: {
            media: [1, 2].map((n) => ({
              type: "video",
              id_str: "v" + n,
              media_url_https: `http://127.0.0.1:1420/fixtures/avatar.svg?poster=${n}`,
              video_info: {
                variants: [
                  {
                    content_type: "video/mp4",
                    bitrate: 100,
                    url: `http://127.0.0.1:1420/fixtures/video.webm?clip=${n}`,
                  },
                ],
              },
            })),
          },
        },
      },
    };
  });
  // A mixed post exposes a still preview plus an unresolved DOM video player.
  // The preview belongs to that video, not a third gallery attachment.
  await source.evaluate(() => {
    const article = document.querySelectorAll(
      'article[data-testid="tweet"]',
    )[2];
    const photo =
      "http://127.0.0.1:1420/fixtures/note-cover.svg?mixed=1&name=orig";
    const poster = "http://127.0.0.1:1420/fixtures/avatar.svg?mixed=1";
    const video = "http://127.0.0.1:1420/fixtures/video.webm?mixed=1";
    const gallery = document.createElement("div");
    gallery.className = "photo";
    gallery.innerHTML = `<img src="${photo}"><img src="${poster}"><div data-testid="videoComponent"><video poster="${poster}"></video></div>`;
    article.querySelector(".body").append(gallery);
    article.__reactProps$mixedTest = {
      tweet: {
        rest_id: "1003",
        legacy: {
          in_reply_to_status_id_str: "1002",
          extended_entities: {
            media: [
              { type: "photo", id_str: "mixed-photo", media_url_https: photo },
              {
                type: "video",
                id_str: "mixed-video",
                media_url_https: poster,
                video_info: {
                  variants: [
                    { content_type: "video/mp4", bitrate: 100, url: video },
                  ],
                },
              },
            ],
          },
        },
      },
    };
  });
  await progress.goto(
    `chrome-extension://${extensionId}/capture.html?tab=${tabId}&mode=thread`,
  );
  await progress
    .getByText("收藏完成", { exact: true })
    .waitFor({ timeout: 45000 });
  const captured = await (
    await fetch(connection.base + "/api/items", {
      headers: { Authorization: "Bearer " + connection.token },
    })
  ).json();
  assert.equal(captured.length, 2);
  assert.equal(captured[0].posts.length, 3);
  assert.equal(captured[0].platform, "x");
  assert.equal(captured[0].posts[0].media.length, 4);
  assert.equal(captured[0].posts[1].parentId, "1001");
  assert.equal(
    captured[0].posts[1].media.filter((m) => m.type === "video").length,
    2,
  );
  assert.deepEqual(
    captured[0].posts[2].media.map((m) => m.type),
    ["image", "video"],
  );
  assert.equal(captured[0].posts[2].parentId, "1002");
  const mediaUrls = captured[0].posts.flatMap((post) =>
    post.media.map((m) => m.url),
  );
  for (const url of mediaUrls) {
    const resource = captured[0].resources.find((r) => r.url === url);
    assert.equal(resource?.status, "saved", url);
    assert.ok(
      (
        await readFile(
          `${root}/content-v2/archives/${captured[0].id}/assets/${resource.name}`,
        )
      ).length > 0,
    );
  }
  await fetch(connection.base + "/api/preferences", {
    method: "PUT",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...preferences,
      language: "zh-CN",
      maxPosts: 20, // This flow expects all expanded Zhihu comments.
      autoLoadSeconds: 8,
    }),
  });
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
  // Exercise selection → background message → capture page → native persistence.
  // Canonical answer URLs intentionally differ from question URLs and tracking URLs.
  for (const url of [
    "https://www.zhihu.com/question/123?utm_source=test#top",
    "https://www.zhihu.com/question/123/answer/222?utm_source=test#comments",
    "https://www.zhihu.com/question/124",
    "https://www.zhihu.com/question/125",
    "https://www.zhihu.com/question/125?preview=1",
    "https://www.zhihu.com/question/125?opened=1",
    "https://www.zhihu.com/question/125?staged=1",
    "https://www.zhihu.com/question/125?unrelated=1",
    "https://www.zhihu.com/question/125?skeleton=1&delay=1200&pageDelay=800",
    "https://www.zhihu.com/question/125?opened=1&skeleton=1&delay=1200",
    "https://www.zhihu.com/question/125?staleempty=1&delay=1200",
  ]) {
    await source.goto(url);
    await worker.evaluate(
      async ({ tabId, url }) => {
        await chrome.storage.local.set({
          ["pendingCapture_" + tabId]: {
            mode: "thread",
            expectedUrl: url,
            tags: [],
            folderId: null,
            createdAt: Date.now(),
          },
        });
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            globalThis.__glassmarkLanguage = "zh-CN";
            globalThis.__glassmarkPickerMode = "zhihu-answer";
          },
        });
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["picker.js"],
        });
      },
      { tabId, url },
    );
    await source
      .locator(".AnswerItem")
      .nth(url.includes("/question/125") ? 0 : 1)
      .locator(".RichContent-inner")
      .click();
    const newPage = context.waitForEvent("page");
    await source
      .getByRole("button", { name: "保存回答与评论", exact: true })
      .click();
    const capturePage = await newPage;
    await capturePage.waitForURL(/capture\.html.*mode=thread/);
    await capturePage
      .getByText("收藏完成", { exact: true })
      .waitFor({ timeout: 45000 });
    const archives = await (
      await fetch(connection.base + "/api/items", { headers: auth })
    ).json();
    const saved = archives.find((item) => item.sourceUrl === url);
    assert.ok(saved, "selected answer must reach native persistence");
    assert.equal(
      saved.url,
      url.includes("/question/125")
        ? "https://www.zhihu.com/question/125/answer/222"
        : url.includes("/question/124")
          ? "https://www.zhihu.com/question/124/answer/222"
          : "https://www.zhihu.com/question/123/answer/222",
    );
    if (url.includes("/question/124")) {
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
    assert.equal(saved.platform, "zhihu");
    assert.equal(saved.posts[0].id, "222");
    assert.deepEqual(
      saved.posts.map((post) => post.id),
      url.includes("/question/125")
        ? ["222", "c1", "c2", "reply1", "reply2", "reply3", "c3"]
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
    assert.ok(saved.resources.some((resource) => resource.status === "saved"));
    await capturePage.close();
  }
  const beforeNavigation = (
    await (
      await fetch(connection.base + "/api/items", { headers: auth })
    ).json()
  ).length;
  await source.goto("https://www.zhihu.com/question/999");
  await progress.goto(
    `chrome-extension://${extensionId}/capture.html?tab=${tabId}&mode=thread`,
  );
  await expect(progress.locator("#title")).toHaveText("收藏未完成");
  await expect(progress.locator("#detail")).toContainText("来源标签页已跳转");
  assert.equal(
    (
      await (
        await fetch(connection.base + "/api/items", { headers: auth })
      ).json()
    ).length,
    beforeNavigation,
  );
  const device = await worker.evaluate(
    async () => (await chrome.storage.local.get("connection")).connection,
  );
  assert.ok(device.token);
  assert.equal(
    (
      await fetch(connection.base + "/api/settings", {
        headers: { Authorization: "Bearer " + device.token },
      })
    ).status,
    403,
  );
  // Closing the native client must disable every capture action in the popup.
  child.kill();
  await new Promise((r) => setTimeout(r, 700));
  await popup.reload();
  await expect(popup.locator("#status")).toHaveText(/未连接/);
  await expect(popup.locator("#actions")).toBeHidden();
  assert.equal(await popup.locator("html").getAttribute("lang"), "zh-CN");
  await writeFile(
    "artifacts/extension-report.json",
    JSON.stringify(
      {
        installed: true,
        checks: [
          "MV3 worker loads",
          "real pairing",
          "content injection",
          "resource upload",
          "all four images and both independent videos reach native archive files through MAIN-world metadata",
          "one photo plus one video stays two attachments without standalone poster or unresolved duplicate player",
          "native persistence",
          "Zhihu question and tracked-answer selection through background, capture UI and native persistence",
          "actual source navigation is rejected",
          "scoped token",
          "disabled when client is closed",
        ],
      },
      null,
      2,
    ),
  );
  console.log("PASS real Chromium extension → native Rust bridge");
} finally {
  await context?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
  child.kill();
}
