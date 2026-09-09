import React, {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode
} from "react";

import { Icon } from "./Icon";

export type InputSize = "small" | "medium" | "large";
export type InputState = "default" | "error";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  clearLabel?: string;
  fieldClassName?: string;
  fullWidth?: boolean;
  helpText?: string;
  inputClassName?: string;
  label?: string;
  leading?: ReactNode;
  onClear?: () => void;
  size?: InputSize;
  state?: InputState;
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      "aria-invalid": ariaInvalid,
      className,
      clearLabel = "清除内容",
      disabled = false,
      fieldClassName,
      fullWidth = false,
      helpText,
      id,
      inputClassName,
      label,
      leading,
      onClear,
      size = "medium",
      state = "default",
      trailing,
      type = "text",
      ...props
    },
    ref
  ) {
    const hasTrailing = Boolean(trailing || onClear);

    return (
      <div
        className={mergeClassNames(
          "gn-input-field",
          fieldClassName
        )}
        data-full-width={fullWidth}
      >
        {label && id ? (
          <label className="gn-input-field__label" htmlFor={id}>
            {label}
          </label>
        ) : null}
        <div
          className={mergeClassNames("gn-input", className)}
          data-disabled={disabled}
          data-full-width={fullWidth}
          data-has-leading={Boolean(leading)}
          data-has-trailing={hasTrailing}
          data-size={size}
          data-state={state}
        >
          {leading ? (
            <span className="gn-input__leading">{leading}</span>
          ) : null}
          <input
            {...props}
            aria-invalid={
              ariaInvalid ?? (state === "error" ? true : undefined)
            }
            className={mergeClassNames(
              "gn-input__control",
              inputClassName
            )}
            disabled={disabled}
            id={id}
            ref={ref}
            type={type}
          />
          {hasTrailing ? (
            <span className="gn-input__trailing">
              {trailing}
              {onClear ? (
                <button
                  aria-label={clearLabel}
                  className="gn-input__clear"
                  onClick={onClear}
                  title={clearLabel}
                  type="button"
                >
                  <Icon name="close" size={12} />
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
        {helpText ? (
          <small
            className="gn-input-field__help"
            data-state={state}
          >
            {helpText}
          </small>
        ) : null}
      </div>
    );
  }
);

function mergeClassNames(
  ...classNames: Array<string | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
