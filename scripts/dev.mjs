import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fixtureBridge } from "./fixture-bridge.mjs";
export async function staticServer(connection) {
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".json": "application/json",
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost:1420");
      if (url.pathname === "/__dev/connection") {
        if (!connection) {
          res.writeHead(404);
          return res.end();
        }
        if (
          req.headers.origin &&
          !["http://localhost:1420", "http://127.0.0.1:1420"].includes(
            req.headers.origin,
          )
        ) {
          res.writeHead(403);
          return res.end();
        }
        res.setHeader("Cache-Control", "no-store");
        return res.end(JSON.stringify(connection));
      }
      let file =
        url.pathname === "/"
          ? "app/index.html"
          : url.pathname.startsWith("/fixtures/")
            ? "tests" + url.pathname
            : url.pathname.startsWith("/test-fonts/")
              ? "node_modules/@fontsource/noto-sans-sc/" +
                url.pathname.slice(12)
              : url.pathname.startsWith("/extension/")
                ? "dist/extension-chromium/" + url.pathname.slice(11)
                : "app" + url.pathname;
      const resolved = path.resolve(file);
      if (!resolved.startsWith(process.cwd() + path.sep))
        throw new Error("Invalid path");
      const bytes = await readFile(resolved);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      });
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(1420, "127.0.0.1", resolve);
  });
  return server;
}
if (import.meta.url === "file://" + process.argv[1]) {
  const demo = process.argv.includes("--demo");
  let connection;
  if (demo) {
    const bridge = await fixtureBridge(
      process.env.GLASSMARK_DATA || ".test-data/demo",
    );
    connection = bridge.connection;
    console.log(
      "DEMO: using a fixture bridge, not the production Rust backend.",
    );
  }
  await staticServer(connection);
  console.log("Glassmark frontend: http://localhost:1420");
}
