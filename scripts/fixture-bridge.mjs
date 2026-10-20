/** Development/test substitute only. Production always uses glassmark-core (Rust).
 * Deliberately reports fixture mode; it never performs or claims WebDAV sync.
 */
import http from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
export async function fixtureBridge(root) {
  await mkdir(root, { recursive: true });
  let db = {
    items: [],
    preferences: {
      language: "system",
      visiblePlatforms: ["web", "x", "reddit", "xiaohongshu", "zhihu"],
      maxPosts: 100,
      autoLoadSeconds: 20,
      downloadLimitMb: 500,
      downloadConcurrency: 6,
      imageTimeoutSeconds: 15,
      videoTimeoutSeconds: 90,
      resourceLimit: 2000,
      includeImages: true,
      includeAvatars: true,
      includeVideos: true,
      showSavedTime: true,
      showMediaStats: true,
      confirmDelete: true,
      defaultFolderId: null,
    },
    folders: [],
    tags: [],
    settings: { mode: "webdav", localPath: "", intervalSeconds: 60, url: "", username: "", password: "" },
    devices: [],
  };
  try {
    db = JSON.parse(await readFile(root + "/fixture-state.json", "utf8"));
  } catch {}
  const token = randomBytes(32).toString("hex");
  let pairing = { code: "381624", attempts: 0, expires: Date.now() + 300000 };
  const base = "http://127.0.0.1:47831";
  const persist = () =>
    writeFile(root + "/fixture-state.json", JSON.stringify(db, null, 2));
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || "";
    const trusted =
      !origin ||
      /^(chrome-extension|moz-extension):\/\/[\w-]+$/.test(origin) ||
      ["http://localhost:1420", "http://127.0.0.1:1420"].includes(origin);
    if (
      !trusted ||
      !["127.0.0.1:47831", "localhost:47831"].includes(req.headers.host)
    ) {
      res.writeHead(403);
      return res.end();
    }
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url, base);
    const endpoint = url.pathname;
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      if (endpoint === "/health")
        return send(200, { app: "glassmark", fixture: true });
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const body = () => JSON.parse(bytes.toString() || "{}");
      if (endpoint === "/pair" && req.method === "POST") {
        pairing.attempts++;
        if (
          pairing.attempts > 5 ||
          Date.now() > pairing.expires ||
          body().code !== pairing.code
        )
          return send(401, { error: "配对码不正确或已过期" });
        const device = {
          token: randomBytes(32).toString("hex"),
          name: body().name,
        };
        db.devices.push(device);
        pairing.code = "724981";
        await persist();
        return send(200, { token: device.token });
      }
      const supplied = req.headers.authorization?.replace(/^Bearer /, "");
      const desktop = supplied === token;
      const paired = db.devices.some((d) => d.token === supplied);
      if (!desktop && !paired) return send(401, { error: "Unauthorized" });
      if (
        !desktop &&
        !(
          endpoint === "/api/status" ||
          (endpoint === "/api/capture-options" && req.method === "GET") ||
          (endpoint === "/api/items" && req.method === "POST") ||
          (endpoint.startsWith("/api/blobs/") && req.method === "PUT")
        )
      )
        return send(403, { error: "Forbidden" });
      if (endpoint === "/api/status")
        return send(200, {
          connected: true,
          fixture: true,
          running: false,
          sync: {
            error: (db.settings.mode === "local" ? db.settings.localPath : db.settings.url)
              ? "开发替代服务不执行 WebDAV，请使用 Tauri 客户端验证"
              : null,
          },
        });
      if (endpoint === "/api/conflicts") return send(200, []);
      if (endpoint === "/api/pairing") {
        pairing = { code: "381624", attempts: 0, expires: Date.now() + 300000 };
        return send(200, { code: pairing.code, expiresIn: 300 });
      }
      if (endpoint === "/api/devices") return send(200, db.devices);
      if (endpoint.startsWith("/api/devices/")) {
        db.devices = db.devices.filter(
          (d) => d.token !== endpoint.split("/").at(-1),
        );
        await persist();
        return send(200, { ok: true });
      }
      if (endpoint.startsWith("/api/blobs/")) {
        const name = endpoint.split("/").at(-1);
        if (
          !/^[a-f\d]{64}\.[a-z\d]{1,8}$/.test(name) ||
          createHash("sha256").update(bytes).digest("hex") !==
            name.split(".")[0]
        )
          return send(400, { error: "Invalid digest" });
        await mkdir(root + "/blobs", { recursive: true });
        await writeFile(root + "/blobs/" + name, bytes);
        return send(200, { ok: true });
      }
      if (endpoint === "/api/items" && req.method === "POST") {
        const capture = body();
        const id = randomUUID();
        if (capture.version !== 2 || !/^https?:/.test(capture.url))
          return send(400, { error: "Invalid archive" });
        const dir = root + "/archives/" + id;
        await mkdir(dir + "/assets", { recursive: true });
        for (const r of capture.resources || [])
          if (r.status === "saved")
            await writeFile(
              dir + "/assets/" + r.name,
              await readFile(root + "/blobs/" + r.name),
            );
        if (capture.platform === "web")
          await writeFile(dir + "/content.html", capture.content);
        delete capture.content;
        const item = {
          ...capture,
          id,
          folderId: capture.folderId || null,
          tags: capture.tags || [],
          modifiedAt: new Date().toISOString(),
        };
        db.items.unshift(item);
        await persist();
        return send(200, item);
      }
      if (endpoint === "/api/items") {
        const q = (url.searchParams.get("q") || "").toLowerCase();
        return send(
          200,
          db.items.filter(
            (i) =>
              !i.deleted &&
              [i.title, i.text, i.url, ...i.tags]
                .join(" ")
                .toLowerCase()
                .includes(q),
          ),
        );
      }
      const match = endpoint.match(
        /^\/api\/items\/([\w-]+)(?:\/(content|assets)\/([\w.-]+))?$/,
      );
      if (match) {
        const [, id, kind, file] = match;
        const item = db.items.find((i) => i.id === id);
        if (!item) return send(404, { error: "Not found" });
        if (kind) {
          if (file === "manifest.json") return send(200, item);
          if (kind === "content" && !["content.html"].includes(file))
            return send(400, { error: "Invalid file" });
          if (kind === "assets" && !/^[a-f\d]{64}\.[a-z\d]{1,8}$/.test(file))
            return send(400, { error: "Invalid file" });
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          return res.end(
            await readFile(
              root +
                "/archives/" +
                id +
                "/" +
                (kind === "assets" ? "assets/" : "") +
                file,
            ),
          );
        }
        if (req.method === "DELETE") item.deleted = true;
        else {
          const patch = body();
          for (const key of ["title", "tags", "folderId"])
            if (key in patch) item[key] = patch[key];
        }
        item.modifiedAt = new Date().toISOString();
        await persist();
        return send(200, item);
      }
      if (endpoint === "/api/tags") {
        db.tags ||= [];
        if (req.method === "POST") {
          const tag = { ...body(), id: randomUUID() };
          db.tags.push(tag);
          await persist();
          return send(200, tag);
        }
        return send(200, db.tags);
      }
      if (endpoint === "/api/capture-options")
        return send(200, {
          preferences: db.preferences || {},
          folders: db.folders,
          tags: [
            ...(db.tags || []),
            ...db.items
              .filter((i) => !i.deleted)
              .flatMap((i) =>
                (i.tags || []).map((name) => ({ name, platform: i.platform })),
              ),
          ],
        });
      if (endpoint === "/api/folders" && req.method === "GET")
        return send(200, db.folders);
      if (endpoint === "/api/folders" || endpoint.startsWith("/api/folders/")) {
        const patch = body();
        if (!patch.name?.trim())
          return send(400, { error: "请输入文件夹名称" });
        const id = endpoint.split("/")[3] || randomUUID();
        let parent = patch.parentId;
        const seen = new Set([id]);
        while (parent) {
          if (seen.has(parent))
            return send(400, { error: "文件夹不能形成循环" });
          seen.add(parent);
          parent = db.folders.find((f) => f.id === parent)?.parentId;
        }
        let folder = db.folders.find((f) => f.id === id);
        if (!folder) {
          folder = { id };
          db.folders.push(folder);
        }
        Object.assign(folder, patch);
        await persist();
        return send(200, folder);
      }
      if (endpoint === "/api/preferences") {
        if (req.method === "PUT") {
          db.preferences = body();
          await persist();
          return send(200, { ok: true });
        }
        return send(200, db.preferences || {});
      }
      if (endpoint === "/api/settings") {
        if (req.method === "PUT") {
          const patch = body();
          if (!patch.password) patch.password = db.settings.password;
          db.settings = patch;
          await persist();
          return send(200, { ok: true });
        }
        const { password, ...settings } = db.settings;
        return send(200, { ...settings, defaultLocalPath: path.resolve(root, "content-v2"), hasPassword: !!password });
      }
      if (endpoint === "/api/sync")
        return send(200, {
          error: "开发替代服务不执行 WebDAV，请使用 Tauri 客户端验证",
        });
      send(404, { error: "Not found" });
    } catch (error) {
      send(400, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(47831, "127.0.0.1", resolve);
  });
  return { server, connection: { base, token }, db };
}
