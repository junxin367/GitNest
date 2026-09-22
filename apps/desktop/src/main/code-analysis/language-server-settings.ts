import type {
  InstallableLanguageServerDto,
  UpdateCodeAnalysisSettingsRequest
} from "@gitnest/contracts";

export function installedLanguageServerSettingsPatch(
  language: InstallableLanguageServerDto,
  command: string,
  args: string[]
): UpdateCodeAnalysisSettingsRequest {
  const settings = {
    enabled: true,
    command,
    args: [...args]
  };
  switch (language) {
    case "typescript":
      return { typescript: settings };
    case "vue":
      return { vue: settings };
    case "java":
      return { java: settings };
    case "python":
      return { python: settings };
    case "go":
      return { go: settings };
    case "kotlin":
      return { kotlin: settings };
    case "csharp":
      return { csharp: settings };
    case "rust":
      return { rust: settings };
  }
}
