import type { DiffViewerLayout } from "../../shared/model/diffViewModel";

export interface DiffDocumentFeatureConfig {
  layouts: readonly DiffViewerLayout[];
  defaultLayout: DiffViewerLayout;
  showToolbar: boolean;
  allowWrap: boolean;
  showHunkNavigation: boolean;
  allowContextExpansion: boolean;
}

export interface DiffNavigationFeatureConfig {
  allowTreeView: boolean;
  allowRefresh: boolean;
}

export interface DiffWorkspaceExtensionConfig {
  openStandaloneDiff: boolean;
  commitRegion: boolean;
  pushRegion: boolean;
  statusbar: boolean;
}

export interface DiffWorkspaceConfiguration {
  document: DiffDocumentFeatureConfig;
  navigation: DiffNavigationFeatureConfig;
  extensions: DiffWorkspaceExtensionConfig;
}

export const standaloneDiffWorkspaceConfiguration = {
  document: {
    layouts: ["split", "unified"],
    defaultLayout: "unified",
    showToolbar: true,
    allowWrap: true,
    showHunkNavigation: true,
    allowContextExpansion: true
  },
  navigation: {
    allowTreeView: true,
    allowRefresh: true
  },
  extensions: {
    openStandaloneDiff: false,
    commitRegion: false,
    pushRegion: false,
    statusbar: true
  }
} as const satisfies DiffWorkspaceConfiguration;

export const repositoryDiffWorkspaceConfiguration = {
  document: {
    layouts: ["unified"],
    defaultLayout: "unified",
    showToolbar: false,
    allowWrap: false,
    showHunkNavigation: false,
    allowContextExpansion: true
  },
  navigation: {
    allowTreeView: true,
    allowRefresh: false
  },
  extensions: {
    openStandaloneDiff: true,
    commitRegion: true,
    pushRegion: true,
    statusbar: false
  }
} as const satisfies DiffWorkspaceConfiguration;
