/** Real installed Chromium MV3 extension against the native Rust bridge (CI).
 * This is separate from the collector/UI tests, which can run on headless_shell.
 */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { staticServer } from "../scripts/dev.mjs";
const root = path.resolve(".test-data/extension");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const file = root + "/connection.json";
const child = spawn(path.resolve(process.env.GLASSMARK_BRIDGE_BIN), [], {
  env: {
    ...process.env,
    GLASSMARK_DATA: root,
    GLASSMARK_CONNECTION_FILE: file,
  },
  stdio: "inherit",
});
let context, server;
try {
  let connection;
  for (let i = 0; i < 100; i++) {
    try {
      connection = JSON.parse(await readFile(file, "utf8"));
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(connection);
  server = await staticServer(connection);
  const ext = path.resolve("dist/extension-chromium");
  context = await chromium.launchPersistentContext(root + "/profile", {
    headless: true,
    channel: "chromium",
    args: ["--disable-extensions-except=" + ext, "--load-extension=" + ext],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator("#pair").waitFor({ state: "visible" });
  const pairing = await (
    await fetch(connection.base + "/api/pairing", {
      method: "POST",
      headers: { Authorization: "Bearer " + connection.token },
    })
  ).json();
  await popup.locator("#code").fill(pairing.code);
  await popup.locator("#pairButton").click();
  await popup.locator("#actions").waitFor({ state: "visible" });
  const source = await context.newPage();
  await source.goto("http://127.0.0.1:1420/fixtures/article.html");
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url.includes("/fixtures/article.html")).id;
  });
  const progress = await context.newPage();
  await progress.goto(
    `chrome-extension://${extensionId}/capture.html?tab=${tabId}&mode=page`,
  );
  await progress
    .getByText("已收藏，留待慢慢读", { exact: true })
    .waitFor({ timeout: 60000 });
  const items = await (
    await fetch(connection.base + "/api/items", {
      headers: { Authorization: "Bearer " + connection.token },
    })
  ).json();
  assert.equal(items.length, 1);
  assert.ok(items[0].resources.some((r) => r.name?.endsWith(".js")));
  const device = await worker.evaluate(
    async () => (await chrome.storage.local.get("connection")).connection,
  );
  assert.ok(device.token);
  assert.equal(
    (
      await fetch(connection.base + "/api/settings", {
        headers: { Authorization: "Bearer " + device.token },
      })
    ).status,
    403,
  );
  // Closing the native client must disable every capture action in the popup.
  child.kill();
  await new Promise((r) => setTimeout(r, 700));
  await popup.reload();
  await popup.locator("#actions").waitFor({ state: "hidden" });
  assert.match(await popup.locator("#status").textContent(), /未连接/);
  await writeFile(
    "artifacts/extension-report.json",
    JSON.stringify(
      {
        installed: true,
        checks: [
          "MV3 worker loads",
          "real pairing",
          "content injection",
          "resource upload",
          "native persistence",
          "scoped token",
          "disabled when client is closed",
        ],
      },
      null,
      2,
    ),
  );
  console.log("PASS real Chromium extension → native Rust bridge");
} finally {
  await context?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
  child.kill();
}
