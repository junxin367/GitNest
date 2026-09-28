import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = resolve(desktopRoot, "../..");
const releaseBuild = process.env.GITNEST_RELEASE_BUILD === "1";

/**
 * Builds the MCP server as a self-contained single-file bundle.
 *
 * It cannot ride along with the `main` build: that build splits shared
 * package code into `out/main/chunks`, and the spawned MCP process only
 * receives `resources/mcp` from `electron-builder.yml`. A single file
 * also removes any need for a `package.json` next to the script, which
 * the installed `resources` directory does not have; the `.mjs`
 * extension keeps it recognised as an ES module there.
 */
export default defineConfig({
  build: {
    outDir: resolve(desktopRoot, "out/main/mcp"),
    emptyOutDir: false,
    sourcemap: !releaseBuild,
    minify: releaseBuild,
    target: "node22",
    lib: {
      entry: resolve(
        workspaceRoot,
        "packages/mcp-server/src/entry.ts"
      ),
      formats: ["es"],
      fileName: () => "gitnest-mcp.mjs"
    },
    rollupOptions: {
      // Everything except `node:*` is bundled, including the
      // `@gitnest/*` workspace packages.
      external: [/^node:/]
    }
  }
});
