import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/src/app/styles/global.css",
      import.meta.url
    )
  ),
  "utf8"
);

describe("renderer design-system guardrails", () => {
  it("uses shared typography variables instead of page-local pixel sizes", () => {
    expect(css).not.toMatch(/font-size:\s*\d+(?:\.\d+)?px/);
  });

  it("keeps focus, reduced-motion, and semantic layer rules intact", () => {
    expect(css).toContain("summary:focus-visible");
    expect(css).not.toMatch(/outline:\s*(?:0|none)\b/);
    expect(css).not.toMatch(/z-index:\s*\d+/);
    expect(css).toContain(
      "@media (prefers-reduced-motion: reduce)"
    );
  });

  it("keeps compact interactive controls at the shared 32px target", () => {
    expect(css).toMatch(
      /\.mini-action\s*\{[\s\S]*?min-height:\s*var\(--control-compact\)/
    );
    expect(css).toMatch(
      /\.operation-filter-tabs button\s*\{[\s\S]*?height:\s*var\(--control-compact\)/
    );
    expect(css).toMatch(
      /\.diff-mode-actions button\s*\{[\s\S]*?height:\s*var\(--control-compact\)/
    );
  });
});
