/** Real UI navigation against a local fixture archive; capture is covered separately. */
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { rm, mkdir } from "node:fs/promises";
import { fixtureBridge } from "../scripts/fixture-bridge.mjs";
import { staticServer } from "../scripts/dev.mjs";
import { launchBrowser } from "../scripts/browser.mjs";

const root = ".test-data/social-navigation";
await rm(root, { recursive: true, force: true });
const bridge = await fixtureBridge(root);
const server = await staticServer(bridge.connection);
const browser = await launchBrowser();
const kinds = ["x", "reddit", "xiaohongshu", "zhihu"];
const call = async (endpoint, body, method = "POST") => {
  const response = await fetch(bridge.connection.base + endpoint, {
    method,
    headers: {
      Authorization: "Bearer " + bridge.connection.token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok, await response.clone().text());
  return response.json();
};
try {
  const prefs = await call("/api/preferences", undefined, "GET");
  await call("/api/preferences", { ...prefs, language: "zh-CN" }, "PUT");
  for (const kind of kinds) {
    for (const name of [
      "研读 & <摘录>",
      "备用",
      ...Array.from({ length: 6 }, (_, i) => "长标签分类" + i),
      "独有-" + kind,
    ])
      await call("/api/tags", { platform: kind, name });
    for (let index = 0; index < 2; index++)
      await call("/api/items", {
        version: 2,
        platform: kind,
        mode: "thread",
        title: `${kind} 阅读内容 ${index}`,
        url: `https://${kind === "x" ? "x.com/a/status" : kind === "reddit" ? `www.reddit.com/r/${index ? "programming" : "books"}/comments` : kind === "zhihu" ? "www.zhihu.com/question/100/answer" : "www.xiaohongshu.com/explore"}/${100 + index}`,
        capturedAt: new Date().toISOString(),
        text: "保存值得回看的正文与讨论。",
        resources: [],
        tags: [index ? "备用" : "研读 & <摘录>"],
        posts: [
          {
            id: "root",
            authorName: "阅读者",
            title: `${kind} 阅读内容 ${index}`,
            text: "保存值得回看的正文与讨论。",
            media: [],
            stats: { votes: String(index), likes: String(index) },
          },
          {
            id: "comment",
            isComment: true,
            text: "归档的讨论。",
            authorName: "读者",
            media: [],
          },
        ],
      });
  }
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:1420");
  await page.addStyleTag({ url: "/test-fonts/400.css" });
  await page.addStyleTag({
    content:
      "body,button,input{font-family:'Noto Sans SC',sans-serif!important}",
  });
  await page.evaluate(() => document.fonts.ready);
  await mkdir("artifacts", { recursive: true });
  for (const kind of kinds) {
    await page.locator(`[data-view="${kind}"]`).click();
    const cards = page.locator("#saved-posts [data-open-archive]");
    await expect(cards).toHaveCount(2);
    await expect(
      page.getByRole("tab", { name: "全部收藏", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    if (kind !== "reddit") {
      const titleOrTab = kind === "x"
        ? page.locator(".x-feed-title")
        : page.getByRole("tab", { name: "全部收藏", exact: true });
      const sort = page.locator('[data-social-action="sort-recent"]');
      const titleBox = await titleOrTab.boundingBox();
      const sortBox = await sort.boundingBox();
      assert.ok(titleBox && sortBox);
      assert.ok(Math.abs(titleBox.y + titleBox.height / 2 - (sortBox.y + sortBox.height / 2)) < 20, "sort controls should share the All saves row");
    } else {
      await expect(page.locator(".reddit-sort-bar")).toBeVisible();
    }
    assert.equal(
      await page
        .locator(
          ".saved-tags,.saved-community,.zhihu-heading,.reddit-saved-heading,.x-bookmarks-title,.note-collection-heading",
        )
        .count(),
      0,
    );
    for (const other of kinds.filter((k) => k !== kind))
      await expect(
        page.getByRole("tab", { name: "独有-" + other, exact: true }),
      ).toHaveCount(0);
    await page.getByRole("tab", { name: "研读 & <摘录>", exact: true }).click();
    await expect(cards).toHaveCount(1);
    if (kind === "reddit") {
      const community = (name) => page.locator('.saved-communities [data-social-action="community"][data-community="' + name + '"]');
      await expect(community("books")).toBeVisible();
      await expect(community("programming")).toBeVisible();
      await community("programming").click();
      await expect(cards).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "研读 & <摘录>", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(community("programming")).toHaveClass(/active/);
      await community("books").click();
      await expect(cards).toHaveCount(1);
      await page.getByRole("tab", { name: "备用", exact: true }).click();
      await expect(cards).toHaveCount(0);
      await expect(community("books")).toHaveClass(/active/);
      await community("programming").click();
      await expect(cards).toHaveCount(1);
      await community("").click();
      await page.getByRole("tab", { name: "研读 & <摘录>", exact: true }).click();
      await expect(cards).toHaveCount(1);
    }
    if (kind === "reddit" || kind === "zhihu")
      await page.locator('[data-social-action="sort-best"]').click();
    await cards.first().click();
    await expect(page.locator(".discussion-back")).toBeVisible();
    // X and Reddit keep their tag navigation in the sidebar on detail pages;
    // Xiaohongshu and Zhihu hide their top tabs while a detail is open.
    await expect(page.getByRole("tablist")).toHaveCount(
      kind === "x" || kind === "reddit" ? 1 : 0,
    );
    await expect(page.locator(".discussion-back")).not.toContainText(
      /份收藏|篇笔记|我的收藏/,
    );
    await page.screenshot({ path: `artifacts/${kind}-detail-navigation.png` });
    await page.getByRole("button", { name: "返回收藏", exact: true }).click();
    await expect(cards).toHaveCount(1);
    const selected = page.getByRole("tab", {
      name: "研读 & <摘录>",
      exact: true,
    });
    await expect(selected).toHaveAttribute("aria-selected", "true");
    if (kind === "reddit" || kind === "zhihu")
      await expect(
        page.locator('[data-social-action="sort-best"]'),
      ).toHaveClass(/active/);
    await selected.focus();
    await selected.press("End");
    await expect(page.locator(".social-empty.tag-empty")).toHaveText("此标签下暂无收藏。");
    await expect(page.locator(".social-empty.tag-empty").locator("strong,p")).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "独有-" + kind, exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Home");
    await expect(cards).toHaveCount(2);
    await expect(
      page.getByRole("tab", { name: "全部收藏", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "新建标签", exact: true }).click();
    await page.locator("#catalog-tag-name").fill("新建-" + kind);
    await page.getByRole("button", { name: "创建标签", exact: true }).click();
    await expect(
      page.getByRole("tab", { name: "新建-" + kind, exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `artifacts/${kind}-collection-tabs.png` });
    await page.setViewportSize({ width: 900, height: 900 });
    if (kind === "x" || kind === "reddit") {
      // These platforms use a vertical sidebar, not a horizontal tab strip.
      assert.ok(
        await page.locator(".sidebar-tag-section .collection-tabs").evaluate(
          (el) => el.scrollWidth <= el.clientWidth + 2,
        ),
        "sidebar tags must not overflow horizontally",
      );
    } else {
      assert.ok(
        await page.locator(".collection-tabs").evaluate(
          (el) => el.scrollWidth > el.clientWidth,
        ),
        "long top tag lists must scroll inside the tab strip",
      );
    }
    assert.ok(
      await page
        .locator("#reader")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
      "tabs must not overflow the reading pane",
    );
    await page.screenshot({
      path: `artifacts/${kind}-collection-tabs-narrow.png`,
    });
    await page.setViewportSize({ width: 1440, height: 960 });
    console.log(
      "PASS collection tabs: filtering, scoped tags, detail/back, keyboard, empty state, creation and narrow layout: " +
        kind,
    );
  }
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "新建-zhihu", exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => bridge.server.close(resolve));
}
