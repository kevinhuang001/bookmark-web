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

test("URL context distinguishes exact social posts, feeds and lookalike hosts", async () => {
  const { pageContext } = await import("../extension/src/context.js");
  assert.equal(pageContext("https://x.com/a/status/123/photo/1").postId, "123");
  assert.equal(
    pageContext("https://twitter.com/i/web/status/456").isPost,
    true,
  );
  assert.equal(
    pageContext("https://old.reddit.com/r/webdev/comments/abc/title/comment/")
      .postId,
    "abc",
  );
  for (const url of [
    "https://x.com/home",
    "https://reddit.com/r/webdev",
    "https://x.com.attacker.test/a/status/123",
  ])
    assert.equal(pageContext(url).isPost, false);
  assert.equal(pageContext("chrome://settings").supported, false);
});
test("HLS archive includes one quality, audio, init and every finite segment", async () => {
  const bodies = {
    "https://video.test/master.m3u8":
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200\nhigh.m3u8',
    "https://video.test/high.m3u8":
      '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nseg.ts\n#EXT-X-ENDLIST',
    "https://video.test/audio.m3u8":
      "#EXTM3U\n#EXTINF:2,\naudio.aac\n#EXT-X-ENDLIST",
  };
  const uploads = [];
  const resources = await archiveResources(["https://video.test/master.m3u8"], {
    approve: async () => true,
    upload: async (...args) => uploads.push(args),
    fetcher: async (url) =>
      new Response(bodies[url] || "segment", {
        headers: {
          "content-type": url.endsWith("m3u8")
            ? "application/vnd.apple.mpegurl"
            : "application/octet-stream",
        },
      }),
  });
  assert.equal(resources.length, 6);
  assert.equal(
    resources.every((r) => r.status === "saved"),
    true,
  );
  assert.equal(
    resources.some((r) => r.url.endsWith("low.m3u8")),
    false,
  );
  assert.match(
    new TextDecoder().decode(uploads[0][1]),
    /https:\/\/video.test\/high.m3u8/,
  );
});
test("encrypted and live HLS are reported as failed instead of complete videos", async () => {
  for (const text of [
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="secret.key"\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST',
    "#EXTM3U\n#EXTINF:2,\nlive.ts",
  ]) {
    let uploads = 0;
    const records = await archiveResources(["https://a.test/a.m3u8"], {
      approve: async () => true,
      upload: async () => uploads++,
      fetcher: async () => new Response(text),
    });
    assert.equal(records[0].status, "failed");
    assert.equal(uploads, 0);
  }
});

test("explicit webpage capture of a social URL stays in Web folders", async () => {
  const { itemPlatform } = await import("../app/library.js");
  assert.equal(
    itemPlatform({
      platform: "web",
      mode: "page",
      url: "https://x.com/a/status/1",
    }),
    "web",
  );
});
