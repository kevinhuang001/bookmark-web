/** Visit virtual gallery slides; unmounted slides cannot be captured from one DOM pass. */
export async function loadGallery(
  root,
  kind,
  { collect, stop = () => false } = {},
) {
  if (!root || !["xiaohongshu", "reddit"].includes(kind)) return;
  const scope =
    root.querySelector(
      ".note-slider,.slider-container,.swiper,[slot='gallery'],gallery-carousel",
    ) || root;
  const controls = (direction) =>
    [
      ...root.querySelectorAll(
        direction === "next"
          ? '.swiper-button-next,.arrow-controller.right,[data-gallery-next],button[aria-label="Next"],button[aria-label="下一张"]'
          : '.swiper-button-prev,.arrow-controller.left,[data-gallery-prev],button[aria-label="Previous"],button[aria-label="上一张"]',
      ),
    ].find(
      (button) =>
        !button.closest(".comment-item,shreddit-comment") &&
        !button.disabled &&
        button.getAttribute("aria-disabled") !== "true" &&
        !button.classList.contains("swiper-button-disabled"),
    );
  const signature = () =>
    [...scope.querySelectorAll("img,video")]
      .map((node) =>
        [
          node.getAttribute("data-src"),
          node.getAttribute("src"),
          node.getAttribute("poster"),
          node
            .closest("[data-swiper-slide-index]")
            ?.getAttribute("data-swiper-slide-index"),
        ].join("|"),
      )
      .join(";");
  const original = signature();
  const turn = async (direction) => {
    const button = controls(direction);
    if (!button) return false;
    const before = signature();
    button.click();
    for (let attempt = 0; attempt < 8 && signature() === before; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    collect?.();
    return signature() !== before;
  };
  try {
    const earlier = new Set();
    while (!stop() && earlier.size < 100 && !earlier.has(signature())) {
      earlier.add(signature());
      if (!(await turn("previous"))) break;
    }
    const seen = new Set();
    while (!stop() && seen.size < 100 && !seen.has(signature())) {
      seen.add(signature());
      collect?.();
      if (!(await turn("next"))) break;
    }
  } finally {
    const seen = new Set();
    while (
      signature() !== original &&
      seen.size < 100 &&
      !seen.has(signature())
    ) {
      seen.add(signature());
      if (!(await turn("previous"))) break;
    }
  }
}

export function imageSource(image) {
  const source =
    image.getAttribute("data-original") ||
    image.getAttribute("data-actualsrc") ||
    image.getAttribute("data-src") ||
    image.currentSrc ||
    image.src ||
    "";
  if (!source) return "";
  try {
    return new URL(source, image.ownerDocument.baseURI).href;
  } catch {
    return "";
  }
}
