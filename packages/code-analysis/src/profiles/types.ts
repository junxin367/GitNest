import type {
  CodeAnalysisProfileId,
  ParsedRemoteBoundary
} from "../model";

export interface JavaMethodProfileContext {
  annotations: string;
  hasBody: boolean;
  imports: ReadonlyMap<string, string>;
  line: number;
  packageName: string;
  symbolQualifiedName: string;
}

export interface SourceAnalysisProfile {
  id: CodeAnalysisProfileId;
  version: number;
  collectJavaMethodBoundaries(
    context: JavaMethodProfileContext
  ): ParsedRemoteBoundary[];
}
