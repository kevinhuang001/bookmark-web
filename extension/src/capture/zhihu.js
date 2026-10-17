import { t as tr } from "../../../app/i18n.js";

export const ZHIHU_COMMENTS =
  "[data-comment-id],.CommentItem,.CommentItemV2,.NestComment--rootComment";
const PANELS =
  '[role="dialog"],.Modal,.Comments-container,.CommentsV2,.CommentListV2,.CommentsV2-withPagination';
const visible = (el) =>
  !!el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";

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

/** Only read inline comments or a panel opened by this answer's own control. */
export async function loadZhihuComments(
  root,
  { seconds, stop, collect, doc = document },
) {
  const deadline = performance.now() + seconds * 1000;
  const panels = new Set([root]);
  const check = () => {
    if (globalThis.__glassmarkCaptureCanceled)
      throw new Error(tr("已取消收藏"));
    if (!root.isConnected) throw new Error(tr("选择已失效，请重新选择回答"));
  };
  const harvest = () => {
    check();
    const comments = [
      ...new Set(
        [...panels].flatMap((panel) => [
          ...panel.querySelectorAll(ZHIHU_COMMENTS),
        ]),
      ),
    ].filter(
      (el) =>
        !el.closest(".AnswerItem,.Post-Main") ||
        el.closest(".AnswerItem,.Post-Main") === root,
    );
    collect(comments);
    return comments;
  };
  const wait = async () => {
    await new Promise((r) => setTimeout(r, 350));
    check();
  };
  const expand = root.querySelector(
    ".ContentItem-expandButton,.RichContent-expandButton",
  );
  if (expand && visible(expand) && !stop()) {
    expand.click();
    await wait();
  }
  let comments = harvest();
  const button = [...root.querySelectorAll("button,[role=button]")].find(
    (el) =>
      !el.closest(ZHIHU_COMMENTS) &&
      /评论|comments?/i.test(
        el.textContent + " " + (el.getAttribute("aria-label") || ""),
      ),
  );
  if (!comments.length && button && !stop()) {
    // A previously open foreign dialog must never be treated as this answer's comments.
    const before = new Map(
      [...doc.querySelectorAll(PANELS)].map((el) => [
        el,
        { visible: visible(el), html: el.innerHTML },
      ]),
    );
    button.click();
    await wait();
    if (
      [...before].some(
        ([panel, state]) =>
          state.visible && (!panel.isConnected || !visible(panel)),
      )
    ) {
      for (const [panel, state] of before)
        if (!panel.isConnected || !visible(panel)) state.visible = false;
      button.click();
    }
    for (
      let attempt = 0;
      attempt < 8 && performance.now() < deadline && !stop();
      attempt++
    ) {
      await wait();
      for (const panel of doc.querySelectorAll(PANELS)) {
        if (
          !visible(panel) ||
          (panel.closest(".AnswerItem,.Post-Main") && !root.contains(panel))
        )
          continue;
        const previous = before.get(panel);
        if (
          !previous ||
          !previous.visible ||
          previous.html !== panel.innerHTML
        ) {
          // Prefer the enclosing dialog; its pagination controls may sit outside the list.
          const scope = panel.closest('[role="dialog"],.Modal') || panel;
          panels.add(scope);
        }
      }
      comments = harvest();
      if (comments.length) break;
    }
  }
  const clicked = new WeakSet();
  while (!stop() && performance.now() < deadline) {
    check();
    const controls = [...panels].flatMap((panel) => [
      ...panel.querySelectorAll("button,[role=button],a"),
    ]);
    const next = controls.find(
      (el) =>
        visible(el) &&
        !el.disabled &&
        el.getAttribute("aria-disabled") !== "true" &&
        !clicked.has(el) &&
        /^(?:展开(?:全部|更多)?(?:\s*\d+\s*条)?(?:回复|评论)|查看(?:全部|更多)?(?:\s*\d+\s*条)?(?:回复|评论)|加载更多(?:评论|回复)?|下一页|更多评论|load more(?: comments| replies)?|next(?: page)?|view (?:more|all)(?: \d+)? replies)$/i.test(
          (el.textContent || el.getAttribute("aria-label") || "").trim(),
        ),
    );
    if (!next) {
      const scroller = [...panels]
        .flatMap((panel) => [
          panel,
          ...panel.querySelectorAll(
            ".Comments-container,.CommentsV2,[class*=CommentList],[class*=Comments-list]",
          ),
        ])
        .find(
          (el) =>
            el !== root &&
            visible(el) &&
            el.scrollHeight > el.clientHeight + 2 &&
            /auto|scroll/.test(getComputedStyle(el).overflowY) &&
            el.scrollTop + el.clientHeight < el.scrollHeight - 2,
        );
      if (!scroller) break;
      scroller.scrollTop = scroller.scrollHeight;
      const beforeScroll = comments.map((el) => el.textContent).join("\n");
      for (
        let attempt = 0;
        attempt < 4 && performance.now() < deadline && !stop();
        attempt++
      ) {
        await wait();
        comments = harvest();
        if (comments.map((el) => el.textContent).join("\n") !== beforeScroll)
          break;
      }
      continue;
    }
    clicked.add(next);
    const snapshot = comments.map((el) => el.textContent).join("\n");
    next.click();
    let changed = false;
    for (
      let attempt = 0;
      attempt < 8 && performance.now() < deadline && !stop();
      attempt++
    ) {
      await wait();
      comments = harvest();
      if (comments.map((el) => el.textContent).join("\n") !== snapshot) {
        changed = true;
        break;
      }
    }
    if (!changed) break;
    // Pagination often reuses the same next button. Permit it after content changed.
    if (/^(下一页|next(?: page)?)$/i.test(next.textContent.trim()))
      clicked.delete(next);
  }
  harvest();
}
