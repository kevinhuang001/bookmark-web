import { mkdir, rm, cp, writeFile, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const base = {
  manifest_version: 3,
  name: "Glassmark",
  version,
  description:
    "Archive pages, selected regions, X threads and Reddit discussions to your desktop.",
  permissions: ["activeTab", "scripting", "storage"],
  host_permissions: ["<all_urls>"],
  action: { default_popup: "popup.html", default_title: "收藏到 Glassmark" },
  icons: { 48: "icons/48.png", 128: "icons/128.png" },
};
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("app", "dist/app", { recursive: true });
await cp("licenses", "dist/app/licenses", { recursive: true });
for (const browser of ["chromium", "firefox"]) {
  const out = `dist/extension-${browser}`;
  await mkdir(out + "/pages", { recursive: true });
  for (const name of ["api.js", "archive.js", "background.js", "picker.js"])
    await cp("extension/src/" + name, out + "/" + name);
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
