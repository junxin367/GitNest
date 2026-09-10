import { Button } from "./Button";
import React, {
  Children,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

import { Icon, type IconName } from "./Icon";

export type ToastTone = "success" | "error" | "info";

interface ToastProps {
  title: string;
  message: string;
  tone?: ToastTone;
  icon?: IconName;
  onClose?: () => void;
  closeLabel?: string;
}

interface ToastViewportProps {
  children: ReactNode;
}

export function Toast({
  title,
  message,
  tone = "info",
  icon,
  onClose,
  closeLabel = "关闭提示"
}: ToastProps) {
  const iconName =
    icon ??
    (tone === "error"
      ? "warning"
      : tone === "success"
        ? "check"
        : "operations");

  return (
    <div
      aria-atomic="true"
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`toast toast-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span className="toast-icon">
        <Icon name={iconName} size={18} />
      </span>
      <div className="toast-copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {onClose && (
        <Button variant="unstyled"
          aria-label={closeLabel}
          className="toast-close"
          onClick={onClose}
          title={closeLabel}
          type="button"
        >
          <Icon name="close" size={14} />
        </Button>
      )}
    </div>
  );
}

export function ToastViewport({
  children
}: ToastViewportProps) {
  const items = Children.toArray(children);
  if (items.length === 0) {
    return null;
  }

  const viewport = (
    <div className="toast-viewport" aria-label="消息提示">
      {items}
    </div>
  );

  if (typeof document === "undefined" || !document.body) {
    return viewport;
  }

  return createPortal(viewport, document.body);
}
