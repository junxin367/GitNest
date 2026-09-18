import type {
  MouseEvent as ReactMouseEvent,
  ReactNode
} from "react";

import type { RepositoryMediaPreviewDto } from "@gitnest/contracts";

import type {
  DiffHunkContextRange,
  DiffViewerLayout
} from "../../shared/model/diffViewModel";
import type { IconName } from "../../shared/ui/Icon";
import type { DiffDocumentFeatureConfig } from "./diffWorkspaceConfiguration";

export type DiffPathCopyStatus =
  | "idle"
  | "copied"
  | "failed";

export const DEFAULT_DIFF_CONTEXT_LINES = 3;
export const DIFF_CONTEXT_STEP = 10;
export const FULL_DIFF_CONTEXT_LINES = 100_000;

export type DiffContextDirection =
  | "up"
  | "down"
  | "around"
  | "all"
  | "reset";

export interface DiffContextRequest {
  direction: DiffContextDirection;
  hunkIndex: number;
  contextLines: number;
}

export interface DiffHunkContextState
  extends DiffHunkContextRange {
  full: boolean;
}

export interface DiffPanelState {
  icon: Extract<
    IconName,
    | "check"
    | "eye"
    | "fileCode"
    | "files"
    | "refresh"
    | "search"
    | "warning"
  >;
  title: string;
  message: string;
  busy?: boolean;
}

export interface DiffPanelProps {
  config: DiffDocumentFeatureConfig;
  scopeKey: string;
  searchScopeKey?: string | undefined;
  path?: string | undefined;
  content?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
  statsAvailable?: boolean | undefined;
  binary?: boolean | undefined;
  media?: RepositoryMediaPreviewDto | undefined;
  truncated?: boolean | undefined;
  maxLines?: number | undefined;
  emptyPathLabel?: string | undefined;
  emptyStatsLabel?: string | undefined;
  state?: DiffPanelState | undefined;
  focusLine?: number | undefined;
  headerActions?: ReactNode | undefined;
  className?: string | undefined;
  keyboardShortcutsEnabled?: boolean | undefined;
  searchOpen?: boolean | undefined;
  onSearchOpenChange?(open: boolean): void;
  onPathCopyStatusChange?(
    status: DiffPathCopyStatus
  ): void;
  preferredLayout?: DiffViewerLayout | undefined;
  preferredWrap?: boolean | undefined;
  onLayoutPreferenceChange?(
    layout: DiffViewerLayout
  ): void;
  onWrapPreferenceChange?(wrap: boolean): void;
  contextLines?: number | undefined;
  contextLoading?: boolean | undefined;
  onContextRequest?(
    request: DiffContextRequest
  ): void;
}

export interface DiffHunkContextControlsProps {
  hunkContextStates: Readonly<
    Record<number, DiffHunkContextState>
  >;
  contextLoading: boolean;
  onContextMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    hunkIndex: number
  ): void;
  onContextRequest(request: DiffContextRequest): void;
}
