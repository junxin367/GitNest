import { describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "../../shared/lib/copyTextToClipboard";
import {
  collectDiffViewerSearchHits,
  parseDiffViewModel
} from "../../shared/model/diffViewModel";

describe("shared Diff search model", () => {
  it("finds every case-insensitive match in the unified document", () => {
    const model = parseDiffViewModel(
      [
        "@@ -1,2 +1,2 @@",
        " const needle = 1;",
        "-needle();",
        "+needle(); needle();"
      ].join("\n")
    );

    expect(
      collectDiffViewerSearchHits(model, "unified", "NEEDLE")
    ).toHaveLength(4);
  });

  it("does not search an empty query", () => {
    const model = parseDiffViewModel(
      "@@ -1 +1 @@\n const value = 1;"
    );
    expect(
      collectDiffViewerSearchHits(model, "unified", "  ")
    ).toEqual([]);
  });
});

describe("Diff path clipboard helper", () => {
  it("writes the full path through the browser clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await copyTextToClipboard(
      "src/main/java/com/example/CoreApplicationConfig.java"
    );

    expect(writeText).toHaveBeenCalledWith(
      "src/main/java/com/example/CoreApplicationConfig.java"
    );
  });
});
