import React, {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode
} from "react";

export type ButtonSize = "small" | "medium" | "large";
export type ButtonVariant =
  | "default"
  | "primary"
  | "danger"
  | "toolbar"
  | "quick"
  | "icon";

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  emphasis?: "primary" | "strong";
  fullWidth?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
  iconPosition?: "before" | "after";
  loading?: boolean;
  selected?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonProps
>(function Button(
  {
    children,
    className,
    disabled = false,
    emphasis,
    fullWidth = false,
    icon,
    iconOnly = false,
    iconPosition = "before",
    loading = false,
    selected = false,
    size = "medium",
    type = "button",
    variant = "default",
    ...props
  },
  ref
) {
  const resolvedIconOnly = iconOnly || variant === "icon";
  const iconNode = icon ? (
    <span className="gn-button__icon">{icon}</span>
  ) : null;
  const labelNode =
    resolvedIconOnly || children === undefined ? null : (
      <span className="gn-button__label">{children}</span>
    );

  return (
    <button
      {...props}
      aria-busy={loading || props["aria-busy"]}
      className={mergeClassNames(
        "gn-button",
        loading ? "is-loading" : undefined,
        className
      )}
      data-emphasis={emphasis}
      data-full-width={fullWidth}
      data-icon-only={resolvedIconOnly}
      data-selected={selected || undefined}
      data-size={size}
      data-variant={variant}
      disabled={disabled || loading}
      ref={ref}
      type={type}
    >
      {iconPosition === "after" ? (
        <>
          {labelNode}
          {iconNode}
        </>
      ) : (
        <>
          {iconNode}
          {labelNode}
        </>
      )}
    </button>
  );
});

function mergeClassNames(
  ...classNames: Array<string | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
