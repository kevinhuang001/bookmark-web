import { platform, adapterFor, extractPost } from "./adapters.js";
import { serializeElement, snapshotDocument, escapeHtml } from "./serialize.js";
export async function collect({ mode = "page", maxPosts = 100 } = {}) {
  const kind = platform(location.hostname);
  const config = adapterFor(kind);
  const warnings = [];
  const resources = new Set();
  const posts = new Map();
  const fragments = new Map();
  const originals = new Map();
  const originalScroll = scrollY;
  const limit = kind === "reddit" ? 100000 : maxPosts;
  function accumulate(elements) {
    for (const element of elements) {
      const post = extractPost(element, kind);
      if (posts.has(post.id) || posts.size >= limit) continue;
      if (
        kind === "reddit" &&
        element.parentElement?.closest(config.selector)
      ) {
        posts.set(post.id, post);
        continue;
      }
      const capture = serializeElement(element);
      posts.set(post.id, post);
      fragments.set(post.id, capture.html);
      originals.set(post.id, element.outerHTML);
      capture.resources.forEach((r) => resources.add(r));
      warnings.push(...capture.warnings);
    }
  }
  let parts;
  if (mode === "thread" && kind !== "web") {
    if (kind === "x" && !/\/status\/\d+/.test(location.pathname))
      throw new Error("请先打开一条 X 帖子的详情页");
    if (kind === "reddit" && !/\/comments\//.test(location.pathname))
      throw new Error("请先打开 Reddit 讨论详情页");
    let unchanged = 0;
    do {
      const previous = posts.size;
      accumulate(document.querySelectorAll(config.selector));
      if (kind === "reddit" || posts.size >= limit) break;
      unchanged = posts.size === previous ? unchanged + 1 : 0;
      if (unchanged >= 5) break;
      window.scrollBy(0, Math.max(600, innerHeight * 0.8));
      await new Promise((resolve) => setTimeout(resolve, 900));
    } while (posts.size < limit);
    window.scrollTo(0, originalScroll);
    if (!posts.size)
      throw new Error("没有识别到帖子，请等待页面加载，或使用区域收藏");
    const shell = document.querySelector(config.selector)?.parentElement;
    if (shell) {
      const style = getComputedStyle(shell);
      const shellStyle = [
        "width",
        "max-width",
        "padding",
        "box-sizing",
        "border-left",
        "border-right",
        "background-color",
      ]
        .map((key) => `${key}:${style.getPropertyValue(key)}`)
        .join(";");
      parts = [
        `<div style="${escapeHtml(shellStyle)};margin:0 auto;max-width:100%">${[...fragments.values()].join("")}</div>`,
      ];
    } else parts = [...fragments.values()];
    warnings.push(
      kind === "x"
        ? `保存了 ${posts.size} 条已加载帖子；隐藏、受限或未加载的回复不包含在内`
        : `保存了 ${posts.size} 个已加载主帖/评论；折叠及未加载评论不包含在内`,
    );
  } else {
    const roots =
      mode === "selection"
        ? globalThis.__glassmarkSelection || []
        : [document.body];
    if (!roots.length || roots.some((el) => !el.isConnected))
      throw new Error("选择已失效，请重新选择区域");
    parts = roots.map((el) => {
      const capture = serializeElement(el);
      capture.resources.forEach((r) => resources.add(r));
      warnings.push(...capture.warnings);
      return capture.html;
    });
    if (kind !== "web")
      for (const element of document.querySelectorAll(config.selector)) {
        if (!roots.some((root) => root.contains(element))) continue;
        const post = extractPost(element, kind);
        if (!posts.has(post.id)) posts.set(post.id, post);
      }
  }
  // Preserve the font faces actually loaded by this page, including their sources.
  let fontCss = "";
  const loaded = [...document.fonts].filter((face) => face.status === "loaded");
  const visit = (rules, base) => {
    for (const rule of rules) {
      if (
        rule.type === CSSRule.FONT_FACE_RULE &&
        loaded.some(
          (face) =>
            face.family.replace(/["']/g, "") ===
              rule.style.getPropertyValue("font-family").replace(/["']/g, "") &&
            face.unicodeRange.toLowerCase() ===
              rule.style.getPropertyValue("unicode-range").toLowerCase(),
        )
      ) {
        fontCss += rule.cssText.replace(
          /url\(["']?([^"')]+)["']?\)/g,
          (_, value) => {
            const url = new URL(value, base).href;
            if (!url.startsWith("data:")) resources.add(url);
            return `url("${url}")`;
          },
        );
      } else if (rule.cssRules) visit(rule.cssRules, base);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules, sheet.href || document.baseURI);
    } catch {
      warnings.push(
        "部分跨域样式表无法直接读取字体声明，原始 CSS 仍会尝试归档",
      );
    }
  }
  const sourceResources = [
    ...document.querySelectorAll('script[src],link[rel="stylesheet"]'),
  ].map((el) => el.src || el.href);
  for (const entry of performance.getEntriesByType("resource"))
    if (
      entry.initiatorType === "script" ||
      /\.(?:m?js|css)(?:$|\?)/.test(entry.name)
    )
      sourceResources.push(entry.name);
  if (document.querySelector("iframe"))
    warnings.push("跨域嵌入框架未展开归档，请单独打开其中的页面收藏");
  warnings.push(
    "归档保存当前已加载内容；服务端接口、未加载的动态模块和受限资源不保证可离线运行",
  );
  const rawParts =
    mode === "thread" && kind !== "web"
      ? [...originals.values()]
      : mode === "selection"
        ? (globalThis.__glassmarkSelection || []).map((el) => el.outerHTML)
        : null;
  const original =
    "<!doctype html>\n" +
    (rawParts
      ? "<html><head>" +
        document.head.innerHTML +
        "</head><body>" +
        rawParts.join("\n") +
        "</body></html>"
      : document.documentElement.outerHTML);
  return {
    version: 1,
    title: document.title || location.hostname,
    url: location.href,
    platform: kind,
    mode,
    capturedAt: new Date().toISOString(),
    text:
      mode === "thread"
        ? [...posts.values()].map((p) => p.text).join("\n\n")
        : (mode === "selection"
            ? globalThis.__glassmarkSelection
            : [document.body]
          )
            .map((el) => el.innerText)
            .join("\n\n"),
    snapshot: snapshotDocument(
      parts,
      document.title,
      getComputedStyle(document.body).backgroundColor,
    ).replace("</head>", `<style>${fontCss}</style></head>`),
    original,
    resources: [...new Set([...resources, ...sourceResources])],
    posts: [...posts.values()],
    warnings: [...new Set(warnings)],
    scope: { maxPosts, capturedPosts: posts.size },
  };
}
