import type { ParsedRemoteBoundary } from "../model";
import { faiCliRpcProfile } from "./fai-cli-rpc";
import type {
  JavaMethodProfileContext,
  SourceAnalysisProfile
} from "./types";

const BUILTIN_PROFILES: SourceAnalysisProfile[] = [
  faiCliRpcProfile
];

export const BUILTIN_ANALYSIS_PROFILE_VERSIONS =
  Object.freeze(
    Object.fromEntries(
      BUILTIN_PROFILES.map((profile) => [
        profile.id,
        profile.version
      ])
    )
  );

export function collectJavaMethodProfileBoundaries(
  context: JavaMethodProfileContext
): ParsedRemoteBoundary[] {
  return BUILTIN_PROFILES.flatMap((profile) =>
    profile.collectJavaMethodBoundaries(context)
  );
}
