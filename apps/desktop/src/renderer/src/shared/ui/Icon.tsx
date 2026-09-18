import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "activity"
  | "commit"
  | "branch"
  | "check"
  | "chevron"
  | "close"
  | "collapse"
  | "copy"
  | "diff"
  | "download"
  | "external"
  | "arrowDown"
  | "arrowUp"
  | "eye"
  | "files"
  | "fileCode"
  | "filter"
  | "folder"
  | "grid"
  | "graph"
  | "history"
  | "layers"
  | "maximize"
  | "minimize"
  | "minus"
  | "more"
  | "moon"
  | "operations"
  | "panel"
  | "plus"
  | "refresh"
  | "repository"
  | "search"
  | "settings"
  | "sparkle"
  | "sidebarCollapse"
  | "sidebarExpand"
  | "sun"
  | "tag"
  | "terminal"
  | "upload"
  | "undo"
  | "warning"
  | "wrap"
  | "worktree";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({
  name,
  size = 16,
  className,
  ...props
}: IconProps): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className={["icon", className].filter(Boolean).join(" ")}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {renderIcon(name)}
    </svg>
  );
}

function renderIcon(name: IconName): ReactNode {
  switch (name) {
    case "activity":
      return (
        <>
          <path d="M4 19V9" />
          <path d="M10 19V5" />
          <path d="M16 19v-7" />
          <path d="M22 19V3" />
        </>
      );
    case "branch":
      return (
        <>
          <circle cx="6" cy="5" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="6" cy="19" r="2" />
          <path d="M6 7v10" />
          <path d="M8 7c6 0 4 5 8 5h2" />
        </>
      );
    case "commit":
      return (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M2 12h6" />
          <path d="M16 12h6" />
        </>
      );
    case "check":
      return <path d="m5 12 4 4L19 6" />;
    case "chevron":
      return <path d="m8 10 4 4 4-4" />;
    case "close":
      return (
        <>
          <path d="m6 6 12 12" />
          <path d="M18 6 6 18" />
        </>
      );
    case "collapse":
      return <path d="m9 18 6-6-6-6" />;
    case "copy":
      return (
        <>
          <rect height="13" rx="2" width="11" x="8" y="8" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </>
      );
    case "diff":
      return (
        <>
          <path d="M6 3v12" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 21V9" />
          <circle cx="18" cy="6" r="3" />
          <path d="M6 8h7a5 5 0 0 1 5 5" />
        </>
      );
    case "arrowDown":
      return (
        <>
          <path d="M12 4v16" />
          <path d="m6 14 6 6 6-6" />
        </>
      );
    case "arrowUp":
      return (
        <>
          <path d="M12 20V4" />
          <path d="m6 10 6-6 6 6" />
        </>
      );
    case "download":
      return (
        <>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </>
      );
    case "eye":
      return (
        <>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      );
    case "external":
      return (
        <>
          <path d="M14 5h5v5" />
          <path d="m19 5-8 8" />
          <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
        </>
      );
    case "files":
      return (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6" />
          <path d="M9 17h4" />
        </>
      );
    case "fileCode":
      return (
        <>
          <path d="M6 2h8l4 4v16H6z" />
          <path d="M14 2v5h5" />
          <path d="m10 11-2 2 2 2" />
          <path d="m14 11 2 2-2 2" />
        </>
      );
    case "filter":
      return <path d="M4 5h16l-6 7v6l-4 2v-8z" />;
    case "folder":
      return (
        <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
      );
    case "grid":
      return (
        <>
          <rect height="7" rx="1.5" width="7" x="3" y="3" />
          <rect height="7" rx="1.5" width="7" x="14" y="3" />
          <rect height="7" rx="1.5" width="7" x="3" y="14" />
          <rect height="7" rx="1.5" width="7" x="14" y="14" />
        </>
      );
    case "graph":
      return (
        <>
          <circle cx="5" cy="6" r="2" />
          <circle cx="19" cy="5" r="2" />
          <circle cx="8" cy="19" r="2" />
          <circle cx="19" cy="18" r="2" />
          <path d="m7 6 10-1M6 8l2 9M10 18l7-1M18 7v9M7 7l10 9" />
        </>
      );
    case "history":
      return (
        <>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l4 2" />
        </>
      );
    case "layers":
      return (
        <>
          <path d="m12 2 9 5-9 5-9-5z" />
          <path d="m3 12 9 5 9-5" />
          <path d="m3 17 9 5 9-5" />
        </>
      );
    case "maximize":
      return <rect height="12" rx="1" width="12" x="6" y="6" />;
    case "minimize":
      return <path d="M6 12h12" />;
    case "minus":
      return <path d="M6 12h12" />;
    case "more":
      return (
        <>
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </>
      );
    case "moon":
      return <path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5Z" />;
    case "operations":
      return (
        <>
          <path d="M4 7h10" />
          <path d="M4 12h16" />
          <path d="M4 17h8" />
          <circle cx="18" cy="7" r="2" />
          <circle cx="14" cy="17" r="2" />
        </>
      );
    case "panel":
      return (
        <>
          <rect height="16" rx="2" width="18" x="3" y="4" />
          <path d="M15 4v16" />
        </>
      );
    case "plus":
      return (
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      );
    case "refresh":
      return (
        <>
          <path d="M20 7v5h-5" />
          <path d="M4 17v-5h5" />
          <path d="M6.1 8a7 7 0 0 1 11.6-1L20 12" />
          <path d="M17.9 16a7 7 0 0 1-11.6 1L4 12" />
        </>
      );
    case "repository":
      return (
        <>
          <path d="M6 3.5h10a2 2 0 0 1 2 2v15H8a2 2 0 0 1-2-2z" />
          <path d="M6 17.5h12" />
          <path d="M9 3.5v14" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m16 16 5 5" />
        </>
      );
    case "settings":
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
        </>
      );
    case "sparkle":
      return (
        <>
          <path d="m12 2 1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5z" />
          <path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" />
          <path d="m5 13 .7 2.3L8 16l-2.3.7L5 19l-.7-2.3L2 16l2.3-.7z" />
        </>
      );
    case "sidebarCollapse":
      return (
        <>
          <rect height="16" rx="2" width="18" x="3" y="4" />
          <path d="M9 4v16" />
          <path d="m15 9-3 3 3 3" />
        </>
      );
    case "sidebarExpand":
      return (
        <>
          <rect height="16" rx="2" width="18" x="3" y="4" />
          <path d="M15 4v16" />
          <path d="m9 9 3 3-3 3" />
        </>
      );
    case "sun":
      return (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.9 4.9 1.4 1.4" />
          <path d="m17.7 17.7 1.4 1.4" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m4.9 19.1 1.4-1.4" />
          <path d="m17.7 6.3 1.4-1.4" />
        </>
      );
    case "tag":
      return (
        <>
          <path d="M20.59 13.41 13.41 20.59a2 2 0 0 1-2.82 0L3.41 13.41a2 2 0 0 1 0-2.82L10.59 3.41A2 2 0 0 1 12 3h6a2 2 0 0 1 2 2v6a2 2 0 0 1-.59 1.41Z" />
          <circle cx="16" cy="7" r="1.25" />
        </>
      );
    case "terminal":
      return (
        <>
          <path d="m5 7 4 4-4 4" />
          <path d="M11 17h8" />
        </>
      );
    case "upload":
      return (
        <>
          <path d="M12 21V9" />
          <path d="m7 14 5-5 5 5" />
          <path d="M5 3h14" />
        </>
      );
    case "undo":
      return (
        <>
          <path d="M9 7 4 12l5 5" />
          <path d="M4 12h9a7 7 0 0 1 7 7" />
        </>
      );
    case "warning":
      return (
        <>
          <path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.5L13.7 4.2a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </>
      );
    case "wrap":
      return (
        <>
          <path d="M4 6h11" />
          <path d="M4 10h13a3 3 0 0 1 0 6h-3" />
          <path d="m16 13-3 3 3 3" />
          <path d="M4 16h5" />
        </>
      );
    case "worktree":
      return (
        <>
          <circle cx="12" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="19" r="2" />
          <path d="M12 7v5" />
          <path d="M6 17v-2.5A2.5 2.5 0 0 1 8.5 12h7A2.5 2.5 0 0 1 18 14.5V17" />
        </>
      );
  }
}
