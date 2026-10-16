import { test } from "node:test";
import assert from "node:assert/strict";
import { platform } from "../extension/src/capture/adapters.js";
import {
  dependencies,
  rewrite,
  extensionFor,
  readBounded,
  archiveResources,
} from "../extension/src/archive.js";
import { escapeHtml } from "../extension/src/capture/serialize.js";
test("platform matches hosts without accepting lookalikes", () => {
  assert.equal(platform("x.com"), "x");
  assert.equal(platform("www.reddit.com"), "reddit");
  assert.equal(platform("old.reddit.com"), "reddit");
  assert.equal(platform("notx.com"), "web");
  assert.equal(platform("x.com.attacker.test"), "web");
});
test("CSS dependency graph resolves imports, fonts and background images", () =>
  assert.deepEqual(
    dependencies(
      '@import "./theme.css"; a{background:url(../img/a.png)} @font-face{src:url(font.woff2)}',
      "text/css",
      "https://a.test/css/main.css",
    ),
    [
      "https://a.test/img/a.png",
      "https://a.test/css/font.woff2",
      "https://a.test/css/theme.css",
    ],
  ));
test("JS module graph handles static and literal dynamic imports", () =>
  assert.deepEqual(
    dependencies(
      'import x from "./a.js"; import("../b.js"); import "./c.js"; import y from "react"',
      "text/javascript",
      "https://a.test/js/app.js",
    ),
    ["https://a.test/js/a.js", "https://a.test/b.js", "https://a.test/js/c.js"],
  ));
test("rewrites saved resources including HTML escaped URLs", () => {
  const r = [
    { url: "https://a.test/image?a=1&b=2", status: "saved", name: "a.png" },
  ];
  assert.equal(
    rewrite('<img src="https://a.test/image?a=1&amp;b=2">', r),
    '<img src="assets/a.png">',
  );
});
test("failed resources remain named in source for diagnostics", () =>
  assert.equal(
    rewrite("https://a.test/a", [
      { url: "https://a.test/a", status: "failed" },
    ]),
    "https://a.test/a",
  ));
test("resource extension strips MIME parameters", () =>
  assert.equal(extensionFor("text/css; charset=utf-8"), "css"));
test("HTML text escape prevents markup injection", () =>
  assert.equal(
    escapeHtml('<img onerror="x">'),
    "&lt;img onerror=&quot;x&quot;&gt;",
  ));
test("budget requires approval before storing an over-budget chunk", async () => {
  let asked = 0;
  const state = { limit: 2, total: 0 };
  const bytes = await readBounded(new Response("hello"), state, async () => {
    asked++;
    return true;
  });
  assert.equal(asked, 1);
  assert.equal(bytes.length, 5);
  assert.equal(state.total, 5);
});
test("budget refusal does not accept the rejected bytes", async () => {
  const state = { limit: 2, total: 0 };
  await assert.rejects(
    readBounded(new Response("hello"), state, async () => false),
    /超过下载上限/,
  );
  assert.equal(state.total, 0);
});
test("resource failures are reported while remaining assets proceed", async () => {
  const uploads = [];
  const resources = await archiveResources(
    ["https://a.test/main.css", "https://a.test/broken"],
    {
      upload: async (...args) => uploads.push(args),
      approve: async () => true,
      fetcher: async (url) =>
        url.endsWith("broken")
          ? new Response("", { status: 404 })
          : new Response("a{color:red}", {
              headers: { "Content-Type": "text/css" },
            }),
    },
  );
  assert.equal(uploads.length, 1);
  assert.equal(resources[0].status, "saved");
  assert.match(resources[0].name, /^[a-f\d]{64}\.css$/);
  assert.equal(resources[1].status, "failed");
});
test("source dependency loops are deduplicated", async () => {
  let calls = 0;
  const resources = await archiveResources(["https://a.test/a.css"], {
    upload: async () => {},
    approve: async () => true,
    fetcher: async () => {
      calls++;
      return new Response('@import "a.css";', {
        headers: { "Content-Type": "text/css" },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(resources.length, 1);
});
test("cancellation stops resource graph traversal", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    archiveResources(["https://a.test"], { signal: controller.signal }),
    /已取消/,
  );
});

test("navigation isolates X/Twitter, Reddit and ordinary web pages", async () => {
  const { itemsInView } = await import("../app/library.js");
  const items = [
    { id: "a", url: "https://x.com/a/status/1", platform: "x", tags: [] },
    { id: "b", url: "https://twitter.com/b/status/2", tags: [] },
    { id: "c", url: "https://reddit.com/r/a", platform: "reddit", tags: [] },
    { id: "d", url: "https://example.com", folderId: "child", tags: [] },
  ];
  assert.deepEqual(
    itemsInView(items, { view: "web" }).map((i) => i.id),
    ["d"],
  );
  assert.deepEqual(
    itemsInView(items, { view: "x" }).map((i) => i.id),
    ["a", "b"],
  );
  assert.deepEqual(
    itemsInView(items, {
      view: "web",
      folder: "root",
      folders: [{ id: "child", parentId: "root" }],
    }).map((i) => i.id),
    ["d"],
  );
});
test("social feed sorts archived metrics and filters root authors without flattening replies", async () => {
  const { feedItems } = await import("../app/library.js");
  const make = (id, name, likes) => ({
    id,
    capturedAt: "2026-10-16",
    posts: [{ authorName: name, stats: { likes } }, { authorName: "reply" }],
  });
  const items = [make("a", "Lin", "86"), make("b", "Mia", "1.2K")];
  assert.equal(feedItems(items, { sort: "best" })[0].id, "b");
  assert.deepEqual(
    feedItems(items, { author: "Lin" }).map((i) => i.id),
    ["a"],
  );
  assert.equal(feedItems(items, { threads: true }).length, 2);
});

test("social media refuses live and executable URLs outside the archive", async () => {
  const { ArchiveMedia } = await import("../app/media.js");
  const media = new ArchiveMedia();
  assert.equal(
    await media.resolve({ resources: [] }, "https://attacker.test/image"),
    null,
  );
  assert.equal(
    await media.resolve({ resources: [] }, "javascript:alert(1)"),
    null,
  );
  assert.equal(
    await media.resolve(
      { resources: [] },
      "data:text/html,<script>alert(1)</script>",
    ),
    null,
  );
  const image = "data:image/png;base64,YQ==";
  assert.equal(await media.resolve({ resources: [] }, image), image);
  media.release();
});
