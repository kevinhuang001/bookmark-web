import { build } from "esbuild";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { staticServer } from "../scripts/dev.mjs";
import { launchBrowser } from "../scripts/browser.mjs";
import {
  readPageData,
  enrichCapture,
} from "../extension/src/capture/page-data.js";
import { archiveResources } from "../extension/src/archive.js";
const server = await staticServer(),
  browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const img = (n) => `http://127.0.0.1:1420/fixtures/note-cover.svg?slide=${n}`;
  const video = (n) => `http://127.0.0.1:1420/fixtures/video.webm?clip=${n}`;
  // One mounted image at a time, lazy URLs, start midway through the gallery.
  await page.route("https://www.xiaohongshu.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<main><div class="note-container" data-note-id="abc"><div id="detail-title">Gallery</div><div id="detail-desc">Full gallery</div><div class="note-slider"><div class="swiper-slide"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="${img(2)}"></div></div><button data-gallery-prev>Previous</button><button data-gallery-next>Next</button></div></main>`,
    }),
  );
  await page.goto("https://www.xiaohongshu.com/explore/abc");
  await page.evaluate((urls) => {
    let index = 1;
    const draw = () => {
      document.querySelector(".swiper-slide").innerHTML =
        `<img data-src="${urls[index]}">`;
      document.querySelector("[data-gallery-prev]").disabled = index === 0;
      document.querySelector("[data-gallery-next]").disabled =
        index === urls.length - 1;
    };
    document.querySelector("[data-gallery-prev]").onclick = () => {
      index--;
      draw();
    };
    document.querySelector("[data-gallery-next]").onclick = () => {
      index++;
      draw();
    };
    draw();
  }, [1, 2, 3, 4].map(img));
  await page.addScriptTag({
    content: await readFile("dist/extension-chromium/content.js", "utf8"),
  });
  const capture = await page.evaluate(() =>
    globalThis.GlassmarkCapture.collect({
      mode: "thread",
      maxPosts: 0,
      autoLoadSeconds: 1,
    }),
  );
  assert.deepEqual(
    new Set(capture.posts[0].media.map((m) => m.url)),
    new Set([1, 2, 3, 4].map(img)),
  );
  assert.equal(
    await page.locator(".swiper-slide img").getAttribute("data-src"),
    img(2),
  );
  const uploaded = [];
  const resources = await archiveResources(capture.resources, {
    upload: async (name) => uploaded.push(name),
    approve: async () => true,
  });
  assert.equal(resources.filter((r) => r.status === "saved").length, 4);
  assert.equal(uploaded.length, 4);
  // Server-provided note data contains slides that have never been mounted.
  await page.evaluate((urls) => {
    globalThis.__INITIAL_STATE__ = {
      note: {
        noteDetailMap: {
          abc: {
            note: {
              noteId: "abc",
              imageList: urls.map((url, index) => ({
                fileId: "image" + index,
                urlDefault: url,
              })),
            },
          },
          other: {
            note: {
              noteId: "other",
              imageList: [{ urlDefault: "https://wrong.test/leak.jpg" }],
            },
          },
        },
      },
    };
  }, [1, 2, 3, 4, 5].map(img));
  const noteData = await page.evaluate(readPageData);
  enrichCapture(capture, noteData);
  assert.equal(capture.posts[0].media.length, 5);
  assert.ok(capture.resources.includes(img(5)));
  assert.ok(!capture.resources.some((url) => url.includes("wrong.test")));
  // Every video must retain its own source rather than borrowing the first clip.
  await page.locator(".note-slider").evaluate((el, urls) => {
    el.innerHTML = urls.map((url) => `<video src="${url}"></video>`).join("");
  }, [1, 2].map(video));
  const adapters = await build({
    entryPoints: ["extension/src/capture/adapters.js"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "MediaAdapters",
  });
  await page.addScriptTag({ content: adapters.outputFiles[0].text });
  const videos = await page.evaluate(() =>
    MediaAdapters.extractPost(
      document.querySelector(".note-container"),
      "xiaohongshu",
    ).media.filter((m) => m.type === "video"),
  );
  assert.equal(new Set(videos.map((m) => m.url)).size, 2);
  const clips = await archiveResources(
    videos.map((m) => m.url),
    { upload: async () => {}, approve: async () => true },
  );
  assert.equal(clips.filter((m) => m.status === "saved").length, 2);
  // X React metadata supplies all attachments and exact reply IDs despite sparse DOM.
  await page.route("https://x.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<main><article data-testid="tweet"><a href="/a/status/101"><time></time></a><div data-testid="tweetText">Root</div><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/one?name=small"></div></article><article data-testid="tweet"><a href="/b/status/102"><time></time></a><div data-testid="tweetText">Reply</div></article></main>',
    }),
  );
  await page.goto("https://x.com/a/status/101");
  await page.evaluate(() => {
    const [root, reply] = document.querySelectorAll("article");
    root.__reactProps$test = {
      tweet: {
        rest_id: "101",
        legacy: {
          extended_entities: {
            media: [1, 2, 3, 4].map((n) => ({
              id_str: String(n),
              type: "photo",
              media_url_https: `https://pbs.twimg.com/media/photo${n}.jpg`,
            })),
          },
        },
      },
    };
    reply.__reactProps$test = {
      tweet: {
        rest_id: "102",
        legacy: {
          in_reply_to_status_id_str: "101",
          in_reply_to_screen_name: "a",
          extended_entities: {
            media: [1, 2].map((n) => ({
              id_str: "v" + n,
              type: "video",
              media_url_https: `https://pbs.twimg.com/ext_tw_video_thumb/${n}/cover.jpg`,
              video_info: {
                variants: [
                  {
                    content_type: "video/mp4",
                    bitrate: 10,
                    url: `https://video.twimg.com/${n}/low.mp4`,
                  },
                  {
                    content_type: "video/mp4",
                    bitrate: 100,
                    url: `https://video.twimg.com/${n}/high.mp4`,
                  },
                ],
              },
            })),
          },
        },
      },
    };
  });
  const data = await page.evaluate(readPageData);
  assert.equal(data["101"].media.length, 4);
  assert.equal(data["102"].parentId, "101");
  assert.equal(data["102"].media.length, 2);
  assert.ok(data["102"].media.every((m) => m.url.endsWith("/high.mp4")));
  assert.equal(new Set(data["102"].media.map((m) => m.url)).size, 2);
  await page.evaluate(readPageData, "start");
  await page
    .locator("article")
    .last()
    .evaluate((el) => el.remove());
  const tracked = await page.evaluate(readPageData, "stop");
  assert.equal(tracked["102"].parentId, "101");
  assert.equal(
    await page.evaluate(() => globalThis.__glassmarkPageData),
    undefined,
  );
  console.log(
    "PASS virtual galleries, all note images, distinct videos and X parent/attachment metadata",
  );
} finally {
  await browser.close();
  await server.close();
}
