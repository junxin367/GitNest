import type {
  CodeAnalysisInput,
  CodeAnalysisSnapshot
} from "@gitnest/code-analysis";

export interface CodeAnalysisRunnerPort {
  analyze(
    input: CodeAnalysisInput
  ): Promise<CodeAnalysisSnapshot>;
  dispose(): Promise<void>;
}
