import {
  forwardRef,
  type TextareaHTMLAttributes
} from "react";

export type TextareaSize = "small" | "medium" | "large";
export type TextareaState = "default" | "error";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  fieldClassName?: string;
  fullWidth?: boolean;
  helpText?: string;
  label?: string;
  size?: TextareaSize;
  state?: TextareaState;
  textareaClassName?: string;
}

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaProps
>(function Textarea(
  {
    "aria-invalid": ariaInvalid,
    className,
    disabled = false,
    fieldClassName,
    fullWidth = false,
    helpText,
    id,
    label,
    size = "medium",
    state = "default",
    textareaClassName,
    ...props
  },
  ref
) {
  return (
    <div
      className={mergeClassNames(
        "gn-textarea-field",
        fieldClassName
      )}
      data-full-width={fullWidth}
    >
      {label && id ? (
        <label className="gn-textarea-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div
        className={mergeClassNames("gn-textarea", className)}
        data-disabled={disabled}
        data-full-width={fullWidth}
        data-size={size}
        data-state={state}
      >
        <textarea
          {...props}
          aria-invalid={
            ariaInvalid ?? (state === "error" ? true : undefined)
          }
          className={mergeClassNames(
            "gn-textarea__control",
            textareaClassName
          )}
          disabled={disabled}
          id={id}
          ref={ref}
        />
      </div>
      {helpText ? (
        <small
          className="gn-textarea-field__help"
          data-state={state}
        >
          {helpText}
        </small>
      ) : null}
    </div>
  );
});

function mergeClassNames(
  ...classNames: Array<string | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
