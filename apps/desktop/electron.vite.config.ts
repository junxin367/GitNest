import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = resolve(desktopRoot, "../..");
const releaseBuild =
  process.env.GITNEST_RELEASE_BUILD === "1";
const contractsEntry = resolve(
  workspaceRoot,
  "packages/contracts/src/index.ts"
);
const gitCoreEntry = resolve(
  workspaceRoot,
  "packages/git-core/src/index.ts"
);
const gitCliEntry = resolve(
  workspaceRoot,
  "packages/git-cli/src/index.ts"
);
const workspaceCoreEntry = resolve(
  workspaceRoot,
  "packages/workspace-core/src/index.ts"
);
const persistenceJsonEntry = resolve(
  workspaceRoot,
  "packages/persistence-json/src/index.ts"
);
const applicationEntry = resolve(
  workspaceRoot,
  "packages/application/src/index.ts"
);
const designSystemEntry = resolve(
  workspaceRoot,
  "packages/design-system/src/index.ts"
);
const codeAnalysisEntry = resolve(
  workspaceRoot,
  "packages/code-analysis/src/index.ts"
);
const designSystemTokens = resolve(
  workspaceRoot,
  "packages/design-system/src/tokens/tokens.css"
);

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@gitnest/application",
          "@gitnest/code-analysis",
          "@gitnest/contracts",
          "@gitnest/git-cli",
          "@gitnest/git-core",
          "@gitnest/persistence-json",
          "@gitnest/workspace-core"
        ]
      })
    ],
    resolve: {
      alias: [
        {
          find: /^@gitnest\/code-analysis$/,
          replacement: codeAnalysisEntry
        },
        {
          find: /^@gitnest\/application$/,
          replacement: applicationEntry
        },
        {
          find: /^@gitnest\/contracts$/,
          replacement: contractsEntry
        },
        {
          find: /^@gitnest\/git-cli$/,
          replacement: gitCliEntry
        },
        {
          find: /^@gitnest\/git-core$/,
          replacement: gitCoreEntry
        },
        {
          find: /^@gitnest\/persistence-json$/,
          replacement: persistenceJsonEntry
        },
        {
          find: /^@gitnest\/workspace-core$/,
          replacement: workspaceCoreEntry
        }
      ]
    },
    build: {
      sourcemap: !releaseBuild,
      rollupOptions: {
        input: {
          index: resolve(desktopRoot, "src/main/index.ts")
        }
      }
    }
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@gitnest/contracts"]
      })
    ],
    resolve: {
      alias: [
        {
          find: /^@gitnest\/contracts$/,
          replacement: contractsEntry
        }
      ]
    },
    build: {
      externalizeDeps: false,
      sourcemap: !releaseBuild,
      rollupOptions: {
        input: {
          index: resolve(desktopRoot, "src/preload/index.ts")
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js"
        }
      }
    }
  },
  renderer: {
    root: resolve(desktopRoot, "src/renderer"),
    plugins: [react()],
    resolve: {
      alias: [
        {
          find: "@gitnest/design-system/tokens.css",
          replacement: designSystemTokens
        },
        {
          find: /^@gitnest\/design-system$/,
          replacement: designSystemEntry
        },
        {
          find: /^@gitnest\/contracts$/,
          replacement: contractsEntry
        }
      ]
    },
    build: {
      sourcemap: !releaseBuild,
      rollupOptions: {
        input: {
          index: resolve(desktopRoot, "src/renderer/index.html")
        }
      }
    }
  }
});
