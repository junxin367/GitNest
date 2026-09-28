import {
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
  | "icon"
  | "unstyled";

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
    size = "small",
    type = "button",
    variant = "default",
    ...props
  },
  ref
) {
  const unstyled = variant === "unstyled";
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
      className={
        unstyled
          ? className
          : mergeClassNames(
              "gn-button",
              loading ? "is-loading" : undefined,
              className
            )
      }
      data-emphasis={unstyled ? undefined : emphasis}
      data-full-width={unstyled ? undefined : fullWidth}
      data-icon-only={unstyled ? undefined : resolvedIconOnly}
      data-selected={
        unstyled ? undefined : selected || undefined
      }
      data-size={unstyled ? undefined : size}
      data-variant={unstyled ? undefined : variant}
      disabled={disabled || loading}
      ref={ref}
      type={type}
    >
      {unstyled ? (
        children
      ) : iconPosition === "after" ? (
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
