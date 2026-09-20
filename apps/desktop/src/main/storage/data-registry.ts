import { isAbsolute, join, relative, resolve } from "node:path";

export type DataCategory =
  | "durable"
  | "cache"
  | "runtime"
  | "log";

export type DataRetention =
  | {
      policy: "permanent";
    }
  | {
      policy: "bounded";
      maxAgeDays: number;
      maxBytes: number;
    }
  | {
      policy: "ephemeral";
    };

export interface DataSetDescriptor {
  id: string;
  owner: string;
  category: DataCategory;
  path: string;
  rebuildable: boolean;
  sensitive: boolean;
  retention: DataRetention;
}

export interface GitNestDataPaths {
  diagnosticLog: string;
  windowState: string;
  appSettings: string;
  workspaceCatalog: string;
  workspaceDocuments: string;
  defaultWorkspace: string;
  repositorySnapshots: string;
  defaultRepositorySnapshots: string;
  workspaceOperations: string;
  defaultWorkspaceOperations: string;
  codeAnalysisIndex: string;
  codeAnalysisSnapshots: string;
  lspRuntime: string;
  languageServers: string;
  accountMetadata: string;
  credentialVault: string;
  askpassRuntime: string;
}

export interface GitNestDataRegistry {
  root: string;
  paths: GitNestDataPaths;
  descriptors: readonly DataSetDescriptor[];
}

const MIB = 1_024 * 1_024;
const GIB = 1_024 * MIB;

export function createDataRegistry(
  userDataPath: string
): GitNestDataRegistry {
  if (!isAbsolute(userDataPath)) {
    throw new Error("The user data path must be absolute.");
  }
  const root = resolve(userDataPath);
  const paths: GitNestDataPaths = {
    diagnosticLog: join(root, "logs", "gitnest.log"),
    windowState: join(
      root,
      "settings",
      "window-state.json"
    ),
    appSettings: join(
      root,
      "settings",
      "app-settings.json"
    ),
    workspaceCatalog: join(
      root,
      "workspaces",
      "catalog.json"
    ),
    workspaceDocuments: join(
      root,
      "workspaces",
      "items"
    ),
    defaultWorkspace: join(
      root,
      "workspaces",
      "default.workspace.json"
    ),
    repositorySnapshots: join(
      root,
      "cache",
      "repository-snapshots",
      "items"
    ),
    defaultRepositorySnapshots: join(
      root,
      "cache",
      "repository-snapshots",
      "default.snapshots.json"
    ),
    workspaceOperations: join(
      root,
      "operations",
      "items"
    ),
    defaultWorkspaceOperations: join(
      root,
      "operations",
      "default.operations.json"
    ),
    codeAnalysisIndex: join(
      root,
      "cache",
      "code-analysis"
    ),
    codeAnalysisSnapshots: join(
      root,
      "gitnest-state",
      "code-analysis"
    ),
    lspRuntime: join(root, "runtime", "lsp"),
    languageServers: join(
      root,
      "runtime",
      "lsp",
      "servers"
    ),
    accountMetadata: join(
      root,
      "accounts",
      "metadata.json"
    ),
    credentialVault: join(
      root,
      "accounts",
      "credentials"
    ),
    askpassRuntime: join(root, "runtime", "askpass")
  };
  const permanent = (): DataRetention => ({
    policy: "permanent"
  });
  const ephemeral = (): DataRetention => ({
    policy: "ephemeral"
  });
  const bounded = (
    maxAgeDays: number,
    maxBytes: number
  ): DataRetention => ({
    policy: "bounded",
    maxAgeDays,
    maxBytes
  });
  const descriptors: DataSetDescriptor[] = [
    {
      id: "diagnostic-log",
      owner: "diagnostics",
      category: "log",
      path: paths.diagnosticLog,
      rebuildable: true,
      sensitive: true,
      retention: bounded(14, 3 * MIB)
    },
    {
      id: "window-state",
      owner: "desktop-window",
      category: "durable",
      path: paths.windowState,
      rebuildable: true,
      sensitive: false,
      retention: permanent()
    },
    {
      id: "app-settings",
      owner: "application-settings",
      category: "durable",
      path: paths.appSettings,
      rebuildable: false,
      sensitive: true,
      retention: permanent()
    },
    {
      id: "workspace-catalog",
      owner: "workspace",
      category: "durable",
      path: paths.workspaceCatalog,
      rebuildable: false,
      sensitive: true,
      retention: permanent()
    },
    {
      id: "workspace-documents",
      owner: "workspace",
      category: "durable",
      path: paths.workspaceDocuments,
      rebuildable: false,
      sensitive: true,
      retention: permanent()
    },
    {
      id: "legacy-default-workspace",
      owner: "workspace-migration",
      category: "durable",
      path: paths.defaultWorkspace,
      rebuildable: false,
      sensitive: true,
      retention: permanent()
    },
    {
      id: "repository-snapshots",
      owner: "workspace-runtime",
      category: "cache",
      path: paths.repositorySnapshots,
      rebuildable: true,
      sensitive: true,
      retention: bounded(30, 128 * MIB)
    },
    {
      id: "legacy-repository-snapshots",
      owner: "workspace-migration",
      category: "cache",
      path: paths.defaultRepositorySnapshots,
      rebuildable: true,
      sensitive: true,
      retention: bounded(30, 128 * MIB)
    },
    {
      id: "workspace-operations",
      owner: "workspace-runtime",
      category: "durable",
      path: paths.workspaceOperations,
      rebuildable: false,
      sensitive: true,
      retention: permanent()
    },
    {
      id: "legacy-workspace-operations",
      owner: "workspace-migration",
      category: "durable",
      path: paths.defaultWorkspaceOperations,
      rebuildable: false,
      sensitive: true,
      retention: permanent()
    },
    {
      id: "code-analysis-index",
      owner: "code-analysis",
      category: "cache",
      path: paths.codeAnalysisIndex,
      rebuildable: true,
      sensitive: true,
      retention: bounded(30, 512 * MIB)
    },
    {
      id: "code-analysis-snapshots",
      owner: "code-analysis",
      category: "cache",
      path: paths.codeAnalysisSnapshots,
      rebuildable: true,
      sensitive: true,
      retention: bounded(30, GIB)
    },
    {
      id: "lsp-runtime",
      owner: "code-analysis",
      category: "runtime",
      path: paths.lspRuntime,
      rebuildable: true,
      sensitive: true,
      retention: ephemeral()
    },
    {
      id: "language-servers",
      owner: "language-server-installer",
      category: "cache",
      path: paths.languageServers,
      rebuildable: true,
      sensitive: false,
      retention: bounded(90, 2 * GIB)
    },
    {
      id: "account-metadata",
      owner: "accounts",
      category: "durable",
      path: paths.accountMetadata,
      rebuildable: false,
      sensitive: true,
      retention: permanent()
    },
    {
      id: "credential-vault",
      owner: "credentials",
      category: "durable",
      path: paths.credentialVault,
      rebuildable: false,
      sensitive: true,
      retention: permanent()
    },
    {
      id: "askpass-runtime",
      owner: "git-authentication",
      category: "runtime",
      path: paths.askpassRuntime,
      rebuildable: true,
      sensitive: true,
      retention: ephemeral()
    }
  ];

  for (const descriptor of descriptors) {
    assertInsideRoot(root, descriptor.path);
  }

  return {
    root,
    paths,
    descriptors
  };
}

function assertInsideRoot(root: string, path: string): void {
  const relativePath = relative(root, resolve(path));
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..\\`) ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      `Data registry path escapes the user data root: ${path}`
    );
  }
}
