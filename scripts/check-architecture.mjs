import {
  readFile,
  readdir
} from "node:fs/promises";
import { builtinModules } from "node:module";
import {
  dirname,
  extname,
  join,
  relative,
  resolve
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx"
]);
const TEST_FILE_PATTERN =
  /\.(?:test|spec|integration\.test)\.[cm]?[jt]sx?$/i;
const NODE_MODULE_ROOTS = new Set(
  builtinModules.map((moduleName) =>
    moduleName
      .replace(/^node:/, "")
      .split("/")[0]
  )
);
const IMPORT_PATTERN =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

const PACKAGE_RULES = new Map([
  [
    "application",
    new Set([
      "@gitnest/code-analysis",
      "@gitnest/git-core",
      "@gitnest/workspace-core"
    ])
  ],
  ["code-analysis", new Set()],
  ["contracts", new Set()],
  ["design-system", new Set()],
  ["git-cli", new Set(["@gitnest/git-core"])],
  ["git-core", new Set()],
  [
    "persistence-json",
    new Set([
      "@gitnest/application",
      "@gitnest/workspace-core"
    ])
  ],
  ["testkit", new Set(["@gitnest/workspace-core"])],
  ["workspace-core", new Set()]
]);

export async function collectArchitectureViolations(
  root = projectRoot
) {
  const violations = [];
  await inspectTree(
    join(root, "packages"),
    async (path, source) => {
      const packageName = packageSegment(root, path);
      if (!packageName) {
        return;
      }
      for (const imported of importedModules(source)) {
        if (
          (packageName === "git-core" ||
            packageName === "workspace-core") &&
          (isNodeModule(imported) ||
            imported === "electron" ||
            imported === "react" ||
            imported.startsWith("react/"))
        ) {
          violations.push(
            violation(
              root,
              path,
              source,
              imported,
              `${packageName} must stay free of runtime and UI adapters`
            )
          );
        }
        if (
          [
            "application",
            "code-analysis",
            "git-cli",
            "persistence-json"
          ].includes(packageName) &&
          (imported === "electron" ||
            imported === "react" ||
            imported.startsWith("react/"))
        ) {
          violations.push(
            violation(
              root,
              path,
              source,
              imported,
              `${packageName} must not depend on Electron or React`
            )
          );
        }
        if (imported.startsWith("@gitnest/")) {
          const allowed = PACKAGE_RULES.get(packageName);
          if (!allowed?.has(imported)) {
            violations.push(
              violation(
                root,
                path,
                source,
                imported,
                `${packageName} imports a disallowed workspace package`
              )
            );
          }
        }
      }
    }
  );

  await inspectTree(
    join(
      root,
      "apps",
      "desktop",
      "src",
      "renderer",
      "src"
    ),
    async (path, source) => {
      for (const imported of importedModules(source)) {
        if (
          imported === "electron" ||
          isNodeModule(imported)
        ) {
          violations.push(
            violation(
              root,
              path,
              source,
              imported,
              "renderer must access native capabilities through preload"
            )
          );
        }
        if (
          imported.startsWith("@gitnest/") &&
          imported !== "@gitnest/contracts" &&
          imported !== "@gitnest/design-system" &&
          imported !== "@gitnest/design-system/tokens.css"
        ) {
          violations.push(
            violation(
              root,
              path,
              source,
              imported,
              "renderer may only import contracts and design-system packages"
            )
          );
        }
      }
    }
  );

  await inspectTree(
    join(root, "apps", "desktop", "src", "preload"),
    async (path, source) => {
      for (const imported of importedModules(source)) {
        if (
          imported.startsWith("@gitnest/") &&
          imported !== "@gitnest/contracts"
        ) {
          violations.push(
            violation(
              root,
              path,
              source,
              imported,
              "preload may only import the contracts package"
            )
          );
        }
        if (
          isNodeModule(imported) &&
          imported !== "node:process"
        ) {
          violations.push(
            violation(
              root,
              path,
              source,
              imported,
              "preload must keep its native surface minimal"
            )
          );
        }
      }
    }
  );

  return violations;
}

async function inspectTree(directory, inspect) {
  let entries;
  try {
    entries = await readdir(directory, {
      withFileTypes: true
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspectTree(path, inspect);
      continue;
    }
    if (
      !entry.isFile() ||
      !SOURCE_EXTENSIONS.has(extname(entry.name)) ||
      TEST_FILE_PATTERN.test(entry.name) ||
      entry.name.endsWith(".d.ts")
    ) {
      continue;
    }
    await inspect(path, await readFile(path, "utf8"));
  }
}

function importedModules(source) {
  const modules = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const imported = match[1] ?? match[2] ?? match[3];
    if (imported) {
      modules.push(imported);
    }
  }
  return modules;
}

function packageSegment(root, path) {
  const segments = relative(join(root, "packages"), path).split(
    /[\\/]/
  );
  return segments[0] || undefined;
}

function isNodeModule(imported) {
  const normalized = imported.replace(/^node:/, "");
  const root = normalized.split("/")[0];
  return Boolean(
    root && NODE_MODULE_ROOTS.has(root)
  );
}

function violation(root, path, source, imported, message) {
  const index = source.indexOf(imported);
  const line =
    index < 0
      ? 1
      : source.slice(0, index).split(/\r?\n/).length;
  return {
    file: relative(root, path).replace(/\\/g, "/"),
    line,
    imported,
    message
  };
}

async function main() {
  const violations = await collectArchitectureViolations();
  if (violations.length === 0) {
    console.log("Architecture boundaries passed.");
    return;
  }
  for (const item of violations) {
    console.error(
      `${item.file}:${item.line} ${item.message}: ${item.imported}`
    );
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href ===
    import.meta.url
) {
  await main();
}
