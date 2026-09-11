import { Button } from "../../shared/ui/Button";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";

import type {
  ExternalApplicationKindDto,
  ExternalApplicationProfileDto
} from "@gitnest/contracts";

import type { ExternalApplicationController } from "../../features/external-application/useExternalApplications";
import { Icon } from "../../shared/ui/Icon";
import {
  MenuHeading,
  MenuItem,
  MenuPopover
} from "../../shared/ui/Menu";

const gitBashIconUrl = new URL(
  "./git-bash.ico",
  import.meta.url
).href;

interface OpenInControlProps {
  applications: ExternalApplicationController;
  scope: "workspace" | "repository";
}

export function OpenInControl({
  applications,
  scope
}: OpenInControlProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const preferred = applications.preferredProfile;
  const disabled =
    applications.loading ||
    applications.active !== null ||
    !preferred;
  const contextLabel =
    scope === "workspace" ? "Workspace 根目录" : "当前 Worktree";
  const primaryActionLabel = preferred
    ? applications.active === preferred.kind
      ? `正在使用 ${preferred.label} 打开${contextLabel}`
      : `使用 ${preferred.label} 打开${contextLabel}`
    : applications.loading
      ? "正在检测可用的本地应用"
      : "未检测到可用的本地应用";

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const close = () => setMenuOpen(false);
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();

    return () => {
      document.removeEventListener(
        "pointerdown",
        handlePointerDown
      );
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuOpen]);

  const menu =
    menuOpen
      ? (
        <MenuPopover
          align="end"
          anchor={triggerRef.current}
          aria-label={`选择用于打开${contextLabel}的应用`}
          className="open-in-menu"
          ref={menuRef}
          side="bottom"
        >
          <MenuHeading>Open in</MenuHeading>
          {applications.profiles.map((profile) => (
            <MenuItem
              key={profile.kind}
              leading={<ApplicationIcon profile={profile} />}
              onClick={() => {
                setMenuOpen(false);
                void applications.open(profile.kind);
              }}
            >
              {profile.label}
            </MenuItem>
          ))}
        </MenuPopover>
      )
      : null;

  return (
    <>
      <div className="open-in-control" ref={rootRef}>
        <Button variant="unstyled"
          aria-busy={
            preferred
              ? applications.active === preferred.kind
              : false
          }
          aria-label={primaryActionLabel}
          className="open-in-primary"
          disabled={disabled}
          onClick={() => {
            if (preferred) {
              void applications.open(preferred.kind);
            }
          }}
          title={primaryActionLabel}
          type="button"
        >
          {preferred ? (
            <ApplicationIcon profile={preferred} />
          ) : (
            <Icon name="external" size={14} />
          )}
        </Button>
        <Button variant="unstyled"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="选择打开方式"
          className="open-in-menu-trigger"
          disabled={
            applications.loading ||
            applications.active !== null ||
            applications.profiles.length === 0
          }
          onClick={() => {
            if (menuOpen) {
              setMenuOpen(false);
              return;
            }
            setMenuOpen(true);
            void applications.reload();
          }}
          ref={triggerRef}
          title="选择另一个本地应用"
          type="button"
        >
          <Icon
            className={menuOpen ? "open-in-chevron-open" : ""}
            name="chevron"
            size={12}
          />
        </Button>
      </div>
      {menu}
    </>
  );
}

export function ApplicationIcon({
  profile
}: {
  profile: ExternalApplicationProfileDto;
}): ReactNode {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [profile.iconDataUrl]);

  if (profile.kind === "git-bash") {
    return (
      <img
        alt=""
        className="open-in-app-icon open-in-app-icon-native"
        src={gitBashIconUrl}
      />
    );
  }

  if (profile.iconDataUrl && !imageFailed) {
    return (
      <img
        alt=""
        className="open-in-app-icon open-in-app-icon-native"
        onError={() => setImageFailed(true)}
        src={profile.iconDataUrl}
      />
    );
  }

  return <ApplicationFallbackIcon kind={profile.kind} />;
}

function ApplicationFallbackIcon({
  kind
}: {
  kind: ExternalApplicationKindDto;
}): ReactNode {
  switch (kind) {
    case "vscode":
      return (
        <svg
          aria-hidden="true"
          className="open-in-app-icon"
          viewBox="0 0 24 24"
        >
          <path
            d="M17.25 2.8 7.57 11.6 3.4 8.43 1.5 9.5v5l1.9 1.08 4.17-3.18 9.68 8.8L22.5 19V5l-5.25-2.2Zm-.2 5.08v8.24L11.75 12l5.3-4.12Z"
            fill="#23a9f2"
          />
        </svg>
      );
    case "cursor":
      return (
        <svg
          aria-hidden="true"
          className="open-in-app-icon"
          viewBox="0 0 24 24"
        >
          <rect fill="#f7f7f7" height="22" rx="5" width="22" x="1" y="1" />
          <path d="m12 3.5 8.5 8.5-8.5 8.5L3.5 12 12 3.5Z" fill="#111" />
          <path d="m12 8 4 4-4 4-4-4 4-4Z" fill="#f7f7f7" />
        </svg>
      );
    case "intellij-idea":
      return (
        <svg
          aria-hidden="true"
          className="open-in-app-icon"
          viewBox="0 0 24 24"
        >
          <rect fill="#ff2d8d" height="22" rx="4" width="22" x="1" y="1" />
          <path d="M1 14 14 1h9v8L9 23H1v-9Z" fill="#6b45ff" />
          <path d="m12 23 11-11v11H12Z" fill="#22c7e8" />
          <rect fill="#090909" height="14" width="14" x="5" y="5" />
          <path d="M8 8h1.6v6H8V8Zm3 0h4v1.4h-2.35v2.8c0 .45-.1.85-.3 1.18-.2.34-.48.6-.84.78-.35.18-.77.27-1.25.27H10v-1.4h.25c.25 0 .44-.07.57-.2.13-.14.2-.34.2-.61V8Z" fill="#fff" />
          <path d="M8 16h6" stroke="#fff" strokeWidth="1.2" />
        </svg>
      );
    case "sublime-text":
      return (
        <svg
          aria-hidden="true"
          className="open-in-app-icon"
          viewBox="0 0 24 24"
        >
          <rect fill="#303030" height="22" rx="4" width="22" x="1" y="1" />
          <path d="m5 7.2 13-3v4.6l-8.6 2L18 13v4.6L5 20.6V16l8.7-2L5 11.8V7.2Z" fill="#ff9800" />
        </svg>
      );
    case "file-explorer":
      return (
        <svg
          aria-hidden="true"
          className="open-in-app-icon"
          viewBox="0 0 24 24"
        >
          <path d="M2 6.5A2.5 2.5 0 0 1 4.5 4H10l2 2h7.5A2.5 2.5 0 0 1 22 8.5V19H2V6.5Z" fill="#f8c642" />
          <path d="M2 9h20v10.5A2.5 2.5 0 0 1 19.5 22h-15A2.5 2.5 0 0 1 2 19.5V9Z" fill="#e7a91c" />
          <path d="M8 8h8v4H8z" fill="#52a8e8" />
        </svg>
      );
    case "terminal":
      return (
        <svg
          aria-hidden="true"
          className="open-in-app-icon"
          viewBox="0 0 24 24"
        >
          <rect fill="#20242b" height="22" rx="4" width="22" x="1" y="1" />
          <path d="m6 8 4 4-4 4M12 16h6" fill="none" stroke="#f5f7fa" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      );
  }
}
