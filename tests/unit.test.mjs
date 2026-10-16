import {
  setLanguage,
  getLanguage,
  resolveLocale,
  t,
  catalogs,
  localizeError,
} from "../app/i18n.js";
setLanguage("zh-CN");
import { pageContext } from "../extension/src/context.js";
import { itemPlatform } from "../app/library.js";
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

test("download workers run concurrently and include rendered-session credentials", async () => {
  let active = 0,
    maximum = 0;
  const urls = Array.from(
    { length: 15 },
    (_, i) => `https://media.test/${i}.png`,
  );
  const r = await archiveResources(urls, {
    concurrency: 4,
    approve: async () => true,
    upload: async () => {},
    fetcher: async (url, options) => {
      assert.equal(options.credentials, "include");
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return new Response("image", {
        headers: { "content-type": "image/png" },
      });
    },
  });
  assert.equal(r.length, 15);
  assert.ok(r.every((r) => r.status === "saved"));
  assert.equal(maximum, 4);
});
test("concurrent downloads share a single budget approval gate", async () => {
  let active = 0,
    maximum = 0,
    asked = 0;
  const state = { total: 0, limit: 3 };
  await Promise.all(
    ["abc", "def", "ghi"].map((text) =>
      readBounded(new Response(text), state, async () => {
        active++;
        maximum = Math.max(maximum, active);
        asked++;
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return true;
      }),
    ),
  );
  assert.equal(state.total, 9);
  assert.equal(asked, 1);
  assert.equal(maximum, 1);
});

test("Xiaohongshu note context supports both detail routes and rejects lookalikes", () => {
  assert.equal(platform("www.xiaohongshu.com"), "xiaohongshu");
  assert.equal(platform("xiaohongshu.com.attacker.test"), "web");
  for (const path of ["/explore/abc123", "/discovery/item/abc123"]) {
    const c = pageContext(
      "https://www.xiaohongshu.com" + path + "?xsec_token=test",
    );
    assert.equal(c.platform, "xiaohongshu");
    assert.equal(c.isPost, true);
    assert.equal(c.postId, "abc123");
  }
  assert.equal(
    pageContext("https://www.xiaohongshu.com/explore").isPost,
    false,
  );
  assert.equal(
    itemPlatform({
      platform: "xiaohongshu",
      url: "https://www.xiaohongshu.com/explore/abc123",
    }),
    "xiaohongshu",
  );
});

test("locale catalogs are complete and preserve every interpolation", () => {
  const keys = Object.keys(catalogs["zh-CN"]);
  const tokens = (s) => [...s.matchAll(/\{([\w]+)\}/g)].map((m) => m[1]).sort();
  for (const language of ["en", "ja"]) {
    assert.deepEqual(Object.keys(catalogs[language]).sort(), [...keys].sort());
    for (const key of keys) {
      const entry = catalogs[language][key];
      for (const value of typeof entry === "string"
        ? [entry]
        : [entry.one, entry.other]) {
        assert.ok(value.trim());
        assert.deepEqual(
          tokens(value),
          tokens(catalogs["zh-CN"][key]),
          language + ": " + key,
        );
      }
    }
  }
});
test("locale fallback, placeholders and backend errors use the chosen language", () => {
  assert.equal(resolveLocale("system", "ja-JP"), "ja");
  assert.equal(resolveLocale("system", "zh-TW"), "zh-CN");
  assert.equal(resolveLocale("fr"), "en");
  for (const [language, label] of [
    ["en", "Settings"],
    ["ja", "設定"],
    ["zh-CN", "设置"],
  ]) {
    setLanguage(language);
    assert.equal(t("设置"), label);
    assert.equal(
      t("打开 {1}", { 1: "User title <原文>" }).includes("User title <原文>"),
      true,
    );
  }
  setLanguage("en");
  assert.equal(t("{2} 篇笔记", { 2: 1 }), "1 note");
  assert.equal(t("{2} 篇笔记", { 2: 2 }), "2 notes");
  assert.match(
    localizeError("帖子数量需要在 1–1000 之间"),
    /Post count must be between 1 and 1000/,
  );
  assert.equal(t("unknown diagnostic"), "unknown diagnostic");
  setLanguage("zh-CN");
});

test("all explicit UI translation keys are present in every catalog", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  async function files(dir) {
    return (
      await Promise.all(
        (await readdir(dir, { withFileTypes: true })).map((e) =>
          e.isDirectory() ? files(dir + "/" + e.name) : [dir + "/" + e.name],
        ),
      )
    ).flat();
  }
  const paths = [
    ...(await files("app")),
    ...(await files("extension/src")),
  ].filter((p) => /\.(js|html)$/.test(p) && !p.includes("/locales/"));
  for (const path of paths) {
    const source = await readFile(path, "utf8");
    const keys = [...source.matchAll(/\b(?:tr|t)\("((?:\\.|[^"\\])*)"/g)].map(
      (m) => JSON.parse('"' + m[1] + '"'),
    );
    if (path.endsWith(".html"))
      keys.push(
        ...[...source.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)].map(
          (m) => m[1],
        ),
      );
    for (const key of keys)
      for (const language of ["en", "zh-CN", "ja"])
        assert.ok(
          Object.hasOwn(catalogs[language], key),
          path + ": " + language + ": " + key,
        );
  }
});

test("Zhihu supports exact answer/article routes without treating questions or lookalikes as posts", () => {
  for (const [url, id] of [
    ["https://www.zhihu.com/question/123/answer/456?utm=test", "456"],
    ["https://zhuanlan.zhihu.com/p/789", "789"],
  ]) {
    assert.equal(platform(new URL(url).hostname), "zhihu");
    assert.equal(pageContext(url).postId, id);
    assert.equal(pageContext(url).isPost, true);
    assert.equal(itemPlatform({ platform: "zhihu", url }), "zhihu");
  }
  for (const url of [
    "https://www.zhihu.com/question/123",
    "https://www.zhihu.com/collection/123",
    "https://zhihu.com.attacker.test/question/123/answer/456",
    "https://www.zhihu.com/p/789",
  ])
    assert.equal(pageContext(url).isPost, false);
});
