/** Render real application screens with deterministic sample saves for product docs. */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fixtureBridge } from "./fixture-bridge.mjs";
import { staticServer } from "./dev.mjs";
import { launchBrowser } from "./browser.mjs";
import assert from "node:assert/strict";
const root = ".test-data/screenshots";
await rm(root, { recursive: true, force: true });
await mkdir("docs/images", { recursive: true });
const bridge = await fixtureBridge(root);
const server = await staticServer(bridge.connection);
const auth = {
  Authorization: "Bearer " + bridge.connection.token,
  "Content-Type": "application/json",
};
const post = async (endpoint, body, method = "POST") =>
  (
    await fetch(bridge.connection.base + endpoint, {
      method,
      headers: auth,
      body: JSON.stringify(body),
    })
  ).json();
const prefs = await (
  await fetch(bridge.connection.base + "/api/preferences", { headers: auth })
).json();
await post("/api/preferences", { ...prefs, language: "en" }, "PUT");
const wallpaper = await readFile("app/wallpaper.svg", "utf8");
const mountain = await readFile("tests/fixtures/note-cover.svg", "utf8");
const svgData = (svg) => "data:image/svg+xml," + encodeURIComponent(svg);
const image = {
  type: "image",
  url: svgData(wallpaper),
  alt: "A quiet alpine lake",
};
const base = {
  version: 2,
  capturedAt: "2026-10-16T09:30:00.000Z",
  resources: [],
  tags: ["Inspiration"],
};
const folder = await post("/api/folders", {
  name: "Fieldnotes",
  parentId: null,
});
await post("/api/items", {
  ...base,
  platform: "web",
  mode: "page",
  folderId: folder.id,
  title: "Make room for what matters",
  url: "https://example.com/fieldnotes",
  text: "A slower approach to collecting ideas, one meaningful page at a time.",
  posts: [],
  content: `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#faf9f6;color:#304247;font-family:Georgia,serif}header{display:flex;justify-content:space-between;padding:28px 6%;font:12px system-ui;letter-spacing:3px;border-bottom:1px solid #dfe5df}article{max-width:820px;margin:40px auto;padding:0 30px}.hero{width:100%;height:270px;object-fit:cover;border-radius:3px}small{font:10px system-ui;letter-spacing:3px;color:#8b9791}h1{font-size:44px;font-weight:400;letter-spacing:-1.5px;margin:22px 0}p{font-size:17px;line-height:1.9;color:#6a7772}blockquote{border-left:2px solid #b6c7b8;padding:6px 22px;margin:24px 0;font-size:22px;line-height:1.7;color:#60766c}</style></head><body><header><b>FIELDNOTES</b><span>STORIES &nbsp; DESIGN &nbsp; EVERYDAY</span></header><article><small>A NOTE ON ATTENTION</small><h1>Make room for what matters.</h1><img class="hero" src="${svgData(wallpaper)}" alt="Alpine lake"><p>Some pages are worth returning to. A thoughtful essay, a generous conversation, a small idea that changes the way you see your work.</p><blockquote>Collect less noise.<br>Keep more of what stays with you.</blockquote><p>A personal library grows one meaningful page at a time.</p></article></body></html>`,
});
for (const [i, text] of [
  "Small tools, lasting ideas.\n\nI have been thinking about how the best software gets out of your way. A clear layout, a good default, and room to focus on what matters.",
  "A useful design question: what can we remove while keeping everything you need?\n\nSaving this conversation as a reminder to keep things simple.",
  "Building a reading collection that feels personal: essays, research notes, and the occasional conversation worth coming back to.",
].entries())
  await post("/api/items", {
    ...base,
    platform: "x",
    mode: "thread",
    title: text.slice(0, 60),
    text,
    url: "https://x.com/sample/status/" + (100 + i),
    posts: [
      {
        id: "x" + i,
        authorName: ["Lin Chen", "Alex Morgan", "Maya Lee"][i],
        authorHandle: ["@lincreates", "@alexbuilds", "@mayareads"][i],
        text,
        media: i === 0 ? [image] : [],
        stats: {
          likes: ["128", "64", "92"][i],
          replies: "12",
          reposts: "8",
          views: "2.4K",
        },
      },
      {
        id: "reply" + i,
        isComment: true,
        authorName: "Noah",
        text: "This is the kind of detail that makes a tool feel considered.",
        media: [],
        stats: { likes: "16" },
      },
    ],
  });
for (const [i, title] of [
  "What makes a personal archive genuinely useful?",
  "Show your personal side projects. What are you building?",
  "How do you keep track of research worth revisiting?",
].entries())
  await post("/api/items", {
    ...base,
    platform: "reddit",
    mode: "thread",
    title,
    text: title,
    url:
      "https://www.reddit.com/r/" +
      ["digitalgardens", "webdev", "research"][i] +
      "/comments/sample" +
      i,
    posts: [
      {
        id: "r" + i,
        authorName: ["gardenbuilder", "lincreates", "mayareads"][i],
        community: ["digitalgardens", "webdev", "research"][i],
        title,
        text: [
          "A collection becomes useful when you can return to the original context: the layout, the conversation, and the idea that made you save it in the first place.",
          "Small tools often start with a very personal need. Share something you have been working on.",
          "I am building a library of papers, articles and useful discussions. Curious how everyone organizes their saved reading.",
        ][i],
        media: [],
        stats: {
          votes: ["246", "384", "127"][i],
          comments: ["38", "62", "29"][i],
        },
      },
      {
        id: "rc" + i,
        isComment: true,
        authorName: "quietreader",
        text: "Context is everything. I want to remember why something mattered, not just keep its URL.",
        media: [],
        depth: 0,
        stats: { votes: "28" },
      },
    ],
  });
for (const [i, title] of [
  "A quiet weekend in the mountains",
  "The long way home",
  "A little room to breathe",
  "Notes from the lakeside",
  "A slower kind of morning",
].entries()) {
  let cover = mountain.replace(
    'height="850"',
    `height="${[850, 640, 920, 760, 590][i]}"`,
  );
  if (i % 2)
    cover = cover
      .replaceAll("#6d8e81", "#8a93a9")
      .replaceAll("#486e62", "#626d89")
      .replaceAll("#b7cfc2", "#c6d0db");
  await post("/api/items", {
    ...base,
    platform: "xiaohongshu",
    mode: "thread",
    title,
    text: title,
    url: "https://www.xiaohongshu.com/explore/sample" + i,
    posts: [
      {
        id: "n" + i,
        title,
        authorName: ["Lin", "Maya", "Alex", "Noah", "June"][i],
        text: "A few moments from the weekend.\n\nWalk slowly, look closely, and keep a little of the day for yourself. #Outdoors #Everyday",
        media: [{ type: "image", url: svgData(cover), alt: title }, image],
        stats: { likes: "108", saves: "42", comments: "1" },
      },
      {
        id: "nc" + i,
        isComment: true,
        authorName: "Maya",
        text: "Such a peaceful place to spend an afternoon.",
        media: [],
        stats: { likes: "12" },
        depth: 1,
      },
    ],
  });
}
const browser = await launchBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:1420");
  await page.locator("#saved-page").waitFor();
  await page.addStyleTag({ url: "/test-fonts/400.css" });
  await page.addStyleTag({
    content:
      "body,button,input,select{font-family:'Noto Sans SC',sans-serif!important}",
  });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "docs/images/webpages.jpg",
    type: "jpeg",
    quality: 90,
  });
  for (const kind of ["x", "reddit", "xiaohongshu"]) {
    await page.locator(`[data-view="${kind}"]`).click();
    await page
      .locator(
        kind === "x"
          ? ".x-post"
          : kind === "reddit"
            ? ".reddit-post"
            : ".note-post",
      )
      .first()
      .waitFor();
    await page.waitForTimeout(350);
    await page.screenshot({
      path: `docs/images/${kind}.jpg`,
      type: "jpeg",
      quality: 90,
    });
  }
  await page.locator(".note-post").first().click();
  await page.locator(".note-gallery img").first().waitFor();
  await page.waitForTimeout(350);
  await page.screenshot({
    path: "docs/images/note-reader.jpg",
    type: "jpeg",
    quality: 90,
  });
  await page.locator("#settings").click();
  await page.getByLabel("Language", { exact: true }).waitFor();
  await page.screenshot({
    path: "docs/images/languages.jpg",
    type: "jpeg",
    quality: 90,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Rendered six English product screenshots from the real application.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await new Promise((r) => bridge.server.close(r));
}
