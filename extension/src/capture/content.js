import { t as tr, setLanguage } from "../../../app/i18n.js";
import { pageContext } from "../context.js";
import { videoSources } from "./video.js";
import { platform, adapterFor, extractPost } from "./adapters.js";
import { serializeElement, contentDocument, escapeHtml } from "./serialize.js";
export async function collect({
  language = "system",
  mode = "page",
  maxPosts = 100,
  autoLoadSeconds = 20,
  includeImages = true,
  includeAvatars = true,
  includeVideos = true,
} = {}) {
  setLanguage(language);
  globalThis.__glassmarkCaptureCanceled = false;
  const kind = platform(location.hostname);
  const config = adapterFor(kind);
  const warnings = [];
  const resources = new Set();
  const posts = new Map();
  const originalScroll = scrollY;
  const started = performance.now();
  let control;
  let finish = false;
  const notify = () => {
    const message = `${tr("已识别 {0} 条帖子 / 评论", { 0: posts.size })}`;
    if (control) control.querySelector("span").textContent = message;
    try {
      globalThis.chrome?.runtime
        ?.sendMessage({ type: "capture-progress", count: posts.size })
        .catch(() => {});
    } catch {}
  };
  const context = pageContext(location.href);
  const limit = kind === "reddit" ? 100000 : maxPosts;
  let rootId = null;
  const candidates = () => {
    const scope =
      document.querySelector('[data-testid="primaryColumn"]') ||
      document.querySelector("main") ||
      document.body;
    let elements = [...scope.querySelectorAll(config.selector)];
    if (kind === "x") {
      elements = elements.filter(
        (el) => !el.parentElement?.closest(config.selector),
      );
      const boundary = [...scope.querySelectorAll("h2,[role=heading]")].find(
        (el) =>
          /^(discover more|发现更多|探索更多|猜你喜欢|更多帖子)$/i.test(
            el.textContent.trim(),
          ),
      );
      if (boundary)
        elements = elements.filter(
          (el) =>
            !(
              boundary.compareDocumentPosition(el) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ),
        );
      const primary = elements.find(
        (el) =>
          extractPost(el, kind).url?.match(/\/status\/(\d+)/)?.[1] ===
          context.postId,
      );
      if (!primary && !rootId) return [];
      if (primary) {
        rootId = extractPost(primary, kind).id;
        elements = [primary, ...elements.filter((el) => el !== primary)];
      }
    } else if (kind === "reddit") {
      const primary = elements.find(
        (el) =>
          !el.matches("shreddit-comment,.thing.comment") &&
          (el.getAttribute("id") === `t3_${context.postId}` ||
            el.getAttribute("thingid") === `t3_${context.postId}` ||
            el
              .getAttribute("permalink")
              ?.includes(`/comments/${context.postId}/`) ||
            extractPost(el, kind).url?.includes(
              `/comments/${context.postId}/`,
            )),
      );
      if (primary) {
        rootId = extractPost(primary, kind).id;
        elements = [
          primary,
          ...elements.filter(
            (el) =>
              el.matches("shreddit-comment,.thing.comment") &&
              (!el.getAttribute("postid") ||
                el.getAttribute("postid") === `t3_${context.postId}`),
          ),
        ];
      } else elements = [];
    }
    if (kind === "xiaohongshu") {
      const primary = elements.find((el) =>
        el.querySelector("#detail-desc,#detail-title,.note-content"),
      );
      if (!primary) return [];
      rootId = extractPost(primary, kind).id;
      elements = [
        primary,
        ...primary.querySelectorAll(".comments-container .comment-item"),
      ];
    }
    return elements;
  };
  function accumulate(elements) {
    for (const element of elements) {
      const post = extractPost(element, kind);
      if (posts.has(post.id) || posts.size >= limit) continue;
      post.media = (post.media || []).filter((m) =>
        m.type === "video" ? includeVideos : includeImages,
      );
      if (!includeAvatars) post.avatarUrl = "";
      for (const media of post.media || []) {
        for (const url of [media.url, media.poster, ...(media.sources || [])])
          if (url && /^https?:/.test(url)) resources.add(url);
      }
      if (post.avatarUrl && /^https?:/.test(post.avatarUrl))
        resources.add(post.avatarUrl);
      posts.set(post.id, post);
    }
  }
  let parts;
  if (mode === "thread" && kind !== "web") {
    if (kind === "xiaohongshu" && !context.isPost)
      throw new Error(tr("请先打开一篇小红书笔记详情"));
    if (kind === "x" && !/\/status\/\d+/.test(location.pathname))
      throw new Error(tr("请先打开一条 X 帖子的详情页"));
    if (kind === "reddit" && !/\/comments\//.test(location.pathname))
      throw new Error(tr("请先打开 Reddit 讨论详情页"));
    control = document.createElement("div");
    control.setAttribute("data-glassmark-ui", "");
    control.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:2147483647;padding:14px 16px;border-radius:14px;background:#fff;color:#253c4d;box-shadow:0 5px 35px #0003;font:13px/1.6 system-ui;display:flex;gap:12px;align-items:center";
    control.innerHTML = `<strong>Glassmark</strong><span>${tr("正在识别主帖…")}</span><button type="button">${tr("保存已加载内容")}</button><button type="button">${tr("取消")}</button>`;
    control.querySelectorAll("button")[0].onclick = () => {
      finish = true;
    };
    control.querySelectorAll("button")[1].onclick = () => {
      globalThis.__glassmarkCaptureCanceled = true;
    };
    document.documentElement.append(control);
    try {
      accumulate(candidates());
      notify();
      if (!rootId) {
        window.scrollTo(0, 0);
        for (let attempt = 0; attempt < 10 && !rootId; attempt++) {
          await new Promise((r) => setTimeout(r, 300));
          if (globalThis.__glassmarkCaptureCanceled)
            throw new Error(tr("已取消收藏"));
          accumulate(candidates());
          notify();
        }
      }
      if (!rootId)
        throw new Error(
          tr(
            "未识别到当前主帖，请等待帖子详情加载完成后重试；登录或访问限制也可能导致内容不可见",
          ),
        );
      let unchanged = 0;
      while (
        kind === "x" &&
        posts.size < limit &&
        !finish &&
        performance.now() - started < autoLoadSeconds * 1000
      ) {
        if (globalThis.__glassmarkCaptureCanceled)
          throw new Error(tr("已取消收藏"));
        window.scrollBy(0, Math.max(600, innerHeight * 0.8));
        await new Promise((resolve) => setTimeout(resolve, 700));
        const before = posts.size;
        accumulate(candidates());
        notify();
        unchanged = posts.size === before ? unchanged + 1 : 0;
        if (unchanged >= 3) break;
      }
      if (globalThis.__glassmarkCaptureCanceled)
        throw new Error(tr("已取消收藏"));
      if (performance.now() - started >= autoLoadSeconds * 1000)
        warnings.push(
          tr(
            "已保存当前收集到的内容；自动加载达到设置的时长上限，可继续收集更多回复",
          ),
        );
    } finally {
      control.remove();
      window.scrollTo(0, originalScroll);
    }
    parts = [];
    warnings.push(
      kind === "x"
        ? `${tr("保存了 {0} 条已加载帖子；隐藏、受限或未加载的回复不包含在内", { 0: posts.size })}`
        : `${tr("保存了 {0} 个已加载主帖/评论；折叠及未加载评论不包含在内", { 0: posts.size })}`,
    );
  } else {
    const roots =
      mode === "selection"
        ? globalThis.__glassmarkSelection || []
        : [document.body];
    if (!roots.length || roots.some((el) => !el.isConnected))
      throw new Error(tr("选择已失效，请重新选择区域"));
    parts = roots.map((el) => {
      const capture = serializeElement(el, {
        includeImages,
        includeAvatars,
        includeVideos,
      });
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
  if (mode !== "thread" && includeVideos)
    videoSources(document.body).forEach((u) => resources.add(u));
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
  for (const sheet of mode === "thread" ? [] : document.styleSheets) {
    try {
      visit(sheet.cssRules, sheet.href || document.baseURI);
    } catch {
      warnings.push(tr("部分跨域字体无法读取，正文仍按保存的排版显示"));
    }
  }
  return {
    version: 2,
    title: document.title || location.hostname,
    url: location.href,
    platform: mode === "thread" ? kind : "web",
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
    content:
      mode === "thread"
        ? null
        : contentDocument(
            parts,
            document.title,
            getComputedStyle(document.body).backgroundColor,
          ).replace("</head>", `<style>${fontCss}</style></head>`),
    videos:
      mode === "thread" || !includeVideos ? [] : videoSources(document.body),
    resources: [...resources],
    posts: rootId
      ? [posts.get(rootId), ...posts.values()].filter(
          (p, i, a) => p && a.findIndex((x) => x?.id === p.id) === i,
        )
      : [...posts.values()],
    warnings: [...new Set(warnings)],
    scope: { maxPosts, capturedPosts: posts.size, rootPostId: rootId },
  };
}
