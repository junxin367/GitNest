import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { LanguageServerLanguage } from "./model";

export const LSP_ANALYSIS_POLICY_VERSION = 5;

export interface LspAnalysisPolicy {
  initializationOptions: Record<string, unknown>;
  settings: Record<string, unknown>;
  environment: Record<string, string>;
  unavailableReason?: string;
  limitation?: string;
}

// The default disables known build paths. Import/build settings are enabled
// only after the pool has prepared an OS-protected runtime.
export function createLspAnalysisPolicy(
  language: LanguageServerLanguage,
  dataDirectory: string,
  rootPath: string,
  isolated = false,
  projectScope?: {
    workspaceFolders: readonly string[];
    ignoreDirectories: readonly string[];
  }
): LspAnalysisPolicy {
  const policy: LspAnalysisPolicy = {
    initializationOptions: {},
    settings: {},
    environment: {}
  };
  switch (language) {
    case "java":
      policy.settings = {
        java: {
          autobuild: { enabled: isolated },
          configuration: { updateBuildConfiguration: isolated ? "automatic" : "disabled" },
          // Import itself can run tools even when autobuild is disabled.
          import: {
            gradle: {
              enabled: isolated,
              ...(isolated ? {
                arguments: ["--init-script", join(dataDirectory, "gradle-init.gradle"),
                  "--project-cache-dir", join(dataDirectory, "gradle-project-cache")],
                jvmArguments: [`-Dgitnest.analysis.run=${dataDirectory}`]
              } : {})
            },
            maven: { enabled: isolated },
            exclusions: isolated
              ? javaImportExclusions(
                  projectScope?.workspaceFolders.length ? projectScope.workspaceFolders : [rootPath],
                  projectScope?.ignoreDirectories ?? []
                )
              : ["**"]
          },
          maven: { updateSnapshots: false },
          saveActions: { organizeImports: false }
        }
      };
      policy.initializationOptions = { settings: policy.settings };
      if (!isolated) policy.limitation =
        "只读分析已禁用 Maven、Gradle 和 Eclipse 工程导入，外部依赖语义可能不完整。";
      // Applies to both our editor fallback and user-provided JDT LS launchers.
      policy.environment.JAVA_TOOL_OPTIONS = [
        process.env.JAVA_TOOL_OPTIONS,
        "-Djava.import.generatesMetadataFilesAtProjectRoot=false"
      ].filter(Boolean).join(" ");
      break;
    case "typescript":
      policy.initializationOptions = {
        disableAutomaticTypingAcquisition: true
      };
      break;
    case "rust": {
      const targetDirectory = join(
        resolve(dataDirectory), "rust",
        createHash("sha256").update(resolve(rootPath)).digest("hex").slice(0, 24),
        "target"
      );
      const rustSettings = {
        checkOnSave: false,
        cargo: {
          buildScripts: { enable: isolated, rebuildOnSave: false },
          targetDir: targetDirectory,
          extraArgs: isolated ? [] : ["--frozen"]
        },
        procMacro: { enable: isolated }
      };
      policy.settings = { "rust-analyzer": rustSettings };
      if (!isolated) policy.limitation =
        "分析已禁用 Cargo 检查、构建脚本和过程宏，生成代码相关语义可能不完整。";
      policy.initializationOptions = rustSettings;
      policy.environment = {
        CARGO_TARGET_DIR: targetDirectory,
        CARGO_NET_OFFLINE: isolated ? "false" : "true"
      };
      break;
    }
    case "go":
      policy.settings = { gopls: { buildFlags: ["-mod=readonly"] } };
      policy.initializationOptions = policy.settings.gopls as Record<string, unknown>;
      break;
    case "kotlin":
    case "csharp":
      if (!isolated) policy.unavailableReason =
        `${language === "kotlin" ? "Kotlin" : "C#"} Language Server 的工程导入可能执行构建或依赖还原，` +
        "尚未隔离其项目写入，因此暂停外部语义分析。";
      break;
  }
  return policy;
}

function javaImportExclusions(roots: readonly string[], ignoredDirectories: readonly string[]): string[] {
  const ignored = [...new Set(ignoredDirectories.map(value => value.trim().toLocaleLowerCase("en-US")))]
    .filter(value => value && value !== "." && value !== ".." && !/[\\/]/.test(value));
  const folders = [...new Set(roots.map(root => resolve(root)))].sort((left, right) => left.length - right.length);
  const escapeGlob = (value: string) => value.replace(/[\\*?[\]{}]/g, "\\$&");
  const patterns: string[] = [];
  for (const [index, root] of folders.entries()) {
    const prefix = escapeGlob(root.replaceAll("\\", "/").replace(/\/$/, ""));
    const explicitlyIncluded = folders.slice(0, index).some(parent => {
      const path = relative(parent, root);
      return path !== "" && !path.startsWith("..") && !isAbsolute(path) &&
        path.split(/[\\/]/).some(part => ignored.includes(part.toLocaleLowerCase("en-US")));
    });
    if (explicitlyIncluded) patterns.push(`!${prefix}`, `!${prefix}/**`);
    for (const name of ignored) {
      const directory = escapeGlob(name);
      patterns.push(`${prefix}/${directory}`, `${prefix}/${directory}/**`,
        `${prefix}/**/${directory}`, `${prefix}/**/${directory}/**`);
    }
  }
  return patterns;
}

export function lspConfigurationSection(
  settings: Record<string, unknown>,
  section: unknown
): unknown {
  if (section === undefined || section === "") return settings;
  if (typeof section !== "string") return null;
  let value: unknown = settings;
  for (const key of section.split(".")) {
    if (
      !value || typeof value !== "object" ||
      !Object.prototype.hasOwnProperty.call(value, key)
    ) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
