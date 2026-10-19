/** Browser storage is an optional UI preference cache. */
export function readLocal(key, fallback = null, storage) {
  try {
    return (storage || globalThis.localStorage).getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key, value, storage) {
  try {
    (storage || globalThis.localStorage).setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
