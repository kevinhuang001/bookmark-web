import { connect, json, mutate } from "./api.js";
import {
  translateDOM,
  setLanguage,
  localizeError,
  resolveLocale,
} from "./i18n.js";
translateDOM();
try {
  await connect();
  const preferences = await json("/api/preferences");
  const effective = resolveLocale(preferences.language || "system");
  if (preferences.resolvedLanguage !== effective)
    await mutate(
      "/api/preferences",
      { ...preferences, resolvedLanguage: effective },
      "PUT",
    );
  setLanguage(preferences.language || "system");
  translateDOM();
  await import("./main.js");
  document.documentElement.dataset.appReady = "true";
} catch (error) {
  document.getElementById("connection-status").textContent = localizeError(
    error.message,
  );
}
