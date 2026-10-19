import { t as tr } from "../../../app/i18n.js";
import { pageContext } from "../context.js";

/** Recheck the immutable target immediately before media or library writes. */
export function validateCapture(capture, sourceUrl, currentUrl, mode) {
  if (capture.sourceUrl !== sourceUrl || currentUrl !== sourceUrl)
    throw new Error(tr("捕获过程中来源页面已跳转，请重新收藏"));
  if (mode !== "thread") return;
  const source = pageContext(sourceUrl);
  const saved = pageContext(capture.url);
  const root = capture.posts?.[0];
  const rootContext = root?.url ? pageContext(root.url) : null;
  const matches =
    capture.platform === source.platform &&
    saved.platform === source.platform &&
    saved.isPost &&
    root &&
    String(root.id) === String(capture.scope?.rootPostId) &&
    ((source.isQuestion && source.platform === "zhihu") ||
      saved.postId === source.postId) &&
    (!rootContext ||
      (rootContext.isPost && rootContext.postId === saved.postId)) &&
    (source.platform !== "x" || String(root.id) === source.postId);
  if (!matches)
    throw new Error(
      tr(
        "未识别到当前主帖，请等待帖子详情加载完成后重试；登录或访问限制也可能导致内容不可见",
      ),
    );
}
