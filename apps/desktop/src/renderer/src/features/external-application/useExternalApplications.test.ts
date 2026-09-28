import { describe, expect, it } from "vitest";

import type {
  ExternalApplicationProfileDto
} from "@gitnest/contracts";

import { selectPreferredExternalApplication } from "./useExternalApplications";

const PROFILES: ExternalApplicationProfileDto[] = [
  {
    kind: "cursor",
    label: "Cursor"
  },
  {
    kind: "file-explorer",
    label: "File Explorer"
  },
  {
    kind: "git-bash",
    label: "Git Bash"
  }
];

describe("selectPreferredExternalApplication", () => {
  it("keeps an available user preference", () => {
    expect(
      selectPreferredExternalApplication(
        PROFILES,
        "file-explorer"
      )
    ).toEqual(PROFILES[1]);
  });

  it("uses the approved application priority for first use and missing preferences", () => {
    expect(
      selectPreferredExternalApplication(PROFILES, undefined)
    ).toEqual(PROFILES[0]);
    expect(
      selectPreferredExternalApplication(PROFILES, "vscode")
    ).toEqual(PROFILES[0]);
  });
});
