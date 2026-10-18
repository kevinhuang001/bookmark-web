/** Exercise the same bundled collector under Firefox's DOM engine. */
import { firefox } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { staticServer } from "../scripts/dev.mjs";
const server = await staticServer();
const browser = await firefox.launch();
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:1420/fixtures/article.html");
  await page.addScriptTag({
    content: await readFile("dist/extension-firefox/content.js", "utf8"),
  });
  const capture = await page.evaluate(() =>
    GlassmarkCapture.collect({ mode: "page" }),
  );
  assert.match(capture.content, /FIELDNOTES/);
  assert.equal(capture.version, 2);
  assert.doesNotMatch(capture.content, /<script/);
  await page.route("https://www.zhihu.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      path: "tests/fixtures/zhihu-comments.html",
    }),
  );
  await page.goto("https://www.zhihu.com/question/124");
  await page.evaluate(() => {
    globalThis.__glassmarkLanguage = "zh-CN";
    globalThis.__glassmarkPickerMode = "zhihu-answer";
    globalThis.browser = { runtime: { sendMessage: async () => {} } };
  });
  await page.addScriptTag({
    content: await readFile("dist/extension-firefox/picker.js", "utf8"),
  });
  await page
    .locator(".AnswerItem")
    .nth(1)
    .locator(".RichContent-inner")
    .click();
  await page
    .getByRole("button", { name: "保存回答与评论", exact: true })
    .click();
  await page.addScriptTag({
    content: await readFile("dist/extension-firefox/content.js", "utf8"),
  });
  const zhihu = await page.evaluate(() =>
    GlassmarkCapture.collect({
      mode: "thread",
      language: "zh-CN",
      maxPosts: 1,
      autoLoadSeconds: 8,
    }),
  );
  assert.deepEqual(
    zhihu.posts.map((post) => post.id),
    ["222", "c1", "reply1", "c2", "c3"],
  );
  assert.equal(
    await page.locator("body").getAttribute("data-comment-clicks"),
    "1",
  );
  assert.equal(
    await page.locator("body").getAttribute("data-hidden-clicks"),
    null,
  );
  assert.equal(
    await page.locator("body").getAttribute("data-wrong-clicks"),
    null,
  );
  const manifest = JSON.parse(
    await readFile("dist/extension-firefox/manifest.json", "utf8"),
  );
  assert.deepEqual(manifest.background, { scripts: ["background.js"] });
  assert.ok(manifest.browser_specific_settings.gecko.id);
  await writeFile(
    "artifacts/firefox-report.json",
    JSON.stringify(
      {
        browser: await browser.version(),
        collector: true,
        zhihuAutomaticComments: true,
        manifest: true,
        installedAddon: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS Firefox collector and manifest (not an installed-add-on test)",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
