/** Exercise the same bundled collector under Firefox's DOM engine. */
import { firefox } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { staticServer } from "../scripts/dev.mjs";
const server = await staticServer();
const browser = await firefox.launch();
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:1420/fixtures/article.html");
  await page.addScriptTag({
    content: await readFile("dist/extension-firefox/content.js", "utf8"),
  });
  const capture = await page.evaluate(() =>
    GlassmarkCapture.collect({ mode: "page" }),
  );
  assert.match(capture.snapshot, /FIELDNOTES/);
  assert.match(capture.original, /article.js/);
  assert.doesNotMatch(capture.snapshot, /<script/);
  const manifest = JSON.parse(
    await readFile("dist/extension-firefox/manifest.json", "utf8"),
  );
  assert.deepEqual(manifest.background, { scripts: ["background.js"] });
  assert.ok(manifest.browser_specific_settings.gecko.id);
  await writeFile(
    "artifacts/firefox-report.json",
    JSON.stringify(
      {
        browser: await browser.version(),
        collector: true,
        manifest: true,
        installedAddon: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS Firefox collector and manifest (not an installed-add-on test)",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
