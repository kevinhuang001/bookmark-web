import test from "node:test";
import assert from "node:assert/strict";
import { imageSource } from "../extension/src/capture/gallery.js";
import { enrichCapture } from "../extension/src/capture/page-data.js";

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
