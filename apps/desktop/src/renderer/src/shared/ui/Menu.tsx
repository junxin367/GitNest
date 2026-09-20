import { Button } from "./Button";
import {
  useCallback,
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useLayoutEffect,
  useRef,
  useState
} from "react";

import { LayerPortal } from "./LayerPortal";

export interface MenuProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export type MenuSide = "top" | "right" | "bottom" | "left";
export type MenuAlign = "start" | "center" | "end";

interface MenuRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface MenuSize {
  height: number;
  width: number;
}

interface MenuViewport {
  height: number;
  width: number;
}

export interface MenuPlacementOptions {
  align?: MenuAlign;
  gap?: number;
  side?: MenuSide;
  viewportPadding?: number;
}

export interface MenuPlacement {
  left: number;
  side: MenuSide;
  top: number;
}

export interface MenuPopoverProps extends MenuProps {
  anchor: HTMLElement | null;
  align?: MenuAlign;
  gap?: number;
  side?: MenuSide;
  viewportPadding?: number;
}

export const Menu = forwardRef<HTMLDivElement, MenuProps>(
  function Menu(
    { children, className, onKeyDown, ...props },
    ref
  ) {
    const handleKeyDown = (
      event: KeyboardEvent<HTMLDivElement>
    ) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) {
        return;
      }

      const items = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
          '[role^="menuitem"]:not(:disabled)'
        )
      );
      const currentIndex = items.findIndex(
        (item) => item === document.activeElement
      );
      let nextIndex: number | undefined;

      if (event.key === "ArrowDown") {
        nextIndex = (currentIndex + 1) % items.length;
      } else if (event.key === "ArrowUp") {
        nextIndex =
          (currentIndex - 1 + items.length) % items.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = items.length - 1;
      }

      if (nextIndex === undefined || items.length === 0) {
        return;
      }
      event.preventDefault();
      items[nextIndex]?.focus();
    };

    return (
      <div
        {...props}
        className={mergeClassNames("menu-surface", className)}
        onKeyDown={handleKeyDown}
        ref={ref}
        role={props.role ?? "menu"}
      >
        {children}
      </div>
    );
  }
);

export const MenuPopover = forwardRef<
  HTMLDivElement,
  MenuPopoverProps
>(function MenuPopover(
  {
    align = "start",
    anchor,
    gap = 4,
    side = "right",
    style,
    viewportPadding = 8,
    ...props
  },
  forwardedRef
) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] =
    useState<MenuPlacement | null>(null);
  const setMenuRef = useCallback(
    (node: HTMLDivElement | null) => {
      menuRef.current = node;
      assignRef(forwardedRef, node);
    },
    [forwardedRef]
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!anchor || !menu) {
      setPlacement(null);
      return;
    }

    const updatePlacement = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      setPlacement(
        resolveMenuPlacement(
          anchorRect,
          menuRect,
          {
            height: window.innerHeight,
            width: window.innerWidth
          },
          {
            align,
            gap,
            side,
            viewportPadding
          }
        )
      );
    };
    const handleScroll = (event: Event) => {
      if (isEventInsideMenu(event, menu)) {
        return;
      }
      updatePlacement();
    };

    updatePlacement();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updatePlacement);
    resizeObserver?.observe(anchor);
    resizeObserver?.observe(menu);
    window.addEventListener("resize", updatePlacement);
    document.addEventListener(
      "scroll",
      handleScroll,
      true
    );

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePlacement);
      document.removeEventListener(
        "scroll",
        handleScroll,
        true
      );
    };
  }, [align, anchor, gap, side, viewportPadding]);

  return (
    <LayerPortal>
      <Menu
        {...props}
        data-menu-side={placement?.side ?? side}
        ref={setMenuRef}
        style={{
          ...style,
          left: placement?.left ?? 0,
          pointerEvents: placement
            ? style?.pointerEvents
            : "none",
          position: "fixed",
          top: placement?.top ?? 0,
          visibility: placement
            ? style?.visibility
            : "hidden"
        }}
      />
    </LayerPortal>
  );
});

export function isEventInsideMenu(
  event: Event,
  menu: HTMLElement | null
): boolean {
  if (!menu) {
    return false;
  }
  if (
    typeof event.composedPath === "function" &&
    event.composedPath().includes(menu)
  ) {
    return true;
  }
  return (
    event.target instanceof Node &&
    menu.contains(event.target)
  );
}

export function resolveMenuPlacement(
  anchor: MenuRect,
  menu: MenuSize,
  viewport: MenuViewport,
  {
    align = "start",
    gap = 4,
    side = "right",
    viewportPadding = 8
  }: MenuPlacementOptions = {}
): MenuPlacement {
  const resolvedSide = sideFits(
    anchor,
    menu,
    viewport,
    side,
    gap,
    viewportPadding
  )
    ? side
    : oppositeSide(side);
  const crossAxisPosition =
    resolvedSide === "left" || resolvedSide === "right"
      ? alignPosition(anchor.top, anchor.bottom, menu.height, align)
      : alignPosition(anchor.left, anchor.right, menu.width, align);
  const rawLeft =
    resolvedSide === "right"
      ? anchor.right + gap
      : resolvedSide === "left"
        ? anchor.left - menu.width - gap
        : crossAxisPosition;
  const rawTop =
    resolvedSide === "bottom"
      ? anchor.bottom + gap
      : resolvedSide === "top"
        ? anchor.top - menu.height - gap
        : crossAxisPosition;

  return {
    left: clampToViewport(
      rawLeft,
      menu.width,
      viewport.width,
      viewportPadding
    ),
    side: resolvedSide,
    top: clampToViewport(
      rawTop,
      menu.height,
      viewport.height,
      viewportPadding
    )
  };
}

interface MenuHeadingProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function MenuHeading({
  children,
  className,
  ...props
}: MenuHeadingProps) {
  return (
    <span
      {...props}
      className={mergeClassNames("menu-heading", className)}
    >
      {children}
    </span>
  );
}

export interface MenuItemProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  tone?: "default" | "danger";
}

export const MenuItem = forwardRef<
  HTMLButtonElement,
  MenuItemProps
>(function MenuItem(
  {
    children,
    className,
    leading,
    role = "menuitem",
    tone = "default",
    trailing,
    type = "button",
    ...props
  },
  ref
) {
  return (
    <Button variant="unstyled"
      {...props}
      className={mergeClassNames(
        "menu-item",
        tone === "danger" ? "danger" : undefined,
        className
      )}
      data-has-leading={Boolean(leading)}
      data-has-trailing={Boolean(trailing)}
      ref={ref}
      role={role}
      type={type}
    >
      {leading ? (
        <span className="menu-item-leading">{leading}</span>
      ) : null}
      <span className="menu-item-label">{children}</span>
      {trailing ? (
        <span className="menu-item-trailing">{trailing}</span>
      ) : null}
    </Button>
  );
});

export function MenuSeparator({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={mergeClassNames("menu-separator", className)}
    />
  );
}

function mergeClassNames(
  ...classNames: Array<string | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}

function sideFits(
  anchor: MenuRect,
  menu: MenuSize,
  viewport: MenuViewport,
  side: MenuSide,
  gap: number,
  viewportPadding: number
): boolean {
  if (side === "right") {
    return (
      anchor.right + gap + menu.width <=
      viewport.width - viewportPadding
    );
  }
  if (side === "left") {
    return (
      anchor.left - gap - menu.width >= viewportPadding
    );
  }
  if (side === "bottom") {
    return (
      anchor.bottom + gap + menu.height <=
      viewport.height - viewportPadding
    );
  }
  return anchor.top - gap - menu.height >= viewportPadding;
}

function oppositeSide(side: MenuSide): MenuSide {
  if (side === "right") {
    return "left";
  }
  if (side === "left") {
    return "right";
  }
  if (side === "bottom") {
    return "top";
  }
  return "bottom";
}

function alignPosition(
  start: number,
  end: number,
  size: number,
  align: MenuAlign
): number {
  if (align === "end") {
    return end - size;
  }
  if (align === "center") {
    return start + (end - start - size) / 2;
  }
  return start;
}

function clampToViewport(
  value: number,
  size: number,
  viewportSize: number,
  viewportPadding: number
): number {
  const maximum = Math.max(
    viewportPadding,
    viewportSize - size - viewportPadding
  );
  return Math.min(
    maximum,
    Math.max(viewportPadding, value)
  );
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
}
