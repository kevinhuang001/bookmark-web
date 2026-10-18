import { t as tr } from "../../../app/i18n.js";

export const ZHIHU_COMMENTS =
  '[data-comment-id],.CommentItem,.CommentItemV2,.NestComment--rootComment,[class*="_CommentItem_root_"],[class*="CommentItem-module-root-"]';
export const ZHIHU_COMMENT_BODY =
  '.CommentItem-content,.CommentItemV2-content,.CommentContent,.CommentRichText,[class*="_CommentItem_content_"],[class*="commentContent"]';
const PANELS =
  '[role="dialog"],.Modal,.Modal-content,.Comments-container,.CommentsV2,.CommentListV2,.CommentsV2-withPagination,[class*="_CommentBox_root_"],[class*="_CommentList_root_"]';
const visible = (el) =>
  el.isConnected &&
  !!el.getClientRects().length &&
  !el.closest("[hidden],[aria-hidden=true]") &&
  !["hidden", "collapse"].includes(getComputedStyle(el).visibility);

/** Resolve the answer's own identity even on a multi-answer question URL. */
export function zhihuIdentity(el, doc = document) {
  let data = {};
  try {
    data = JSON.parse(el.getAttribute("data-zop") || "{}");
  } catch {}
  const link = el.querySelector(
    'meta[itemprop="url"],a[itemprop="url"],a[href*="/answer/"]',
  );
  let url;
  try {
    url = new URL(
      link?.getAttribute("content") || link?.getAttribute("href") || doc.URL,
      doc.URL,
    );
  } catch {}
  const question = new URL(doc.URL).pathname.match(/^\/question\/(\d+)/)?.[1];
  const id = String(
    data.itemId ||
      el.getAttribute("data-answer-id") ||
      url?.pathname.match(/\/(?:answer|p)\/(\d+)/)?.[1] ||
      "",
  );
  if (question && /^\d+$/.test(id))
    url = new URL(`/question/${question}/answer/${id}`, doc.URL);
  if (!id || !url || !/\/(?:answer|p)\/\d+(?:\/|$)/.test(url.pathname))
    return null;
  return { id, url: url.origin + url.pathname };
}

export function zhihuRoot(context, doc = document) {
  const selection = globalThis.__glassmarkZhihuAnswer;
  if (selection) {
    if (
      selection.pageUrl !== doc.URL ||
      !selection.element.isConnected ||
      zhihuIdentity(selection.element, doc)?.id !== selection.id
    )
      throw new Error(tr("选择已失效，请重新选择回答"));
    return selection.element;
  }
  if (!context.isPost) throw new Error(tr("请先选择要收藏的知乎回答"));
  return [...doc.querySelectorAll(".AnswerItem,.Post-Main")].find(
    (el) => zhihuIdentity(el, doc)?.id === context.postId,
  );
}

/** Current inline comments identify the whole row with data-id, not a class. */
export function zhihuCommentOwner(node) {
  let owner = node.closest(ZHIHU_COMMENTS + ",[data-id]");
  while (owner) {
    if (
      !owner.matches(".AnswerItem,.Post-Main") &&
      (owner.matches(ZHIHU_COMMENTS) || owner.querySelector(ZHIHU_COMMENT_BODY))
    )
      return owner;
    owner = owner.parentElement?.closest(ZHIHU_COMMENTS + ",[data-id]");
  }
  return node.closest(ZHIHU_COMMENT_BODY);
}

export function zhihuCommentElements(scope) {
  const elements = new Set(scope.querySelectorAll(ZHIHU_COMMENTS));
  for (const content of scope.querySelectorAll(ZHIHU_COMMENT_BODY)) {
    const owner = zhihuCommentOwner(content);
    if (owner && scope.contains(owner)) elements.add(owner);
    else elements.add(content);
  }
  return [...elements].filter(visible);
}

function answerContainer(root) {
  let scope = root;
  for (
    let parent = root.parentElement;
    parent && parent !== document.body;
    parent = parent.parentElement
  ) {
    const answers = [...parent.querySelectorAll(".AnswerItem,.Post-Main")];
    if (answers.some((answer) => answer !== root)) break;
    scope = parent;
    if (
      parent.matches(".List-item,.Card,.QuestionAnswer-content,.Post-content")
    )
      break;
  }
  return scope;
}
const labels = (node) =>
  [
    node.textContent,
    node.getAttribute("aria-label"),
    node.getAttribute("title"),
    node.getAttribute("data-tooltip"),
  ]
    .filter(Boolean)
    .map((value) => value.replace(/[\u200b-\u200f\ufeff]/g, "").trim());
const label = (node) => labels(node).join(" ");
function commentButton(scope, root) {
  return [...scope.querySelectorAll("button,[role=button],a")]
    .filter(
      (node) =>
        visible(node) &&
        !node.disabled &&
        node.getAttribute("aria-disabled") !== "true" &&
        !node.closest(ZHIHU_COMMENTS) &&
        !node.closest("[data-glassmark-ui]") &&
        (!node.closest(".AnswerItem,.Post-Main") ||
          node.closest(".AnswerItem,.Post-Main") === root) &&
        (/评论|comments?/i.test(label(node)) ||
          node.querySelector(
            '.Zi--Comment,.ZDI--ChatBubbleFill24,svg[class*="--Comment"],[data-icon="comment"]',
          )),
    )
    .sort(
      (a, b) =>
        Number(!!b.closest(".ContentItem-actions,.RichContent-actions")) -
        Number(!!a.closest(".ContentItem-actions,.RichContent-actions")),
    )[0];
}
const commentsExpanded = (button) =>
  button?.getAttribute("aria-expanded") === "true" ||
  (button && /收起评论|hide comments/i.test(label(button)));

const emptyPanel = (panel) =>
  panel.matches(PANELS) &&
  /暂无评论|还没有评论|暂时没有评论|尚无评论|no comments yet|be the first to comment/i.test(
    panel.textContent,
  );
const fingerprint = (panel) =>
  zhihuCommentElements(panel)
    .map(
      (node) =>
        (node.getAttribute("data-comment-id") ||
          node.getAttribute("data-id") ||
          "") +
        ":" +
        node.textContent,
    )
    .join("\n");

const MORE_COMMENTS =
  /^(?:(?:展开|查看)(?:全部|更多|其他)?(?:\s*\d+\s*条)?(?:回复|评论)|加载更多(?:评论|回复)?|(?:点击)?查看(?:全部|所有)(?:\s*\d+\s*条)?评论|下一页|更多评论|load more(?: comments| replies)?|next(?: page)?|view (?:more|all)(?: \d+)? replies)$/i;
const ALL_COMMENTS = /^(?:点击)?查看(?:全部|所有)(?:\s*\d+\s*条)?评论$/;
function loadControls(panels) {
  return [
    ...new Set(
      [...panels].flatMap((panel) => [
        ...panel.querySelectorAll("button,[role=button],a,[tabindex],div,span"),
      ]),
    ),
  ]
    .filter(
      (node) =>
        visible(node) &&
        !node.disabled &&
        node.getAttribute("aria-disabled") !== "true" &&
        !node.closest(ZHIHU_COMMENT_BODY) &&
        !node.querySelector(ZHIHU_COMMENT_BODY) &&
        labels(node).some((text) => MORE_COMMENTS.test(text)) &&
        ![...node.children].some((child) =>
          labels(child).some((text) => MORE_COMMENTS.test(text)),
        ),
    )
    .sort(
      (a, b) =>
        Number(labels(b).some((text) => ALL_COMMENTS.test(text))) -
        Number(labels(a).some((text) => ALL_COMMENTS.test(text))),
    );
}

/** Open the selected answer's visible action, then wait for its actual comment UI. */
export async function loadZhihuComments(
  root,
  {
    seconds,
    stop,
    collect = () => {},
    progress = () => {},
    doc = document,
    openOnly = false,
  },
) {
  const deadline = performance.now() + Math.max(1, Number(seconds) || 1) * 1000;
  const owner = answerContainer(root);
  const selection = globalThis.__glassmarkZhihuAnswer;
  const prepared =
    selection?.element === root && selection.pageUrl === doc.URL
      ? selection.comments
      : null;
  const panels = new Set([owner, ...(prepared?.panels || []).filter(visible)]);
  const result = (empty = false) => ({ panels: [...panels], empty });
  const check = () => {
    if (globalThis.__glassmarkCaptureCanceled)
      throw new Error(tr("已取消收藏"));
    if (!root.isConnected) throw new Error(tr("选择已失效，请重新选择回答"));
  };
  const wait = async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    check();
  };
  const harvest = () => {
    check();
    const comments = [
      ...new Set([...panels].flatMap(zhihuCommentElements)),
    ].filter(
      (node) =>
        !node.closest(".AnswerItem,.Post-Main") ||
        node.closest(".AnswerItem,.Post-Main") === root,
    );
    collect(comments);
    return comments;
  };
  const snapshot = () =>
    new Map(
      [...doc.querySelectorAll(PANELS)].map((panel) => [
        panel,
        { visible: visible(panel), content: fingerprint(panel) },
      ]),
    );
  const discoverPanels = (before, action) => {
    let changedPanel = false;
    const controls = (
      action?.getAttribute("aria-controls") ||
      action?.getAttribute("aria-owns") ||
      ""
    ).split(/\s+/);
    for (const panel of doc.querySelectorAll(PANELS)) {
      if (
        !visible(panel) ||
        (panel.closest(".AnswerItem,.Post-Main") && !owner.contains(panel))
      )
        continue;
      const previous = before.get(panel);
      const changed =
        !previous ||
        !previous.visible ||
        previous.content !== fingerprint(panel);
      if (
        (owner.contains(panel) || controls.includes(panel.id) || changed) &&
        (zhihuCommentElements(panel).length || emptyPanel(panel))
      ) {
        panels.add(panel.closest('[role="dialog"],.Modal') || panel);
        changedPanel ||= changed;
      }
    }
    return changedPanel;
  };
  const expand = [
    ...root.querySelectorAll(
      ".ContentItem-expandButton,.RichContent-expandButton",
    ),
  ].find(visible);
  if (expand && !stop()) {
    expand.click();
    await wait();
  }
  let comments = harvest();
  let button = commentButton(owner, root);
  const preparedOpen = !!prepared && panels.size > 1;
  if (preparedOpen && prepared.empty) return result(true);
  while (
    !comments.length &&
    !button &&
    !stop() &&
    performance.now() < deadline
  ) {
    await wait();
    comments = harvest();
    button = commentButton(owner, root);
  }
  // A visible hot-comment preview does not mean the comment action is open.
  // Decide from the selected answer's action, rather than the preview count.
  if (
    (!comments.length ||
      (button && !commentsExpanded(button) && !preparedOpen)) &&
    !stop()
  ) {
    if (!button)
      throw new Error(tr("未找到所选回答的评论按钮，请展开回答后重试"));
    progress(tr("正在打开所选回答的评论…"));
    // Only an explicitly expanded action may be toggled closed and reopened.
    // Opening this answer can close a FOREIGN dialog; that is not a reason to click twice.
    if (commentsExpanded(button)) {
      button.click();
      await wait();
      button = commentButton(owner, root) || button;
    }
    const before = snapshot();
    const previousContent = fingerprint(owner);
    let opened = false;
    const noComments = /(?:^|\s)0\s*(?:条)?评论|评论\s*0(?:\s|$)|添加评论/.test(
      label(button),
    );
    button.scrollIntoView({ block: "center", inline: "nearest" });
    button.click();
    while (!stop() && performance.now() < deadline) {
      await wait();
      opened =
        discoverPanels(before, button) ||
        commentsExpanded(button) ||
        fingerprint(owner) !== previousContent ||
        opened;
      comments = harvest();
      if (opened && comments.length) break;
      if ([...panels].some((panel) => visible(panel) && emptyPanel(panel)))
        return result(true);
      if (
        noComments &&
        [...doc.querySelectorAll(PANELS)].some(
          (panel) =>
            visible(panel) &&
            !before.get(panel)?.visible &&
            panel.querySelector("textarea,[contenteditable],.InputLike"),
        )
      ) {
        for (const panel of doc.querySelectorAll(PANELS))
          if (
            visible(panel) &&
            !before.get(panel)?.visible &&
            panel.querySelector("textarea,[contenteditable],.InputLike")
          )
            panels.add(panel);
        return result(true);
      }
    }
    if ((!opened || !comments.length) && !stop())
      throw new Error(tr("所选回答的评论未能加载，请确认知乎已登录后重试"));
  }
  if (openOnly) return result();
  const clicked = new WeakSet();
  while (!stop() && performance.now() < deadline) {
    check();
    const next = loadControls(panels).find((node) => !clicked.has(node));
    const scroller =
      !next &&
      [...panels]
        .flatMap((panel) => [
          panel,
          ...panel.querySelectorAll(
            ".Comments-container,.CommentsV2,[class*=CommentList],[class*=_CommentList_root_]",
          ),
          ...(!owner.contains(panel)
            ? [
                ...(function* () {
                  for (
                    let parent = panel.parentElement;
                    parent &&
                    parent !== doc.body &&
                    parent !== doc.documentElement;
                    parent = parent.parentElement
                  )
                    yield parent;
                })(),
              ]
            : []),
        ])
        .find(
          (node) =>
            node !== owner &&
            visible(node) &&
            node.scrollHeight > node.clientHeight + 2 &&
            /auto|scroll/.test(getComputedStyle(node).overflowY) &&
            node.scrollTop + node.clientHeight < node.scrollHeight - 2,
        );
    if (!next && !scroller) break;
    const previous = comments.map((node) => node.textContent).join("\n");
    const before = snapshot();
    if (next) {
      clicked.add(next);
      next.click();
    } else scroller.scrollTop = scroller.scrollHeight;
    let changed = false;
    while (!stop() && performance.now() < deadline) {
      await wait();
      const panelChanged = discoverPanels(before, next);
      comments = harvest();
      if (
        panelChanged ||
        comments.map((node) => node.textContent).join("\n") !== previous
      ) {
        changed = true;
        break;
      }
    }
    if (!changed) break;
    if (
      next &&
      labels(next).some((text) => /^(下一页|next(?: page)?)$/i.test(text))
    )
      clicked.delete(next);
  }
  harvest();
  return result();
}
