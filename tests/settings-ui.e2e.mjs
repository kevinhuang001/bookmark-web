import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fixtureBridge } from "../scripts/fixture-bridge.mjs";
import { staticServer } from "../scripts/dev.mjs";
import { launchBrowser } from "../scripts/browser.mjs";
const root = await mkdtemp(path.join(os.tmpdir(), "glassmark-settings-"));
let bridge, native, server, browser;
try {
  let connection;
  if (process.env.GLASSMARK_BRIDGE_BIN) {
    const file = path.join(root, "connection.json");
    native = spawn(path.resolve(process.env.GLASSMARK_BRIDGE_BIN), [], {
      env: {
        ...process.env,
        GLASSMARK_DATA: root,
        GLASSMARK_CONNECTION_FILE: file,
      },
      stdio: "inherit",
    });
    await expect
      .poll(
        async () => {
          try {
            connection = JSON.parse(await readFile(file, "utf8"));
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 10000 },
      )
      .toBe(true);
  } else {
    bridge = await fixtureBridge(root);
    connection = bridge.connection;
  }
  server = await staticServer(connection);
  browser = await launchBrowser();
  const page = await browser.newPage({
    locale: "en-US",
    viewport: { width: 1400, height: 980 },
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let status = { running: false, sync: { lastSync: "2026-10-20T04:10:23Z" } };
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value) => {
          window.copiedSupport = value;
        },
      },
    }),
  );
  await page.goto("http://localhost:1420");
  await expect(page.locator("html")).toHaveAttribute("data-app-ready", "true");
  await page.route("**/api/status", route => route.fulfill({
    headers: {"access-control-allow-origin":"http://localhost:1420", "access-control-allow-headers":"authorization,content-type", "access-control-allow-methods":"GET,OPTIONS"},
    json: {connected:true,...status},
  }));
  await page.locator("#settings").click();
  for (const size of [
    { width: 1400, height: 980 },
    { width: 960, height: 640 },
  ]) {
    await page.setViewportSize(size);
    const trigger = page.locator(".app-select-trigger").first();
    const row = page.locator(".settings-row").first();
    const [buttonRect, rowRect] = await Promise.all([
      trigger.boundingBox(),
      row.boundingBox(),
    ]);
    assert(
      Math.abs(
        buttonRect.y + buttonRect.height / 2 - rowRect.y - rowRect.height / 2,
      ) < 2,
      "select must be vertically centered in its row",
    );
    await trigger.click();
    const menu = page.locator(".app-select-menu:not([hidden])");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option").last()).toBeInViewport();
    assert(
      await menu
        .getByRole("option")
        .last()
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        }),
      "last option must not be clipped or covered",
    );
    if (size.width === 1400)
      await page.screenshot({ path: "artifacts/settings-menu-fixed.png" });
    await menu.locator('[data-value="en"]').click();
    await trigger.click();
    await page.keyboard.press("Escape");
    const toggle = page.locator(".sync-toggle").first();
    for (const checked of [false, true]) {
      await toggle.setChecked(checked);
      await expect
        .poll(() =>
          toggle.evaluate((el) => {
            const thumb = getComputedStyle(el, "::after");
            const left = parseFloat(thumb.left);
            return Math.round(
              el.checked
                ? el.clientWidth - left - parseFloat(thumb.width)
                : left,
            );
          }),
        )
        .toBe(3);
    }
  }
  await page.setViewportSize({ width: 1400, height: 980 });
  await page.locator('[data-settings-category="about"]').click();
  const address = "0x6bf40ccb46abbc6485778f98c305ba4570854409";
  await expect(page.locator("#support-address")).toHaveText(address);
  await page.locator("#support-copy-address").click();
  assert.equal(await page.evaluate(() => window.copiedSupport), address);
  await expect(page.locator(".support-networks a")).toHaveCount(4);
  await page.locator(".support-card").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/settings-support.png" });
  await page.locator("#dialog-cancel").click();
  status = {
    running: true,
    sync: {
      stage: "upload",
      detail: "archives/example/manifest.json",
      lastSync: "2026-10-20T04:10:23Z",
    },
  };
  await expect(page.locator("#connection-status")).toContainText(
    "manifest.json",
    { timeout: 6000 },
  );
  await expect(page.locator("#sync-button")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  assert.equal(
    await page
      .locator("#sync-button .icon")
      .evaluate((el) => getComputedStyle(el).animationName),
    "sync-rotate",
  );
  await expect(page.locator("#sync-last-time")).toContainText("2026");
  status = { running: false, sync: { lastSync: "2026-10-20T04:12:45Z" } };
  await expect(page.locator("#connection-status")).toHaveText("Sync complete", {
    timeout: 6000,
  });
  await expect(page.locator("#sync-button")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const lastTime = await page.locator("#sync-last-time").textContent();
  status = {
    running: false,
    sync: {
      lastSync: "2026-10-20T04:12:45Z",
      error: "WebDAV MKCOL: 401 Unauthorized",
    },
  };
  await expect(page.locator("#connection-status")).toContainText(
    "401 Unauthorized",
    { timeout: 6000 },
  );
  await expect(page.locator("#sync-last-time")).toHaveText(lastTime);
  assert.deepEqual(errors, []);
  console.log(
    "PASS unclipped centered menus, switch end alignment, Support copy, live sync stages, spinner, timestamps and failure reason",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  if (bridge) await new Promise((r) => bridge.server.close(r));
  native?.kill();
  await rm(root, { recursive: true, force: true });
}
