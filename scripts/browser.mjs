import { chromium } from "@playwright/test";
import {
  existsSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { execFileSync } from "node:child_process";
export async function launchBrowser(options = {}) {
  if (!process.env.GLASSMARK_PORTABLE_CHROMIUM)
    return chromium.launch({ headless: true, ...options });
  const base = new URL(
    "../node_modules/@sparticuz/chromium/bin/",
    import.meta.url,
  ).pathname;
  const out = "/tmp/glassmark-chromium";
  mkdirSync(out, { recursive: true });
  const executablePath = out + "/chromium";
  if (!existsSync(executablePath) || statSync(executablePath).size < 1000000) {
    writeFileSync(
      executablePath,
      brotliDecompressSync(readFileSync(base + "chromium.br")),
    );
    chmodSync(executablePath, 0o755);
  }
  if (!existsSync(out + "/libGLESv2.so")) {
    writeFileSync(
      out + "/swiftshader.tar",
      brotliDecompressSync(readFileSync(base + "swiftshader.tar.br")),
    );
    execFileSync("tar", [
      "--no-same-owner",
      "-xf",
      out + "/swiftshader.tar",
      "-C",
      out,
    ]);
  }
  return chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
    ...options,
  });
}
