/** Reveal a target inside a viewer without scrolling the page that contains it. */
export function scrollWithinContainer(
  boundary: HTMLElement | null,
  target: HTMLElement | null | undefined,
  block: "start" | "center" = "center"
): void {
  if (!boundary || !target || boundary === target || !boundary.contains(target)) return;

  for (let viewport = target.parentElement; viewport; viewport = viewport.parentElement) {
    const style = getComputedStyle(viewport);
    const scrollY = viewport === boundary ||
      (/auto|scroll/.test(style.overflowY) && viewport.scrollHeight > viewport.clientHeight);
    const scrollX = viewport === boundary ||
      (/auto|scroll/.test(style.overflowX) && viewport.scrollWidth > viewport.clientWidth);
    if (scrollY || scrollX) {
      const view = viewport.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const leftEdge = view.left + viewport.clientLeft;
      const rightEdge = leftEdge + viewport.clientWidth;
      let left = viewport.scrollLeft;
      // Keep horizontal position when the target already spans the viewport.
      if (scrollX && !(rect.left < leftEdge && rect.right > rightEdge)) {
        if (rect.left < leftEdge) left += rect.left - leftEdge;
        else if (rect.right > rightEdge) left += rect.right - rightEdge;
      }
      const top = scrollY
        ? viewport.scrollTop + rect.top - view.top - viewport.clientTop -
          (block === "center" ? (viewport.clientHeight - rect.height) / 2 : 0)
        : viewport.scrollTop;
      viewport.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: "instant" });
    }
    if (viewport === boundary) break;
  }
}
