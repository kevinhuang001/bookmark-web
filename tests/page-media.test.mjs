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
