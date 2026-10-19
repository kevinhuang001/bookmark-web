import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCapture } from "../extension/src/capture/validate.js";
import { setLanguage } from "../app/i18n.js";
import { readLocal, writeLocal } from "../app/storage.js";
setLanguage("zh-CN");
const url = "https://x.com/target/status/123";
const capture = {
  sourceUrl: url,
  url,
  platform: "x",
  scope: { rootPostId: "123" },
  posts: [{ id: "123", url }],
};
test("capture validation rejects a different root, quoted status, or document navigation", () => {
  assert.doesNotThrow(() => validateCapture(capture, url, url, "thread"));
  for (const changed of [
    {
      ...capture,
      posts: [{ id: "999", url: "https://x.com/other/status/999" }],
    },
    { ...capture, url: "https://x.com/other/status/999" },
  ]) {
    assert.throws(() => validateCapture(changed, url, url, "thread"));
  }
  assert.throws(() =>
    validateCapture(capture, url, "https://x.com/other/status/999", "thread"),
  );
});
test("a selected Zhihu answer is allowed on its source question page", () => {
  const source = "https://www.zhihu.com/question/12";
  const answer = "https://www.zhihu.com/question/12/answer/34";
  assert.doesNotThrow(() =>
    validateCapture(
      {
        sourceUrl: source,
        url: answer,
        platform: "zhihu",
        scope: { rootPostId: "34" },
        posts: [{ id: "34", url: answer }],
      },
      source,
      source,
      "thread",
    ),
  );
});
test("storage read and write remain optional when the browser denies access", () => {
  const unavailable = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  assert.equal(readLocal("view", "web", unavailable), "web");
  assert.equal(writeLocal("view", "x", unavailable), false);
});
