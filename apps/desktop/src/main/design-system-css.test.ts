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
const sharedButtonCss = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/src/shared/ui/primitives.css",
      import.meta.url
    )
  ),
  "utf8"
);
const prototypeButtonCss = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../prototypes/workspace-shell/button.css",
      import.meta.url
    )
  ),
  "utf8"
);
const diffWorkspaceCss = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/src/widgets/diff-workspace/diff-workspace.css",
      import.meta.url
    )
  ),
  "utf8"
);
const prototypeShellHtml = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../prototypes/workspace-shell/index.html",
      import.meta.url
    )
  ),
  "utf8"
);
const prototypeDiffWorkspaceCss = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../prototypes/workspace-shell/diff-workspace.css",
      import.meta.url
    )
  ),
  "utf8"
);
const loadingUiSources = [
  "../renderer/src/pages/diff-viewer/DiffViewerApp.tsx",
  "../renderer/src/pages/operations/OperationCenterPage.tsx",
  "../renderer/src/pages/repository/RepositoryPage.tsx",
  "../renderer/src/pages/settings/ApplicationSettingsPage.tsx",
  "../renderer/src/pages/settings/SettingsPage.tsx",
  "../renderer/src/pages/workspace-overview/WorkspaceCollectionPage.tsx",
  "../renderer/src/pages/workspace-overview/WorkspaceOverviewPage.tsx",
  "../renderer/src/widgets/diff-workspace/DiffPanel.tsx",
  "../renderer/src/widgets/diff-workspace/DiffWorkspace.tsx",
  "../renderer/src/widgets/repository-header/BranchSwitchDialog.tsx",
  "../renderer/src/widgets/workspace-sidebar/WorkspaceSidebar.tsx"
]
  .map((path) =>
    readFileSync(
      fileURLToPath(new URL(path, import.meta.url)),
      "utf8"
    )
  )
  .join("\n");

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
      /\.diff-open-viewer-button\s*\{[\s\S]*?height:\s*var\(--control-compact\)/
    );
  });

  it("keeps the portaled Open in menu on an opaque surface", () => {
    expect(css).toMatch(
      /\.open-in-menu\s*\{[\s\S]*?background:\s*var\(--surface\);/
    );
  });

  it("lightens shared button backgrounds by 12% without changing hover text or borders", () => {
    for (const buttonCss of [
      sharedButtonCss,
      prototypeButtonCss
    ]) {
      expect(buttonCss).toContain(
        "--gn-button-background: var(--surface-2);"
      );
      expect(buttonCss).toContain(
        "--gn-button-background: transparent;"
      );
      expect(buttonCss).toContain(
        "--gn-button-background: var(--gn-button-primary-color);"
      );
      expect(buttonCss).toContain(
        "--gn-button-background: var(--red-soft);"
      );
      expect(buttonCss).toContain(
        "--gn-button-background: var(--red);"
      );
      expect(buttonCss).toContain(
        "--gn-button-background: var(--accent-soft);"
      );

      const hoverRule =
        buttonCss.match(
          /\.gn-button:hover:not\(:disabled\)\s*\{([^}]*)\}/
        )?.[1] ?? "";
      expect(hoverRule).toContain(
        "var(--gn-button-background) 88%"
      );
      expect(hoverRule).toContain("white");
      expect(hoverRule).not.toMatch(/(?:^|\n)\s*color:/);
      expect(hoverRule).not.toContain("border-color:");
    }
  });

  it("keeps primary button text white in every theme", () => {
    for (const buttonCss of [
      sharedButtonCss,
      prototypeButtonCss
    ]) {
      expect(buttonCss).toContain(
        "--gn-button-primary-foreground: #fff;"
      );
      expect(buttonCss).not.toMatch(
        /--gn-button-primary-foreground:\s*(?:var\(--on-accent\)|#071411)/
      );
    }
  });

  it("keeps repository history actions on one responsive row", () => {
    expect(css).toContain("@container (max-width: 960px)");
    expect(css).toMatch(
      /\.history-list\s*>\s*\.panel-header\s*\{[^}]*flex:\s*0 0 auto;/
    );
    expect(css).toMatch(
      /\.history-header-actions\s*\{[^}]*justify-content:\s*flex-end;/
    );
    expect(css).toMatch(
      /\.repository-page-history\s+\.history-header-actions\s*\{[^}]*flex-basis:\s*100%;[^}]*flex-wrap:\s*nowrap;[^}]*width:\s*100%;[^}]*justify-content:\s*flex-start;/
    );
    expect(css).toMatch(
      /@container \(max-width: 960px\)\s*\{[\s\S]*?\.repository-page-history\s+\.history-filter-controls\s*\{[^}]*margin-left:\s*0;/
    );
    expect(css).not.toMatch(
      /\.repository-page-history\s+\.history-(?:scope|filter)-controls\s*\{[^}]*flex:\s*1 0 100%;/
    );
    expect(css).toMatch(
      /\.history-comparison-summary\s*\{[\s\S]*?flex-wrap:\s*wrap;/
    );
    expect(css).toMatch(
      /\.history-ref-trigger\s+\.gn-button__label\s*>\s*span\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/
    );
    expect(css).not.toMatch(
      /\.history-ref-trigger\s*>\s*span\s*\{/
    );
    expect(css).toMatch(
      /\.history-ref-menu\s*\{[^}]*overflow-x:\s*hidden;/
    );
    expect(css).toMatch(
      /\.menu-item\.is-selected\s*\{[^}]*background:\s*var\(--accent-soft\);/
    );
  });

  it("keeps every loading skeleton on the shared motion-reduced primitive", () => {
    expect(sharedButtonCss).toContain(
      "@keyframes gn-skeleton-shimmer"
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-skeleton::after\s*\{[\s\S]*?animation:\s*gn-skeleton-shimmer 1\.35s/
    );
    expect(sharedButtonCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.gn-skeleton::after\s*\{[\s\S]*?animation:\s*none;/
    );
    expect(diffWorkspaceCss).not.toContain(
      "diff-workspace-skeleton-shimmer"
    );
    expect(loadingUiSources).not.toContain("repository-loading");
    expect(loadingUiSources).not.toContain(
      "empty-state-icon spinning"
    );
  });

  it("keeps file and repository rows visually stable while pressed", () => {
    expect(diffWorkspaceCss).toMatch(
      /\.diff-workspace-file-select:not\(:disabled\):active\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*none;/
    );
    expect(css).toMatch(
      /\.repository-row:not\(:disabled\):active\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*none;/
    );
    expect(prototypeShellHtml).toMatch(
      /\.file-select-button:active,\s*\.repo-row:active\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*none;/
    );
  });

  it("shows file and repository row hover states without animation", () => {
    expect(diffWorkspaceCss).toMatch(
      /\.diff-workspace-file-actions\s*\{[^}]*visibility:\s*hidden;[^}]*transition:\s*none;/
    );
    expect(diffWorkspaceCss).toMatch(
      /\.diff-workspace-file:hover \.diff-workspace-file-actions,\s*\.diff-workspace-file:focus-within \.diff-workspace-file-actions\s*\{[^}]*visibility:\s*visible;/
    );
    expect(diffWorkspaceCss).toMatch(
      /\.diff-workspace-file-actions \.gn-button\s*\{[^}]*transition:\s*none;/
    );
    expect(css).toMatch(
      /\.repository-row\s*\{[^}]*transition:\s*none;/
    );
    expect(css).not.toContain(
      ".repository-row:hover .repository-row-name"
    );
    expect(css).toMatch(
      /\.repository-row\.selected \.repository-row-name\s*\{[^}]*color:\s*var\(--text\);/
    );
    expect(prototypeDiffWorkspaceCss).toMatch(
      /\.gn-diff-workspace__file-actions\s*\{[^}]*visibility:\s*hidden;[^}]*transition:\s*none;/
    );
    expect(prototypeDiffWorkspaceCss).toMatch(
      /\.gn-diff-workspace__file-actions \.gn-button\s*\{[^}]*transition:\s*none;/
    );
    expect(prototypeShellHtml).toMatch(
      /\.file-actions\s*\{[^}]*visibility:\s*hidden;[^}]*transition:\s*none;/
    );
    expect(prototypeShellHtml).toMatch(
      /\.file-actions \.gn-button\s*\{[^}]*transition:\s*none;/
    );
    expect(prototypeShellHtml).not.toContain(
      ".repo-row:hover .repo-name"
    );

    const prototypeSharedTransitionSelectors =
      prototypeShellHtml.match(
        /(\.button,\s*[\s\S]*?)\{\s*transition:\s*\n\s*color var\(--motion-micro\) ease,[\s\S]*?transform var\(--motion-micro\) ease;\s*\}/
      )?.[1] ?? "";
    expect(prototypeSharedTransitionSelectors).not.toContain(
      ".repo-row"
    );
  });
});
