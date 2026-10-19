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
    { type: "video", url: videoUrl },
  ];
  await page.evaluate(async () => {
    await (await import("/api.js")).connect();
    (await import("/i18n.js")).setLanguage("zh-CN");
    document.body.innerHTML = '<main id="reader" class="social-reader"></main>';
  });
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
    await render(item.id);
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
  await page.evaluate(async () => {
    (await import("/social.js")).releaseSocial();
  });
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await new Promise((r) => bridge.server.close(r));
}
