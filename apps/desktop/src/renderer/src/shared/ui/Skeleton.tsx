import React, {
  createElement,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode
} from "react";

import { useMinimumLoadingIndicator } from "../lib/useMinimumLoadingIndicator";

export type SkeletonVariant = "block" | "circle" | "text";

export interface SkeletonProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  height?: CSSProperties["height"];
  variant?: SkeletonVariant;
  width?: CSSProperties["width"];
}

export interface SkeletonSurfaceProps
  extends HTMLAttributes<HTMLElement> {
  as?: "article" | "aside" | "div" | "section";
  label: string;
}

export interface SkeletonBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
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
  ...props
}: SkeletonSurfaceProps) {
  return createElement(
    as,
    {
      ...props,
      "aria-busy": "true",
      "aria-label": label,
      className: mergeClassNames("gn-skeleton-surface", className),
      role: "status"
    },
    children
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
  const visible = useMinimumLoadingIndicator(
    loading && !hasContent
  );

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

function mergeClassNames(
  ...classNames: Array<string | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
