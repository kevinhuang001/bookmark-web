import { t as tr, localizeError } from "./i18n.js";
let connection;
const revisions = new Map();
export async function connect() {
  if (globalThis.__TAURI__) {
    connection = await globalThis.__TAURI__.core.invoke("connection");
  } else {
    const response = await fetch("/__dev/connection");
    if (!response.ok)
      throw new Error(tr("请使用 Tauri 客户端，或运行 npm run dev -- --demo"));
    connection = await response.json();
  }
  // The native bridge starts asynchronously with the window.
  for (let i = 0; i < 30; i++) {
    try {
      await request("/api/status");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(tr("本地服务启动失败，请检查端口 47831 是否被其他程序占用"));
}
export async function request(path, options = {}) {
  const id = path.match(/^\/api\/(?:items|folders)\/([a-z\d-]+)$/)?.[1];
  const expected = revisions.get(id);
  const response = await fetch(connection.base + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + connection.token,
      ...(expected && ["PUT", "DELETE"].includes(options.method)
        ? { "If-Match": expected }
        : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json()).error;
    } catch {}
    throw new Error(
      localizeError(detail) ||
        `${tr("请求失败（{0}）", { 0: response.status })}`,
    );
  }
  return response;
}
export const json = async (path, options) => {
  const result = await (await request(path, options)).json();
  for (const record of Array.isArray(result) ? result : [result])
    if (record?.id && record.revision)
      revisions.set(record.id, record.revision);
  return result;
};
export const mutate = (path, body, method = "POST") =>
  json(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
