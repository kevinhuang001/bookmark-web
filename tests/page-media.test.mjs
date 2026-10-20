import test from "node:test";
import assert from "node:assert/strict";
import { imageSource } from "../extension/src/capture/gallery.js";
import { enrichCapture } from "../extension/src/capture/page-data.js";
import { enrichPost } from "../extension/src/capture/page-data.js";

test("partial page metadata cannot discard later carousel images or collapse distinct videos sharing a poster", () => {
  const poster = "https://media.test/cover.jpg";
  const videos = [
    { type: "video", id: "v1", url: "https://media.test/1.mp4", poster },
    { type: "video", id: "v2", url: "https://media.test/2.mp4", poster },
  ];
  const root = {
    id: "1",
    media: [
      {
        type: "image",
        url: "https://pbs.twimg.com/media/photo1?format=jpg&name=small",
      },
      { type: "image", url: "https://pbs.twimg.com/media/photo2?name=large" },
      { type: "video", url: videos[0].url, poster },
    ],
  };
  const result = enrichPost(root, "x", {
    1: {
      media: [
        {
          type: "image",
          id: "p1",
          url: "https://pbs.twimg.com/media/photo1.jpg?name=orig",
        },
        ...videos,
      ],
    },
  });
  assert.equal(result.media.length, 4);
  assert.equal(result.media.filter((m) => m.type === "video").length, 2);
  assert.ok(result.media.some((m) => m.url.includes("photo2")));
  assert.equal(result.media.filter((m) => m.url.includes("photo1")).length, 1);
  assert.ok(
    result.media.find((m) => m.url.includes("photo1")).url.includes("orig"),
  );
});

test("lazy images resolve real relative sources without turning empty images into page URLs", () => {
  const image = {
    ownerDocument: { baseURI: "https://example.test/post/1" },
    getAttribute: () => null,
    currentSrc: "",
    src: "",
  };
  assert.equal(imageSource(image), "");
  image.currentSrc = "data:image/gif;base64,placeholder";
  image.getAttribute = (name) => (name === "data-src" ? "/real.jpg" : null);
  assert.equal(imageSource(image), "https://example.test/real.jpg");
});
test("complete attachment metadata enriches only matching posts and respects capture preferences", () => {
  const media = [
    { type: "image", url: "https://media.test/1.jpg" },
    { type: "image", url: "https://media.test/2.jpg" },
    {
      type: "video",
      url: "https://media.test/3.mp4",
      sources: ["https://media.test/3.mp4"],
    },
  ];
  const capture = {
    platform: "x",
    posts: [
      { id: "1", media: [media[0]] },
      { id: "2", media: [] },
    ],
    resources: [],
  };
  const data = {
    1: { media, complete: true },
    2: { parentId: "1" },
    999: {
      media: [{ type: "image", url: "https://wrong.test/other.jpg" }],
      complete: true,
    },
  };
  const result = enrichCapture(capture, data, { includeVideos: false });
  assert.equal(result.posts[0].media.length, 2);
  assert.equal(result.posts[1].parentId, "1");
  assert.deepEqual(
    result.resources,
    media.slice(0, 2).map((m) => m.url),
  );
});

test("one photo and one video stay two attachments across DOM, page metadata and repeated capture", async () => {
  const { mergePost } = await import("../extension/src/capture/merge.js");
  const photo = {
    type: "image",
    url: "https://pbs.twimg.com/media/photo.jpg?name=small",
  };
  const poster = "https://pbs.twimg.com/amplify_video_thumb/7788/img/cover.jpg";
  const original = {
    id: "1",
    media: [
      photo,
      { type: "image", url: poster + "?name=small" },
      { type: "video", id: "7788", url: "", poster: poster + "?name=small" },
    ],
  };
  const data = {
    1: {
      media: [
        {
          ...photo,
          url: "https://pbs.twimg.com/media/photo?format=jpg&name=orig",
        },
        {
          type: "video",
          id: "media-id",
          poster,
          url: "https://video.twimg.com/amplify_video/7788/vid/720x720/main.mp4",
        },
      ],
    },
  };
  const enriched = enrichPost(original, "x", data);
  assert.deepEqual(
    enriched.media.map((m) => m.type),
    ["image", "video"],
  );
  assert.equal(enriched.media[1].url, data[1].media[1].url);
  const later = {
    ...original,
    media: [
      photo,
      {
        type: "video",
        poster,
        url: "https://video.twimg.com/amplify_video/7788/pl/master.m3u8",
      },
    ],
  };
  assert.equal(
    mergePost(enriched, enrichPost(later, "x", data)).media.length,
    2,
  );
  assert.equal(enrichPost(enriched, "x", data).media.length, 2);
});

test("video poster variants are never independent photos, and unrelated photo URLs survive", async () => {
  const { normalizeMedia } = await import("../app/media-records.js");
  const poster = "https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/p.jpg";
  const media = normalizeMedia([
    { type: "image", url: "https://pbs.twimg.com/media/real?name=small" },
    { type: "image", url: poster + "?format=jpg&name=small" },
    {
      type: "video",
      poster,
      url: "https://video.twimg.com/ext_tw_video/123/pu/vid/a.mp4",
    },
    {
      type: "video",
      poster: poster + "?name=large",
      url: "https://video.twimg.com/ext_tw_video/123/pu/pl/a.m3u8",
    },
  ]);
  assert.equal(media.length, 2);
  assert.equal(media[1].sources.length, 2);
  assert.equal(
    normalizeMedia([
      { type: "video", url: "https://media.test/one.mp4", poster },
      { type: "video", url: "https://media.test/two.mp4", poster },
    ]).length,
    2,
  );
});
