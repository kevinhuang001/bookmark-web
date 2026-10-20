import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fixtureBridge } from "../scripts/fixture-bridge.mjs";
import { staticServer } from "../scripts/dev.mjs";
import { launchBrowser } from "../scripts/browser.mjs";
const bridge = await fixtureBridge(".test-data/social-interactions"),
  server = await staticServer(bridge.connection),
  browser = await launchBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  await page.goto("http://127.0.0.1:1420/fixtures/article.html");
  await page.addStyleTag({ url: "/styles.css" });
  await page.addStyleTag({ url: "/social.css" });
  const bytes = await readFile("tests/fixtures/video.webm"),
    name = createHash("sha256").update(bytes).digest("hex") + ".webm";
  const headers = { Authorization: "Bearer " + bridge.connection.token };
  await fetch(bridge.connection.base + "/api/blobs/" + name, {
    method: "PUT",
    headers,
    body: bytes,
  });
  const videoUrl = "https://media.example.test/video.webm";
  const svg = (color) =>
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="${color}"/></svg>`,
    );
  const media = [
    { type: "image", url: svg("teal") },
    { type: "image", url: svg("navy") },
    { type: "video", url: videoUrl, poster: svg("purple") },
  ];
  await page.evaluate(async () => {
    await (await import("/api.js")).connect();
    (await import("/i18n.js")).setLanguage("zh-CN");
    document.body.innerHTML = '<main id="reader" class="social-reader"></main>';
  });
  let xItem;
  for (const kind of ["x", "reddit", "xiaohongshu", "zhihu"]) {
    const item = {
      id: "review-" + kind,
      title: kind,
      platform: kind,
      url: "https://example.test/" + kind,
      capturedAt: new Date().toISOString(),
      tags: [],
      resources: [{ url: videoUrl, name, status: "saved", mime: "video/webm" }],
      posts: [
        { id: "root", authorName: "OP", text: "Main post", title: kind, media },
        {
          id: "child",
          parentId: "root",
          isComment: true,
          authorName: "Reader",
          text: "Reply",
          media: [media[0], media[2]],
        },
        {
          id: "grandchild",
          parentId: "child",
          isComment: true,
          authorName: "Other",
          text: "Nested reply",
          media: [],
        },
      ],
    };
    // The fixture bridge serves assets by archive id, just as the native bridge does.
    const response = await fetch(bridge.connection.base + "/api/items", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...item,
        version: 2,
        mode: "thread",
        text: "Main post",
      }),
    });
    Object.assign(item, await response.json());
    if (kind === "x") xItem = item;
    const render = async (selected) =>
      page.evaluate(
        async ({ kind, item, selected }) => {
          globalThis.actions = [];
          await (
            await import("/social.js")
          ).renderSocial(document.querySelector("#reader"), {
            kind,
            items: [item],
            selected,
            query: "",
            filters: { sort: "recent" },
            callbacks: { action: (action) => globalThis.actions.push(action) },
          });
        },
        { kind, item, selected },
      );
    if (kind !== "xiaohongshu") {
      await render(null);
      if (kind === "x" || kind === "reddit") {
        const gallery = page.locator(".social-media-grid").first();
        await expect(gallery.locator("video")).toHaveAttribute(
          "poster",
          /^data:image/,
        );
        assert.equal(
          await gallery.locator("video").evaluate((el) => el.controls),
          false,
        );
        await gallery.locator("video").click();
        await expect(page.locator(".archive-viewer-stage video")).toHaveCount(
          1,
        );
        await expect
          .poll(() =>
            page
              .locator(".archive-viewer-stage video")
              .evaluate((el) => el.currentTime),
          )
          .toBeGreaterThan(0);
        assert.deepEqual(await page.evaluate(() => globalThis.actions), []);
        await page.keyboard.press("Escape");
        await expect(gallery.locator("video")).toHaveCount(1);
        assert.equal(
          await gallery.locator("video").evaluate((el) => el.controls),
          false,
        );
      }
      await page
        .locator(
          '[data-social-action="comments"],[data-social-action="x-comments"]',
        )
        .first()
        .click();
      await expect(page.locator(".inline-comments")).toBeVisible();
      assert.deepEqual(await page.evaluate(() => globalThis.actions), []);
      await expect(page.locator(".inline-comments video")).toHaveAttribute(
        "src",
        /^blob:/,
      );
      await page.locator(".inline-comments .social-media img").first().click();
      await expect(page.locator(".archive-viewer-counter")).toHaveText("1 / 2");
      await page.keyboard.press("ArrowRight");
      await expect(page.locator(".archive-viewer-stage video")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(page.locator(".inline-comments video")).toHaveCount(1);
    }
    const thumbnail = page.locator(".comment-media .social-media").first();
    if (kind !== "xiaohongshu") {
      const bounds = await thumbnail.boundingBox();
      assert.ok(
        bounds.width <= 100 && bounds.height <= 100,
        kind + " inline thumbnail",
      );
    }
    await render(item.id);
    if (kind === "x") {
      await expect(
        page.locator(
          '.x-thread-lines path[data-parent-id="root"][data-child-id="child"]',
        ),
      ).toHaveCount(1);
      await expect(
        page.locator(
          '.x-thread-lines path[data-parent-id="child"][data-child-id="grandchild"]',
        ),
      ).toHaveCount(1);
      const line = page.locator(".x-thread-lines path").first();
      assert.equal(
        await line.evaluate((el) => getComputedStyle(el).strokeWidth),
        "2px",
      );
      await page
        .locator(".x-thread-scope")
        .screenshot({ path: "artifacts/glassmark-x-thread-lines.png" });
    }
    const commentTile = page.locator(".comment-media .social-media").first();
    const bounds = await commentTile.boundingBox();
    assert.ok(
      bounds.width <= 100 && bounds.height <= 100,
      kind + " detail thumbnail",
    );
    await page.locator(".comment-media video").first().click();
    await expect(page.locator(".archive-viewer-stage video")).toHaveCount(1);
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .locator(".comment-media video")
        .first()
        .evaluate((el) => el.controls),
      false,
    );
    await expect(page.locator(".discussion-scope")).toHaveCount(0);
    if (kind === "xiaohongshu") {
      await page.locator('[data-note-slide="1"]').click();
      await expect(page.locator(".note-gallery-count")).toHaveText("2 / 3");
      await page.locator('[data-note-slide="-1"]').click();
      await expect(page.locator(".note-gallery-count")).toHaveText("1 / 3");
    }
    const rootGallery = page.locator(".social-media-grid").first();
    await rootGallery.locator("img").first().click();
    await expect(page.locator(".archive-viewer-counter")).toHaveText("1 / 3");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".archive-viewer-counter")).toHaveText("2 / 3");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".archive-viewer-counter")).toHaveText("3 / 3");
    const video = page.locator(".archive-viewer-stage video");
    await video.evaluate((el) => el.play());
    await page.waitForTimeout(250);
    assert.ok(await video.evaluate((el) => el.currentTime > 0));
    await page.keyboard.press("Escape");
    await expect(rootGallery.locator("video")).toHaveCount(1);
    assert.deepEqual(await page.evaluate(() => globalThis.actions), []);
    const commentButton = page
      .locator(
        '[data-social-action="comments"],[data-social-action="x-comments"],[data-note-comments]',
      )
      .first();
    await commentButton.click();
    assert.deepEqual(await page.evaluate(() => globalThis.actions), []);
    console.log(
      "PASS inline comments and every archived image/video work without navigation: " +
        kind,
    );
  }
  // Rendering a captured mixed gallery must not count the poster or empty player.
  await page.evaluate(
    async ({ media, name, videoUrl, id }) => {
      const item = {
        id,
        platform: "x",
        title: "Mixed attachments",
        tags: [],
        capturedAt: new Date().toISOString(),
        resources: [
          { url: videoUrl, name, status: "saved", mime: "video/webm" },
        ],
        posts: [
          {
            id: "mixed",
            authorName: "Author",
            text: "One photo and one video",
            media: [
              media[0],
              media[2],
              { type: "image", url: media[2].poster },
              { type: "video", url: "", poster: media[2].poster },
            ],
          },
        ],
      };
      globalThis.actions = [];
      await (
        await import("/social.js")
      ).renderSocial(document.querySelector("#reader"), {
        kind: "x",
        items: [item],
        selected: null,
        filters: { sort: "recent" },
        query: "",
        callbacks: { action: (action) => globalThis.actions.push(action) },
      });
    },
    { media, name, videoUrl, id: xItem.id },
  );
  const mixedGallery = page.locator(".social-media-grid");
  await expect(mixedGallery.locator(".social-media")).toHaveCount(2);
  await expect(mixedGallery.locator("img")).toHaveCount(1);
  await expect(mixedGallery.locator("video")).toHaveAttribute(
    "poster",
    /^data:image/,
  );
  await mixedGallery.screenshot({
    path: "artifacts/glassmark-mixed-media.png",
  });
  await mixedGallery.locator("video").click();
  await expect(page.locator(".archive-viewer-counter")).toHaveText("2 / 2");
  await expect
    .poll(() =>
      page
        .locator(".archive-viewer-stage video")
        .evaluate((el) => el.currentTime),
    )
    .toBeGreaterThan(0);
  assert.deepEqual(await page.evaluate(() => globalThis.actions), []);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    (await import("/social.js")).releaseSocial();
  });
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await new Promise((r) => bridge.server.close(r));
}
