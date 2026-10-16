import { localizeError } from "../../app/i18n.js";
export const api = globalThis.browser || globalThis.chrome;
export const BASE = "http://127.0.0.1:47831";
export async function credentials() {
  return (await api.storage.local.get("connection")).connection;
}
export async function request(path, options = {}) {
  const connection = await credentials();
  const response = await fetch(BASE + path, {
    ...options,
    headers: {
      ...(connection ? { Authorization: "Bearer " + connection.token } : {}),
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    let error = await response.text();
    try {
      error = JSON.parse(error).error || error;
    } catch {}
    throw new Error(localizeError(error) || `HTTP ${response.status}`);
  }
  return response;
}
export async function connected() {
  try {
    return (await request("/api/status")).ok;
  } catch {
    return false;
  }
}
