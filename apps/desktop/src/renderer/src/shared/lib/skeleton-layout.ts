export interface SkeletonLayoutShape {
  kind: "text" | "block" | "circle" | "frame";
  x: number;
  y: number;
  width: number;
  height: number;
  radius: string;
  // Preserve the original rounded shape inside a smaller visible clipping box.
  content?: { x: number; y: number; width: number; height: number };
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MAX_ELEMENTS = 2000;
const MAX_SHAPES = 600;
const ATOMIC_ELEMENTS =
  "button,input,textarea,select,img,svg,canvas,video,iframe," +
  '[role="button"],[role="switch"],[role="checkbox"],[role="slider"],[role="combobox"]';

// Read geometry only. No text, input values, URLs or HTML enter the result.
// The caller keeps the real layout mounted, so this works on the first load.
export function collectSkeletonLayout(root: HTMLElement): SkeletonLayoutShape[] {
  const origin = root.getBoundingClientRect();
  const view = root.ownerDocument.defaultView;
  if (!view || origin.width <= 0 || origin.height <= 0) {
    return [];
  }
  const shapes: SkeletonLayoutShape[] = [];
  let visited = 0;
  const viewport = {
    left: Math.max(origin.left, 0),
    top: Math.max(origin.top, 0),
    right: Math.min(origin.right, view.innerWidth),
    bottom: Math.min(origin.bottom, view.innerHeight)
  };
  const clipOverflow = (element: Element, clip: Bounds, style: CSSStyleDeclaration) => {
    const rect = element.getBoundingClientRect();
    const left = rect.left + element.clientLeft;
    const top = rect.top + element.clientTop;
    if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
      clip.left = Math.max(clip.left, left);
      clip.right = Math.min(clip.right,
        element.clientWidth ? left + element.clientWidth : rect.right);
    }
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
      clip.top = Math.max(clip.top, top);
      clip.bottom = Math.min(clip.bottom,
        element.clientHeight ? top + element.clientHeight : rect.bottom);
    }
  };
  // A boundary can itself live inside a scrolling panel.
  for (let parent = root.parentElement; parent; parent = parent.parentElement) {
    clipOverflow(parent, viewport, view.getComputedStyle(parent));
  }
  const add = (
    rect: Bounds,
    clip: Bounds,
    kind: SkeletonLayoutShape["kind"],
    radius = "var(--radius-small)"
  ) => {
    const left = Math.max(rect.left, clip.left);
    const top = Math.max(rect.top, clip.top);
    const right = Math.min(rect.right, clip.right);
    const bottom = Math.min(rect.bottom, clip.bottom);
    if (right - left < 1 || bottom - top < 1 || shapes.length >= MAX_SHAPES) {
      return;
    }
    shapes.push({
      kind, x: left - origin.left, y: top - origin.top,
      width: right - left, height: bottom - top, radius,
      ...(left !== rect.left || top !== rect.top ||
          right !== rect.right || bottom !== rect.bottom ? {
        content: {
          x: rect.left - left, y: rect.top - top,
          width: rect.right - rect.left, height: rect.bottom - rect.top
        }
      } : {})
    });
  };
  const visit = (element: Element, clip: Bounds) => {
    if (++visited > MAX_ELEMENTS || shapes.length >= MAX_SHAPES) return;
    const hint = element.getAttribute("data-skeleton");
    const style = view.getComputedStyle(element);
    if (
      hint === "ignore" || element.hasAttribute("hidden") ||
      element.matches("script,style,template,noscript,[data-skeleton-overlay]") ||
      style.display === "none" || style.visibility === "hidden" ||
      style.visibility === "collapse" || (element !== root && style.opacity === "0")
    ) return;

    const rect = element.getBoundingClientRect();
    // display:contents has no box, but its children still participate in layout.
    if (style.display !== "contents" &&
      (rect.width <= 0 || rect.height <= 0 ||
       rect.right <= clip.left || rect.left >= clip.right ||
       rect.bottom <= clip.top || rect.top >= clip.bottom)) return;

    if (hint === "block" || hint === "circle" || hint === "text" ||
        element.matches(ATOMIC_ELEMENTS)) {
      const radius = /^\d+(?:\.\d+)?%$/.test(style.borderRadius)
        ? rect.width * parseFloat(style.borderRadius) / 100
        : parseFloat(style.borderRadius);
      const circle = hint === "circle" ||
        element.matches('input[type="radio"]') ||
        (rect.width === rect.height && radius >= rect.width / 2);
      add(rect, clip, circle ? "circle" : hint === "text" ? "text" : "block",
        circle ? "50%" : style.borderRadius);
      return;
    }
    if (style.borderTopStyle !== "none" && style.borderLeftStyle !== "none" &&
        parseFloat(style.borderTopWidth) > 0 && parseFloat(style.borderLeftWidth) > 0) {
      add(rect, clip, "frame", style.borderRadius);
    }
    const childClip = { ...clip };
    clipOverflow(element, childClip, style);
    for (const node of element.childNodes) {
      if (shapes.length >= MAX_SHAPES || visited >= MAX_ELEMENTS) break;
      if (node.nodeType === 1) {
        visit(node as Element, childClip);
      } else if (node.nodeType === 3 && node.textContent?.trim()) {
        const range = root.ownerDocument.createRange();
        range.selectNodeContents(node);
        // jsdom has no text layout; actual Electron uses line-fragment rectangles.
        if (typeof range.getClientRects !== "function") continue;
        const fontSize = parseFloat(style.fontSize) || 14;
        for (const line of range.getClientRects()) {
          const height = Math.min(line.height, fontSize * 0.65);
          const top = line.top + (line.height - height) / 2;
          add({ left: line.left, right: line.right, top, bottom: top + height },
            childClip, "text", "999px");
        }
      }
    }
  };
  // The root is intentionally transparent/inert while measuring its content.
  // Visit its text nodes too: <SkeletonBoundary>Text</SkeletonBoundary> is valid.
  visit(root, viewport);
  return shapes;
}
