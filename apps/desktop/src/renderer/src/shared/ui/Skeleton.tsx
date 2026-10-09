import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode
} from "react";

import { collectSkeletonLayout, type SkeletonLayoutShape } from "../lib/skeleton-layout";

export type SkeletonVariant = "block" | "circle" | "text";

export const SKELETON_REVEAL_DELAY_MS = 180;
const SkeletonPresentationContext = createContext<boolean | null>(null);
const SkeletonSurfaceContext = createContext(false);

// Keep a single loading sequence continuous when a whole-page placeholder is
// replaced by a more specific one. A different target gets a fresh clock.
export function SkeletonScope({
  children,
  loading,
  scopeKey
}: {
  children: ReactNode;
  loading: boolean;
  scopeKey: string;
}) {
  const [revealedScope, setRevealedScope] = useState<string | null>(null);
  useLayoutEffect(() => {
    // Reset presentation only; do not remount forms or other business children.
    setRevealedScope(null);
    if (!loading) {
      return;
    }
    const timer = window.setTimeout(
      () => setRevealedScope(scopeKey),
      SKELETON_REVEAL_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [loading, scopeKey]);

  return (
    <SkeletonPresentationContext.Provider value={loading ? revealedScope === scopeKey : null}>
      {children}
    </SkeletonPresentationContext.Provider>
  );
}

export interface SkeletonProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  height?: CSSProperties["height"];
  variant?: SkeletonVariant;
  width?: CSSProperties["width"];
}

export interface SkeletonSurfaceProps
  extends HTMLAttributes<HTMLElement> {
  as?: "article" | "aside" | "div" | "section" | "span";
  label: string;
  /** Explicitly opened surfaces can show feedback on their first paint. */
  immediate?: boolean;
}

export interface SkeletonBoundaryProps {
  children: ReactNode;
  /** Omit to derive placeholders from the mounted children and their real CSS. */
  fallback?: ReactNode;
  hasContent: boolean;
  label: string;
  loading: boolean;
  surfaceAs?: SkeletonSurfaceProps["as"];
  surfaceClassName?: string;
}

export function Skeleton({
  className,
  height,
  style,
  variant = "block",
  width,
  ...props
}: SkeletonProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={mergeClassNames("gn-skeleton", className)}
      data-variant={variant}
      style={{
        ...style,
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height })
      }}
    />
  );
}

export function SkeletonSurface({
  as = "div",
  children,
  className,
  label,
  immediate = false,
  ...props
}: SkeletonSurfaceProps) {
  const inheritedVisibility = useContext(SkeletonPresentationContext);
  const [revealed, setRevealed] = useState(false);
  const nested = useContext(SkeletonSurfaceContext);
  const hasSharedClock = inheritedVisibility !== null;
  const visible = immediate || (inheritedVisibility ?? revealed);

  useEffect(() => {
    // Nested placeholders share one clock and one accessibility announcement.
    if (immediate || hasSharedClock) {
      return;
    }
    const timer = window.setTimeout(
      () => setRevealed(true),
      SKELETON_REVEAL_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [hasSharedClock, immediate]);

  const surface = createElement(
    as,
    {
      ...props,
      "aria-busy": "true",
      "aria-label": label,
      "aria-hidden": !visible || nested ? true : props["aria-hidden"],
      "aria-live": visible && !nested ? "polite" : "off",
      "aria-atomic": "true",
      "data-skeleton-phase": visible ? "visible" : "pending",
      "data-skeleton-nested": nested ? "" : undefined,
      className: mergeClassNames("gn-skeleton-surface", className),
      role: nested ? undefined : "status"
    },
    children
  );

  return (
    <SkeletonPresentationContext.Provider value={visible}>
      <SkeletonSurfaceContext.Provider value>
        {surface}
      </SkeletonSurfaceContext.Provider>
    </SkeletonPresentationContext.Provider>
  );
}

export function SkeletonBoundary({
  children,
  fallback,
  hasContent,
  label,
  loading,
  surfaceAs,
  surfaceClassName
}: SkeletonBoundaryProps) {
  const visible = useSkeletonVisibility(loading, hasContent);
  if (fallback === undefined) {
    return (
      <AutoSkeletonBoundary
        hasContent={hasContent}
        label={label}
        loading={loading}
        {...(surfaceClassName ? { surfaceClassName } : {})}
      >
        {children}
      </AutoSkeletonBoundary>
    );
  }
  if (!visible) {
    return <>{children}</>;
  }

  return (
    <SkeletonSurface
      {...(surfaceAs ? { as: surfaceAs } : {})}
      className={surfaceClassName}
      label={label}
    >
      {fallback}
    </SkeletonSurface>
  );
}

/**
 * Children stay mounted once, hidden and inert during an initial read.
 * Supply the real page shell even before data arrives; unmounted/virtualized
 * rows cannot be inferred. Portals and child side effects remain caller-owned.
 */
export function AutoSkeletonBoundary({
  children,
  hasContent,
  label,
  loading,
  surfaceClassName
}: Omit<SkeletonBoundaryProps, "fallback" | "surfaceAs">) {
  const pending = loading && !hasContent;
  const contentRef = useRef<HTMLDivElement>(null);
  const shapesRef = useRef<SkeletonLayoutShape[]>([]);
  const [shapes, setShapes] = useState(shapesRef.current);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!pending || !content) return;
    const view = content.ownerDocument.defaultView!;
    let disposed = false;
    let frame = 0;
    let structureChanged = false;
    const observed = new Set<Element>();
    const measure = () => {
      frame = 0;
      if (disposed) return;
      if (structureChanged) {
        structureChanged = false;
        observeSizes();
      }
      const next = collectSkeletonLayout(content);
      if (!equalSkeletonShapes(shapesRef.current, next)) {
        shapesRef.current = next;
        setShapes(next);
      }
    };
    const schedule = () => {
      if (!disposed && !frame) frame = view.requestAnimationFrame(measure);
    };
    const resize = typeof ResizeObserver === "undefined"
      ? null : new ResizeObserver(schedule);
    const observeSizes = () => {
      if (!resize) return;
      const next = new Set<Element>([content]);
      // Also detect changes inside fixed-height or scrolling page containers.
      const walker = content.ownerDocument.createTreeWalker(content, 1);
      for (let count = 0, node = walker.nextNode();
        node && count < 2000; count += 1, node = walker.nextNode()) {
        next.add(node as Element);
      }
      for (const element of observed) {
        if (!next.has(element)) {
          resize.unobserve(element);
          observed.delete(element);
        }
      }
      for (const element of next) {
        if (!observed.has(element)) {
          resize.observe(element);
          observed.add(element);
        }
      }
    };
    const mutation = new MutationObserver((records) => {
      if (disposed) return;
      structureChanged ||= records.some((record) => record.type === "childList");
      schedule();
    });
    measure();
    observeSizes();
    mutation.observe(content, {
      subtree: true, childList: true, characterData: true, attributes: true
    });
    view.addEventListener("scroll", schedule, true);
    content.addEventListener("load", schedule, true);
    const motionEvents = [
      "animationend", "animationcancel", "transitionend", "transitioncancel"
    ] as const;
    motionEvents.forEach((event) => content.addEventListener(event, schedule, true));
    view.addEventListener("resize", schedule);
    void content.ownerDocument.fonts?.ready.then(schedule);
    return () => {
      disposed = true;
      view.cancelAnimationFrame(frame);
      resize?.disconnect();
      mutation.disconnect();
      view.removeEventListener("scroll", schedule, true);
      content.removeEventListener("load", schedule, true);
      motionEvents.forEach((event) => content.removeEventListener(event, schedule, true));
      view.removeEventListener("resize", schedule);
    };
  }, [pending]);

  return (
    <div
      className={mergeClassNames("gn-auto-skeleton", surfaceClassName)}
      data-loading={pending ? "" : undefined}
    >
      <div
        className="gn-auto-skeleton-content"
        ref={contentRef}
        inert={pending || undefined}
        aria-hidden={pending || undefined}
      >
        {children}
      </div>
      {pending && (
        <SkeletonSurface
          className="gn-auto-skeleton-overlay"
          data-skeleton-overlay=""
          data-skeleton-shapes={shapes.length}
          label={label}
        >
          {shapes.map((shape, index) => {
            const box: CSSProperties = {
              left: shape.x, top: shape.y, width: shape.width,
              height: shape.height, borderRadius: shape.radius
            };
            const style = shape.content ? {
              left: shape.content.x, top: shape.content.y,
              width: shape.content.width, height: shape.content.height,
              borderRadius: shape.radius
            } : box;
            const element = shape.kind === "frame" ? (
              <span
                aria-hidden="true"
                className="gn-auto-skeleton-frame"
                data-skeleton-kind={shape.content ? undefined : "frame"}
                key={index}
                style={style}
              />
            ) : (
              <Skeleton
                className="gn-auto-skeleton-shape"
                data-skeleton-kind={shape.content ? undefined : shape.kind}
                key={index}
                style={style}
                variant={shape.kind}
              />
            );
            return shape.content ? (
              <span
                aria-hidden="true"
                className="gn-auto-skeleton-clip"
                data-skeleton-kind={shape.kind}
                key={index}
                style={{ ...box, borderRadius: 0 }}
              >
                {element}
              </span>
            ) : element;
          })}
        </SkeletonSurface>
      )}
    </div>
  );
}

function equalSkeletonShapes(
  current: SkeletonLayoutShape[],
  next: SkeletonLayoutShape[]
): boolean {
  return current.length === next.length && current.every((shape, index) => {
    const candidate = next[index]!;
    return shape.kind === candidate.kind && shape.x === candidate.x &&
      shape.y === candidate.y && shape.width === candidate.width &&
      shape.height === candidate.height && shape.radius === candidate.radius &&
      (shape.content === candidate.content ||
        Boolean(shape.content && candidate.content &&
          shape.content.x === candidate.content.x &&
          shape.content.y === candidate.content.y &&
          shape.content.width === candidate.content.width &&
          shape.content.height === candidate.content.height));
  });
}

export function useSkeletonVisibility(
  loading: boolean,
  hasContent: boolean
): boolean {
  // Loading still reserves its layout immediately. Only its visual presentation
  // is delayed by SkeletonSurface; never expose an empty/error child while waiting
  // or artificially hold back a completed result with a minimum-duration timer.
  return loading && !hasContent;
}

function mergeClassNames(
  ...classNames: Array<string | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
