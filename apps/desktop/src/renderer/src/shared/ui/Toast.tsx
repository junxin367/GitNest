import { Button } from "./Button";
import {
  Children,
  useEffect,
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
  duration?: number;
}

interface ToastViewportProps {
  children: ReactNode;
}

let globalViewport: HTMLDivElement | null = null;
let activeViewportUsers = 0;

function ensureGlobalViewport(): HTMLDivElement {
  if (globalViewport && document.body.contains(globalViewport)) {
    return globalViewport;
  }

  const existing = document.querySelector<HTMLDivElement>(
    '.toast-viewport[data-toast-viewport="true"]'
  );
  if (existing) {
    globalViewport = existing;
    return existing;
  }

  const viewport = document.createElement("div");
  viewport.className = "toast-viewport";
  viewport.dataset.toastViewport = "true";
  viewport.setAttribute("aria-label", "消息提示");
  document.body.append(viewport);
  globalViewport = viewport;
  return viewport;
}

function releaseGlobalViewport(): void {
  if (
    activeViewportUsers > 0 ||
    !globalViewport ||
    globalViewport.childElementCount > 0
  ) {
    return;
  }

  globalViewport.remove();
  globalViewport = null;
}

export function Toast({
  title,
  message,
  tone = "info",
  icon,
  onClose,
  closeLabel = "关闭提示",
  duration = 3100
}: ToastProps) {
  const iconName =
    icon ??
    (tone === "error"
      ? "warning"
      : tone === "success"
        ? "check"
        : "operations");

  useEffect(() => {
    if (!onClose || duration <= 0) {
      return;
    }

    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onClose]);

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
  const hasItems = items.length > 0;

  useEffect(() => {
    if (
      !hasItems ||
      typeof document === "undefined" ||
      !document.body
    ) {
      return;
    }

    activeViewportUsers += 1;
    return () => {
      activeViewportUsers -= 1;
      releaseGlobalViewport();
    };
  }, [hasItems]);

  if (!hasItems) {
    return null;
  }

  if (typeof document === "undefined" || !document.body) {
    return (
      <div className="toast-viewport" aria-label="消息提示">
        {items}
      </div>
    );
  }

  const viewport = ensureGlobalViewport();
  return createPortal(items, viewport);
}
