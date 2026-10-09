import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { LanguageServerLanguage } from "./model";

export const LSP_ANALYSIS_POLICY_VERSION = 1;

export interface LspAnalysisPolicy {
  initializationOptions: Record<string, unknown>;
  settings: Record<string, unknown>;
  environment: Record<string, string>;
  unavailableReason?: string;
  limitation?: string;
}

// These settings prevent known automatic build paths. They are not an OS
// sandbox: an arbitrary user-configured executable still has user permissions.
export function createLspAnalysisPolicy(
  language: LanguageServerLanguage,
  dataDirectory: string,
  rootPath: string
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
          autobuild: { enabled: false },
          configuration: { updateBuildConfiguration: "disabled" },
          // Importers can create output directories or run build tools even
          // without autobuild. Keep JDT's document analysis, not project import.
          import: {
            gradle: { enabled: false },
            maven: { enabled: false },
            exclusions: ["**"]
          },
          maven: { updateSnapshots: false },
          saveActions: { organizeImports: false }
        }
      };
      policy.initializationOptions = { settings: policy.settings };
      policy.limitation =
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
          buildScripts: { enable: false, rebuildOnSave: false },
          targetDir: targetDirectory,
          extraArgs: ["--frozen"]
        },
        procMacro: { enable: false }
      };
      policy.settings = { "rust-analyzer": rustSettings };
      policy.limitation =
        "分析已禁用 Cargo 检查、构建脚本和过程宏，生成代码相关语义可能不完整。";
      policy.initializationOptions = rustSettings;
      policy.environment = {
        CARGO_TARGET_DIR: targetDirectory,
        CARGO_NET_OFFLINE: "true"
      };
      break;
    }
    case "go":
      policy.settings = { gopls: { buildFlags: ["-mod=readonly"] } };
      policy.initializationOptions = policy.settings.gopls as Record<string, unknown>;
      break;
    case "kotlin":
    case "csharp":
      policy.unavailableReason =
        `${language === "kotlin" ? "Kotlin" : "C#"} Language Server 的工程导入可能执行构建或依赖还原，` +
        "尚未隔离其项目写入，因此暂停外部语义分析。";
      break;
  }
  return policy;
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
