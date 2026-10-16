import { t as tr, localizeError } from "./i18n.js";
let connection;
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
  const response = await fetch(connection.base + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + connection.token,
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
export const json = async (path, options) =>
  (await request(path, options)).json();
export const mutate = (path, body, method = "POST") =>
  json(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
