/** Load the shipped Firefox ZIP as a real temporary add-on, using WebDriver.
 * All Zhihu traffic stays on a local TLS fixture; no live account is involved.
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { firefox } from "@playwright/test";
import { fixtureBridge } from "../scripts/fixture-bridge.mjs";
import { staticServer } from "../scripts/dev.mjs";

const root = path.resolve(".test-data/firefox-extension");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
let bridge, native, staticSite, site, gecko, sid;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wd(method, endpoint, body) {
  const response = await fetch("http://127.0.0.1:4444" + endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data.value;
}
const command = (endpoint, body) =>
  wd("POST", "/session/" + sid + endpoint, body);
const evaluate = (script) => command("/execute/sync", { script, args: [] });
const asyncEvaluate = (script, args = []) =>
  command("/execute/async", { script, args });
async function click(selector) {
  const element = await command("/element", {
    using: "css selector",
    value: selector,
  });
  return command(
    "/element/" + element["element-6066-11e4-a52e-4f735466cecf"] + "/click",
    {},
  );
}
async function until(check, message, seconds = 20) {
  const deadline = Date.now() + seconds * 1000;
  do {
    const value = await check();
    if (value) return value;
    await pause(100);
  } while (Date.now() < deadline);
  throw new Error(message);
}
try {
  if (process.env.GLASSMARK_BRIDGE_BIN) {
    const file = root + "/connection.json";
    native = spawn(path.resolve(process.env.GLASSMARK_BRIDGE_BIN), [], {
      env: {
        ...process.env,
        GLASSMARK_DATA: root + "/archive",
        GLASSMARK_CONNECTION_FILE: file,
      },
      stdio: "inherit",
    });
    bridge = {
      connection: await until(async () => {
        try {
          return JSON.parse(await readFile(file, "utf8"));
        } catch {
          return null;
        }
      }, "Native bridge did not start"),
    };
  } else bridge = await fixtureBridge(root + "/archive");
  const headers = { Authorization: "Bearer " + bridge.connection.token };
  const preferences = await (
    await fetch(bridge.connection.base + "/api/preferences", { headers })
  ).json();
  await fetch(bridge.connection.base + "/api/preferences", {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...preferences,
      language: "zh-CN",
      autoLoadSeconds: 8,
    }),
  });
  const items = async () =>
    (await fetch(bridge.connection.base + "/api/items", { headers })).json();
  staticSite = await staticServer(bridge.connection);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      root + "/key.pem",
      "-out",
      root + "/cert.pem",
      "-days",
      "1",
      "-subj",
      "/CN=www.zhihu.com",
    ],
    { stdio: "ignore" },
  );
  site = https.createServer(
    {
      key: await readFile(root + "/key.pem"),
      cert: await readFile(root + "/cert.pem"),
    },
    async (request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(await readFile("tests/fixtures/zhihu-inline.html"));
    },
  );
  await new Promise((resolve) => site.listen(18443, "127.0.0.1", resolve));
  gecko = spawn(
    process.env.GECKODRIVER_BIN || "geckodriver",
    ["--port", "4444"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  await until(async () => {
    try {
      return await wd("GET", "/status");
    } catch {
      return null;
    }
  }, "geckodriver did not start");
  const uuid = randomUUID();
  const session = await wd("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "firefox",
        acceptInsecureCerts: true,
        "moz:firefoxOptions": {
          binary: firefox.executablePath(),
          args: ["-headless"],
          prefs: {
            "network.dns.localDomains": "www.zhihu.com",
            "network.proxy.type": 0,
            "extensions.webextensions.uuids": JSON.stringify({
              "glassmark@glassmark.app": uuid,
            }),
          },
        },
      },
    },
  });
  sid = session.sessionId;
  await command("/moz/addon/install", {
    path: path.resolve("dist/glassmark-firefox.zip"),
    temporary: true,
  });
  await command("/url", { url: `moz-extension://${uuid}/popup.html` });
  const control = await wd("GET", "/session/" + sid + "/window");
  await asyncEvaluate(
    "const done=arguments[arguments.length-1];browser.storage.local.set({connection:arguments[0]}).then(()=>done(true),error=>done({error:error.message}));",
    [{ token: bridge.connection.token }],
  );
  const version = await evaluate(
    "return browser.runtime.getManifest().version;",
  );
  assert.equal(
    version,
    JSON.parse(await readFile("package.json", "utf8")).version,
  );
  for (const query of [
    "",
    "?preview=1",
    "?opened=1",
    "?staged=1",
    "?unstable=1",
    "?skeleton=1&delay=1200&pageDelay=800",
    "?opened=1&skeleton=1&delay=1200",
    "?staleempty=1&delay=1200",
    "?skeleton=1&blocked=1",
    "?preview=1&blocked=1",
    "?delay=2000&cancel=1",
    "?staged=1&cancel=1",
  ]) {
    await command("/window", { handle: control });
    const before = (await items()).length;
    const url = "https://www.zhihu.com:18443/question/125" + query;
    const source = await asyncEvaluate(
      "const done=arguments[arguments.length-1];browser.tabs.create({url:arguments[0]}).then(done,error=>done({error:error.message}));",
      [url],
    );
    assert.ok(source.id);
    await until(
      async () =>
        asyncEvaluate(
          "const done=arguments[arguments.length-1];const expected=arguments[1];browser.tabs.get(arguments[0]).then(tab=>done(tab.status==='complete' && tab.url===expected));",
          [source.id, url],
        ),
      "Source did not load",
    );
    const ready = await asyncEvaluate(
      `const done=arguments[arguments.length-1];(async()=>{
      const tabId=arguments[0];
      await browser.storage.local.set({['pendingCapture_'+tabId]:{mode:'thread',expectedUrl:arguments[1],tags:[],folderId:null,createdAt:Date.now()}});
      await browser.scripting.executeScript({target:{tabId},func:(seconds)=>{globalThis.__glassmarkPickerMode='zhihu-answer';globalThis.__glassmarkLanguage='zh-CN';globalThis.__glassmarkZhihuOpenSeconds=seconds;},args:[arguments[1].includes('blocked=1')?2:8]});
      await browser.scripting.executeScript({target:{tabId},files:['picker.js']});return true;
    })().then(done,error=>done({error:error.message}));`,
      [source.id, url],
    );
    assert.equal(ready, true);
    let sourceHandle;
    for (const handle of await wd(
      "GET",
      "/session/" + sid + "/window/handles",
    )) {
      await command("/window", { handle });
      if ((await wd("GET", "/session/" + sid + "/url")) === url) {
        sourceHandle = handle;
        break;
      }
    }
    assert.ok(sourceHandle);
    await click(".AnswerItem .RichContent-inner");
    await click("[data-action=done]");
    if (query.includes("cancel=1")) {
      await until(
        () => evaluate("return document.body.dataset.commentClicks==='1';"),
        "Comment button was not clicked before cancellation",
      );
      if (query.includes("staged=1"))
        await until(
          () => evaluate("return !!document.body.dataset.firstBodyAt;"),
          "First comment did not render before cancellation during stabilization",
        );
      await click("[data-action=cancel]");
      await pause(400);
    } else if (/blocked=1|unstable=1/.test(query)) {
      await until(
        () =>
          evaluate(
            "return !!document.querySelector('[data-glassmark-ui] [role=status]')?.textContent.match(/评论未能加载|仍在加载/);",
          ),
        "Failed opening did not report an error on source",
      );
      assert.equal(
        await evaluate("return document.body.dataset.commentClicks;"),
        "1",
      );
    } else {
      const saved = await until(
        async () => (await items()).find((item) => item.sourceUrl === url),
        "Selected answer was not persisted",
      );
      assert.equal(saved.platform, "zhihu");
      if (query.includes("staged=1"))
        assert.equal(
          await evaluate("return document.body.dataset.controlsReady;"),
          "1",
        );
      assert.deepEqual(
        saved.posts.map((post) => post.id),
        ["222", "c1", "c2", "reply1", "reply2", "reply3", "c3"],
      );
      assert.equal(
        await evaluate("return document.body.dataset.commentClicks || null;"),
        query.includes("opened=1") ? null : "1",
      );
      assert.equal(
        await evaluate("return document.body.dataset.allCommentClicks;"),
        "1",
      );
    }
    await command("/window", { handle: control });
    const tabs = await asyncEvaluate(
      "const done=arguments[arguments.length-1];browser.tabs.query({}).then(done);",
      [],
    );
    const captures = tabs.filter(
      (tab) =>
        tab.url?.startsWith(`moz-extension://${uuid}/capture.html`) &&
        new URL(tab.url).searchParams.get("tab") === String(source.id),
    );
    if (/blocked=1|unstable=1|cancel=1/.test(query)) {
      assert.equal((await items()).length, before);
      assert.equal(
        captures.length,
        0,
        "Opening failure or cancellation must not create a capture tab",
      );
    }
    await asyncEvaluate(
      "const done=arguments[arguments.length-1];browser.tabs.remove(arguments[0]).then(()=>done(true));",
      [[source.id, ...captures.map((tab) => tab.id)]],
    );
    console.log(
      "PASS installed Firefox add-on: comment opening, capture ordering and persistence " +
        (query || "closed"),
    );
  }
  const report = JSON.parse(
    await readFile("artifacts/firefox-report.json", "utf8"),
  );
  Object.assign(report, {
    installedAddon: true,
    addonVersion: version,
    installedBrowser: session.capabilities.browserVersion,
    commentsOpenBeforeCapture: true,
    waitsForCommentBodies: true,
    waitsForStableComments: true,
    blockedOpeningPreventsCapture: true,
    cancelOpeningPreventsCapture: true,
    installedAddonBackend: native ? "native-rust" : "fixture",
  });
  await writeFile(
    "artifacts/firefox-report.json",
    JSON.stringify(report, null, 2),
  );
} finally {
  if (sid) await wd("DELETE", "/session/" + sid).catch(() => {});
  gecko?.kill();
  native?.kill();
  await Promise.all(
    [staticSite, site, bridge?.server]
      .filter(Boolean)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
}
