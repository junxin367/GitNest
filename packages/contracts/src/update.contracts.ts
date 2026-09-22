export const GITNEST_PROJECT_URL =
  "https://github.com/junxin367/GitNest";

export type ApplicationUpdateDistributionDto =
  | "development"
  | "installed"
  | "portable";

export type ApplicationUpdatePhaseDto =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "verifying"
  | "launching"
  | "error";

export interface ApplicationUpdateStateDto {
  currentVersion: string;
  distribution: ApplicationUpdateDistributionDto;
  phase: ApplicationUpdatePhaseDto;
  checkedAt: string | null;
  latestVersion: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  releaseNotes: string | null;
  updateAvailable: boolean;
  promptPending: boolean;
  installSupported: boolean;
  downloadedBytes: number;
  totalBytes: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface AcknowledgeApplicationUpdatePromptRequest {
  version: string;
}
