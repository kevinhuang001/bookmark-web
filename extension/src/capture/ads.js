/** Explicit platform advertising markers; ordinary comments are never classified by topic. */
export function isAdvertisement(element) {
  const markers =
    '[data-testid="placementTracking"],[data-testid="promotedIndicator"],[data-promoted="true"],[data-ad="true"],[is-promoted="true"],shreddit-ad-post,.promotedlink,.AdItem';
  if (element.closest(markers) || element.querySelector(markers)) return true;
  return [
    ...element.querySelectorAll(
      '[data-testid="socialContext"],[data-testid="adLabel"],[aria-label="Promoted"],[aria-label="广告"]',
    ),
  ].some((label) =>
    /^(?:ad|promoted|sponsored|广告|推广)$/i.test(
      label.textContent.trim() || label.getAttribute("aria-label") || "",
    ),
  );
}
