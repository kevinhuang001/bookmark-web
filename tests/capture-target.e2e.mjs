import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchBrowser } from "../scripts/browser.mjs";
import { staticServer } from "../scripts/dev.mjs";
const server = await staticServer(null),
  browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.route("https://x.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<main></main>" }),
  );
  await page.goto("https://x.com/target/status/123");
  await page.addScriptTag({
    content: await readFile("dist/extension-chromium/content.js", "utf8"),
  });
  const result = await page.evaluate(async () => {
    const post = (id, text) =>
      `<article data-testid="tweet"><div data-testid="User-Name"><a>Author</a> @a</div><a href="/a/status/${id}"><time datetime="2026-10-19"></time></a><div data-testid="tweetText">${text}</div></article>`;
    document.querySelector("main").innerHTML = post(
      "111",
      "unrelated ancestor",
    );
    document
      .querySelector("article")
      .insertAdjacentHTML(
        "beforeend",
        '<div role="link" tabindex="0"><a href="/target/status/123"><time></time></a><div data-testid="tweetText">quoted target</div></div>',
      );
    setTimeout(
      () =>
        document
          .querySelector("main")
          .insertAdjacentHTML("beforeend", post("123", "correct target")),
      400,
    );
    return GlassmarkCapture.collect({
      mode: "thread",
      maxPosts: 0,
      autoLoadSeconds: 1,
    });
  });
  assert.equal(result.posts[0].id, "123");
  assert.equal(result.posts[0].text, "correct target");
  assert.equal(result.scope.rootPostId, "123");
  assert.match(result.title, /correct target/);
  await page.evaluate(() => {
    document.querySelector("main").innerHTML =
      '<article data-testid="tweet"><a href="/other/status/999">link</a><div data-testid="tweetText">wrong post</div></article>';
    setTimeout(() => (globalThis.__glassmarkCaptureCanceled = true), 500);
  });
  await assert.rejects(
    page.evaluate(() =>
      GlassmarkCapture.collect({
        mode: "thread",
        maxPosts: 0,
        language: "zh-CN",
      }),
    ),
    /已取消/,
  );
  await page.route("https://www.xiaohongshu.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<main></main>" }),
  );
  await page.goto("https://www.xiaohongshu.com/explore/abc123");
  await page.addScriptTag({
    content: await readFile("dist/extension-chromium/content.js", "utf8"),
  });
  const note = await page.evaluate(async () => {
    document.querySelector("main").innerHTML =
      '<div class="note-container" data-note-id="old456"><div id="detail-desc">stale note</div></div>';
    setTimeout(
      () =>
        document
          .querySelector("main")
          .insertAdjacentHTML(
            "beforeend",
            '<div class="note-container" data-note-id="abc123"><div id="detail-desc">correct note</div></div>',
          ),
      400,
    );
    return GlassmarkCapture.collect({ mode: "thread", maxPosts: 0 });
  });
  assert.equal(note.posts[0].text, "correct note");
  assert.equal(note.posts.length, 1);
  console.log(
    "PASS exact target capture waits for the actual post and never relabels ancestors, quotes, or stale notes",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
