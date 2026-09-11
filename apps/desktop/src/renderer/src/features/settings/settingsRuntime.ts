import type {
  AppSettingsDto,
  ExternalTerminalKindDto,
  ExternalTerminalProfileDto,
  RepositoryTargetDto
} from "@gitnest/contracts";

import type {
  AppView,
  RepositoryTab,
  WorkspaceTab
} from "../../app/navigation";

export interface StartupNavigation {
  view: Extract<AppView, "workspace" | "repository">;
  workspaceTab: WorkspaceTab;
  repositoryTab: RepositoryTab;
}

export function resolveStartupNavigation(
  settings: AppSettingsDto,
  hasSelectedTarget: boolean
): StartupNavigation {
  if (!settings.general.restoreLastView) {
    return {
      view: "workspace",
      workspaceTab: "overview",
      repositoryTab: "overview"
    };
  }
  if (
    settings.navigation.lastContentView === "repository" &&
    !hasSelectedTarget
  ) {
    return {
      view: "workspace",
      workspaceTab: "overview",
      repositoryTab: settings.navigation.repositoryTab
    };
  }
  return {
    view:
      settings.navigation.lastContentView === "repository" &&
      hasSelectedTarget
        ? "repository"
        : "workspace",
    workspaceTab: settings.navigation.workspaceTab,
    repositoryTab: settings.navigation.repositoryTab
  };
}

export function resolveDefaultTerminalProfile(
  profiles: readonly ExternalTerminalProfileDto[],
  preferredKind: ExternalTerminalKindDto | null
): ExternalTerminalProfileDto | undefined {
  return (
    profiles.find(
      (profile) => profile.kind === preferredKind
    ) ?? profiles[0]
  );
}

export function chunkRepositoryTargets(
  targets: readonly RepositoryTargetDto[],
  batchSize = 50
): RepositoryTargetDto[][] {
  const batches: RepositoryTargetDto[][] = [];
  for (
    let index = 0;
    index < targets.length;
    index += batchSize
  ) {
    batches.push(targets.slice(index, index + batchSize));
  }
  return batches;
}
