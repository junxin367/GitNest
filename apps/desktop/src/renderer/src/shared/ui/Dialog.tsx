import {
  useEffect,
  useId,
  useRef,
  type ReactNode
} from "react";

import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { LayerPortal } from "./LayerPortal";
import { useModalFocusTrap } from "./useModalFocusTrap";

export type DialogSize =
  | "compact"
  | "target"
  | "information"
  | "complex";

interface DialogProps {
  ariaDescribedBy?: string;
  bodyClassName?: string;
  children?: ReactNode;
  className?: string;
  closeLabel?: string;
  dismissDisabled?: boolean;
  footer?: ReactNode;
  icon: IconName;
  onDismiss?(): void;
  role?: "dialog" | "alertdialog";
  showCloseButton?: boolean;
  size?: DialogSize;
  title: ReactNode;
  tone?: "default" | "danger";
}

export function Dialog({
  ariaDescribedBy,
  bodyClassName,
  children,
  className,
  closeLabel = "关闭弹窗",
  dismissDisabled = false,
  footer,
  icon,
  onDismiss,
  role = "dialog",
  showCloseButton = false,
  size = "complex",
  title,
  tone = "default"
}: DialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useModalFocusTrap(dialogRef);

  useEffect(() => {
    if (!onDismiss) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dismissDisabled) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () =>
      window.removeEventListener("keydown", handleKeyDown);
  }, [dismissDisabled, onDismiss]);

  const hasCloseButton = showCloseButton && Boolean(onDismiss);
  const hasBody =
    children !== null &&
    children !== undefined &&
    typeof children !== "boolean";
  const hasFooter =
    footer !== null &&
    footer !== undefined &&
    typeof footer !== "boolean";

  return (
    <LayerPortal>
      <div className="gn-dialog-backdrop" data-modal-layer>
        <section
          aria-describedby={ariaDescribedBy}
          aria-labelledby={titleId}
          aria-modal="true"
          className={mergeClassNames("gn-dialog", className)}
          data-size={size}
          data-tone={tone}
          ref={dialogRef}
          role={role}
        >
          <header
            className="gn-dialog__header"
            data-has-close={hasCloseButton}
          >
            <span className="gn-dialog__icon">
              <Icon name={icon} size={16} />
            </span>
            <h2 id={titleId}>{title}</h2>
            {hasCloseButton && (
              <Button
                aria-label={closeLabel}
                className="gn-dialog__close"
                disabled={dismissDisabled}
                icon={<Icon name="close" size={16} />}
                onClick={onDismiss}
                type="button"
                variant="icon"
              />
            )}
          </header>

          {hasBody && (
            <div
              className={mergeClassNames(
                "gn-dialog__body",
                bodyClassName
              )}
            >
              {children}
            </div>
          )}

          {hasFooter && (
            <footer className="gn-dialog__footer">
              <div className="gn-dialog__actions">
                {footer}
              </div>
            </footer>
          )}
        </section>
      </div>
    </LayerPortal>
  );
}

function mergeClassNames(
  ...classNames: Array<string | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
