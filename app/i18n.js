import en from "./locales/en.js";
import zh from "./locales/zh-CN.js";
import ja from "./locales/ja.js";
export const catalogs = { en, "zh-CN": zh, ja };
export const languages = [
  { id: "system", name: "System" },
  { id: "en", name: "English" },
  { id: "zh-CN", name: "简体中文" },
  { id: "ja", name: "日本語" },
];
let preference = "system";
export function resolveLocale(
  value,
  browserLanguage = globalThis.navigator?.language || "en",
) {
  const candidate = value === "system" || !value ? browserLanguage : value;
  if (/^zh(?:-|$)/i.test(candidate)) return "zh-CN";
  if (/^ja(?:-|$)/i.test(candidate)) return "ja";
  return "en";
}
let current = resolveLocale("system");
export const locale = () =>
  ({ en: "en-US", "zh-CN": "zh-CN", ja: "ja-JP" })[current];
export const getLanguage = () => preference;
export function setLanguage(value = "system") {
  preference = languages.some((l) => l.id === value) ? value : "system";
  current = resolveLocale(preference);
  return current;
}
/** Named or indexed placeholders keep translated grammar independent of values. */
export function t(key, values = {}) {
  const entry = catalogs[current][key] ?? en[key] ?? key;
  const template =
    typeof entry === "string"
      ? entry
      : entry[
          new Intl.PluralRules(locale()).select(
            Number(values[entry.count || "count"]),
          )
        ] || entry.other;
  return template.replace(/\{([\w]+)\}/g, (token, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : token,
  );
}
/** Translate only marked application chrome, never archived or user-authored content. */
export function translateDOM(root = document) {
  for (const node of root.querySelectorAll("[data-i18n]"))
    node.textContent = t(node.dataset.i18n);
  for (const attr of ["title", "aria-label", "placeholder", "alt"])
    for (const node of root.querySelectorAll("[data-i18n-" + attr + "]"))
      node.setAttribute(attr, t(node.getAttribute("data-i18n-" + attr)));
  root.documentElement?.setAttribute("lang", current);
}
export function localizeError(value) {
  const text = String(value || "");
  const validation = text.match(/^(.+?)需要在 (\d+)–(\d+) 之间$/);
  if (validation)
    return t("数值范围错误", {
      field: t(validation[1]),
      min: validation[2],
      max: validation[3],
    });
  return t(text);
}
