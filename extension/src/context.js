import { platform } from "./capture/adapters.js";
/** URL scope is deliberately independent of the site's surrounding page chrome. */
export function pageContext(value) {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol))
      return { supported: false, platform: "web", isPost: false };
    const site = platform(u.hostname);
    const match =
      site === "x"
        ? u.pathname.match(/^\/(?:i\/web|[^/]+)\/status\/(\d+)(?:\/|$)/)
        : site === "reddit"
          ? u.pathname.match(/\/comments\/([a-z\d]+)(?:\/|$)/i)
          : null;
    return {
      supported: true,
      platform: site,
      isPost: !!match,
      postId: match?.[1] || null,
      url: u.href,
      host: u.hostname.replace(/^www\./, ""),
    };
  } catch {
    return { supported: false, platform: "web", isPost: false };
  }
}
