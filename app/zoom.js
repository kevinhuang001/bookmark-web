/** Reading scale belongs to this local preview, never to the saved archive. */
export const zoomSteps = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
export function normalizeZoom(value) {
  const number = Number(value);
  return zoomSteps.includes(number) ? number : 100;
}
export function readPageZoom(id, storage = localStorage) {
  try {
    return normalizeZoom(storage.getItem("glassmark-page-zoom:" + id));
  } catch {
    return 100;
  }
}
export function nextZoom(value, direction) {
  const index = zoomSteps.indexOf(normalizeZoom(value));
  return zoomSteps[
    Math.max(0, Math.min(zoomSteps.length - 1, index + direction))
  ];
}
