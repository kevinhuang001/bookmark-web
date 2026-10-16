import { mkdir, rm, cp, writeFile, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const base = {
  manifest_version: 3,
  name: "Glassmark",
  version,
  default_locale: "en",
  description: "__MSG_extensionDescription__",
  permissions: ["activeTab", "scripting", "storage"],
  host_permissions: ["<all_urls>"],
  content_scripts: [
    {
      matches: [
        "https://x.com/*",
        "https://*.x.com/*",
        "https://twitter.com/*",
        "https://*.twitter.com/*",
        "https://www.xiaohongshu.com/*",
        "https://zhihu.com/*",
        "https://*.zhihu.com/*",
        "https://reddit.com/*",
        "https://*.reddit.com/*",
      ],
      js: ["observe-media.js"],
      run_at: "document_start",
    },
  ],
  action: {
    default_popup: "popup.html",
    default_title: "__MSG_saveToGlassmark__",
  },
  icons: { 48: "icons/48.png", 128: "icons/128.png" },
};
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("app", "dist/app", { recursive: true });
await cp("licenses", "dist/app/licenses", { recursive: true });
await mkdir("dist/app/vendor", { recursive: true });
await cp("node_modules/hls.js/dist/hls.mjs", "dist/app/vendor/hls.mjs");
await cp("node_modules/hls.js/LICENSE", "dist/app/licenses/HLS.js-LICENSE.txt");
for (const browser of ["chromium", "firefox"]) {
  const out = `dist/extension-${browser}`;
  await mkdir(out + "/pages", { recursive: true });
  const browserMessages = {
    en: {
      extensionDescription:
        "Save webpages, X threads, Reddit discussions Xiaohongshu notes and Zhihu answers to your desktop.",
      saveToGlassmark: "Save to Glassmark",
    },
    zh_CN: {
      extensionDescription:
        "将网页、X 帖子、Reddit 讨论、小红书笔记和知乎回答保存到桌面客户端。",
      saveToGlassmark: "收藏到 Glassmark",
    },
    ja: {
      extensionDescription:
        "ウェブページ、Xのスレッド、Redditの議論、小紅書のノート、知乎の回答をデスクトップに保存。",
      saveToGlassmark: "Glassmarkに保存",
    },
  };
  for (const [language, messages] of Object.entries(browserMessages)) {
    await mkdir(`${out}/_locales/${language}`, { recursive: true });
    await writeFile(
      `${out}/_locales/${language}/messages.json`,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(messages).map(([key, message]) => [key, { message }]),
        ),
      ),
    );
  }

  for (const name of ["background.js", "observe-media.js"])
    await cp("extension/src/" + name, out + "/" + name);
  for (const name of ["api", "archive", "hls"])
    await build({
      entryPoints: [`extension/src/${name}.js`],
      bundle: true,
      format: "esm",
      outfile: `${out}/${name}.js`,
      target: "es2022",
    });
  await build({
    entryPoints: ["extension/src/picker.js"],
    bundle: true,
    format: "iife",
    outfile: out + "/picker.js",
    target: "es2022",
  });
  for (const name of ["popup", "capture"])
    await build({
      entryPoints: [`extension/src/pages/${name}.js`],
      bundle: true,
      format: "esm",
      outfile: `${out}/pages/${name}.js`,
      target: "es2022",
    });
  await cp("licenses", out + "/licenses", { recursive: true });
  for (const name of ["popup", "capture"])
    await cp(`extension/src/pages/${name}.html`, `${out}/${name}.html`);
  await cp("extension/src/pages/extension.css", out + "/extension.css");
  await build({
    entryPoints: ["extension/src/capture/content.js"],
    bundle: true,
    format: "iife",
    globalName: "GlassmarkCapture",
    outfile: out + "/content.js",
    target: "es2022",
  });
  // Both browsers use classic background files; Chrome runs it as a service worker.
  const manifest = {
    ...base,
    background:
      browser === "chromium"
        ? { service_worker: "background.js" }
        : { scripts: ["background.js"] },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "glassmark@glassmark.app",
              strict_min_version: "140.0",
              data_collection_permissions: {
                required: ["websiteContent"],
                optional: [],
              },
            },
          },
        }
      : {}),
  };
  await writeFile(out + "/manifest.json", JSON.stringify(manifest, null, 2));
  await cp("assets/icons", out + "/icons", { recursive: true });
  execFileSync(process.platform === "win32" ? "python" : "python3", [
    "scripts/zip.py",
    out,
    `dist/glassmark-${browser}.zip`,
  ]);
}
console.log(
  "Built desktop frontend and Chromium / Firefox extension packages.",
);
