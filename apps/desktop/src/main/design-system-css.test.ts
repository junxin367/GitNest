import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function readCssBundle(
  sourceUrl: URL,
  visited = new Set<string>()
): string {
  const sourcePath = fileURLToPath(sourceUrl);
  if (visited.has(sourcePath)) {
    return "";
  }
  visited.add(sourcePath);

  const source = readFileSync(sourcePath, "utf8");
  return source.replace(
    /@import\s+["']([^"']+)["'];/g,
    (_, importPath: string) =>
      readCssBundle(new URL(importPath, sourceUrl), visited)
  );
}

const css = readCssBundle(
  new URL(
    "../renderer/src/app/styles/global.css",
    import.meta.url
  )
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
const sharedSelectSource = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/src/shared/ui/Select.tsx",
      import.meta.url
    )
  ),
  "utf8"
);
const sharedDialogSource = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/src/shared/ui/Dialog.tsx",
      import.meta.url
    )
  ),
  "utf8"
);
const globalSearchDialogSource = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/src/features/global-search/GlobalSearchDialog.tsx",
      import.meta.url
    )
  ),
  "utf8"
);
const standardDialogSources = [
  "../renderer/src/widgets/workspace-sidebar/WorkspaceDialogs.tsx",
  "../renderer/src/widgets/repository-header/BranchSwitchDialog.tsx",
  "../renderer/src/widgets/diff-workspace/DiffDiscardConfirmationDialog.tsx",
  "../renderer/src/features/application-update/VersionDialog.tsx",
  "../renderer/src/features/repository-command/RepositoryCommandDialog.tsx",
  "../renderer/src/features/worktree-command/WorktreeCommandDialog.tsx",
  "../renderer/src/pages/repository/RepositoryStashActions.tsx",
  "../renderer/src/pages/settings/SettingsPage.tsx",
  "../renderer/src/pages/settings/ApplicationSettingsPage.tsx"
].map((path) =>
  readFileSync(
    fileURLToPath(new URL(path, import.meta.url)),
    "utf8"
  )
);
const designTokensCss = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../packages/design-system/src/tokens/tokens.css",
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
const prototypeInputCss = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../prototypes/workspace-shell/input.css",
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
const codeRelationGraphSource = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/src/pages/code-analysis/CodeRelationGraph.tsx",
      import.meta.url
    )
  ),
  "utf8"
);
const codeAnalysisPageSource = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/src/pages/code-analysis/CodeAnalysisPage.tsx",
      import.meta.url
    )
  ),
  "utf8"
);
const applicationSettingsPageSource = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/src/pages/settings/ApplicationSettingsPage.tsx",
      import.meta.url
    )
  ),
  "utf8"
);
const repositoryHistorySource = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/src/pages/repository/RepositoryHistory.tsx",
      import.meta.url
    )
  ),
  "utf8"
);
const repositoryCommitDetailSource = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/src/pages/repository/RepositoryCommitDetail.tsx",
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
const prototypeMenuGalleryHtml = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../prototypes/workspace-shell/menu-gallery.html",
      import.meta.url
    )
  ),
  "utf8"
);
const prototypeDiffViewerHtml = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../prototypes/workspace-shell/diff-viewer.html",
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
const prototypeDiffPanelSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../prototypes/workspace-shell/diff-panel.js",
      import.meta.url
    )
  ),
  "utf8"
);
const loadingUiSources = [
  "../renderer/src/pages/code-analysis/CodeAnalysisPage.tsx",
  "../renderer/src/pages/diff-viewer/DiffViewerApp.tsx",
  "../renderer/src/pages/operations/OperationCenterPage.tsx",
  "../renderer/src/pages/repository/RepositoryBranches.tsx",
  "../renderer/src/pages/repository/RepositoryChanges.tsx",
  "../renderer/src/pages/repository/RepositoryCommitDetail.tsx",
  "../renderer/src/pages/repository/RepositoryHistory.tsx",
  "../renderer/src/pages/repository/RepositoryOverview.tsx",
  "../renderer/src/pages/repository/RepositoryPage.tsx",
  "../renderer/src/pages/repository/RepositoryWorktrees.tsx",
  "../renderer/src/pages/settings/ApplicationSettingsPage.tsx",
  "../renderer/src/pages/settings/SettingsPage.tsx",
  "../renderer/src/pages/workspace-overview/WorkspaceCollectionPage.tsx",
  "../renderer/src/pages/workspace-overview/WorkspaceOverviewPage.tsx",
  "../renderer/src/widgets/diff-workspace/DiffPanel.tsx",
  "../renderer/src/widgets/diff-workspace/DiffPanelContent.tsx",
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

  it("keeps popover menus scrollable inside the viewport", () => {
    expect(css).toMatch(
      /:where\(\.menu-surface\)\s*\{[\s\S]*?max-height:\s*calc\(100vh - var\(--space-4\)\);[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/
    );
    for (const source of [
      prototypeShellHtml,
      prototypeDiffViewerHtml
    ]) {
      expect(source).toMatch(
        /\.menu-surface\s*\{[\s\S]*?max-height:\s*calc\(100vh - var\(--space-4\)\);[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/
      );
    }
  });

  it("keeps standard page margins at 12px while edge-to-edge pages opt out", () => {
    for (const source of [
      designTokensCss,
      prototypeShellHtml
    ]) {
      expect(source).toContain("--page-safe-margin: 12px");
      expect(source).toContain(
        "--page-safe-margin-narrow: 12px"
      );
    }
    expect(css).toMatch(
      /\.page-scroll\s*\{[\s\S]*?padding:\s*var\(--page-safe-margin\);/
    );
    expect(css).toMatch(
      /\.page-scroll\.repository-page-changes\s*\{[\s\S]*?padding:\s*0;/
    );
    expect(css).toMatch(
      /\.page-scroll\.repository-page-history\s*\{[\s\S]*?padding:\s*0;/
    );
    expect(css).toMatch(
      /\.page-scroll\.repository-page-branches\s*\{[\s\S]*?padding:\s*0;/
    );
  });

  it("keeps operation metrics in one four-card row and operation records card-based", () => {
    const metricGridRules =
      css.match(/\.operation-metric-grid\s*\{[^}]*\}/g) ?? [];

    expect(metricGridRules).toHaveLength(1);
    expect(metricGridRules[0]).toMatch(
      /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/
    );
    expect(css).toMatch(
      /\.operation-center-page \.gn-skeleton-metric-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/
    );
    expect(css).toMatch(
      /\.operation-history-list\s*\{[^}]*gap:\s*var\(--space-2\);[^}]*padding:\s*var\(--space-4\);/
    );
    expect(css).toMatch(
      /\.operation-history-card\s*\{[^}]*background:\s*var\(--surface-2\);[^}]*border:\s*1px solid var\(--border-soft\);[^}]*border-radius:\s*var\(--radius-regular\);/
    );
    expect(css).toMatch(
      /\.operation-history-primary-target\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*appearance:\s*none;/
    );
  });

  it("caps switches at 24px and keeps single-line menus compact", () => {
    for (const source of [css, prototypeShellHtml]) {
      expect(source).toMatch(
        /\.settings-switch\s*\{[\s\S]*?width:\s*42px;[\s\S]*?height:\s*24px;[\s\S]*?max-height:\s*24px;/
      );
      expect(source).toMatch(
        /\.settings-switch-thumb\s*\{[\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px;/
      );
      expect(source).toMatch(
        /\.menu-item\s*\{[\s\S]*?min-height:\s*var\(--control-compact\);/
      );
    }
    expect(prototypeMenuGalleryHtml).toMatch(
      /\.toggle-demo\s*\{[\s\S]*?width:\s*42px;[\s\S]*?height:\s*24px;[\s\S]*?max-height:\s*24px;/
    );
    expect(prototypeMenuGalleryHtml).toContain(
      "<strong>42 × 24px</strong>"
    );
    expect(prototypeMenuGalleryHtml).not.toMatch(
      /min-height:\s*34px/
    );
    expect(prototypeDiffViewerHtml).toMatch(
      /\.menu-item\s*\{[\s\S]*?min-height:\s*var\(--control-compact\);/
    );
    expect(prototypeDiffWorkspaceCss).toMatch(
      /\.gn-diff-workspace__stash-context-menu\s*>\s*button\s*\{[\s\S]*?min-height:\s*var\(--control-compact\);/
    );
  });

  it("keeps button, input, and dropdown size tiers at 32, 35, and 40px", () => {
    for (const source of [
      designTokensCss,
      prototypeShellHtml,
      prototypeMenuGalleryHtml
    ]) {
      expect(source).toContain("--control-compact: 32px");
      expect(source).toContain("--control-default: 35px");
      expect(source).toContain("--control-large: 40px");
    }
    expect(sharedButtonCss).toMatch(
      /\.gn-button\s*\{[\s\S]*?--gn-button-height:\s*var\(--control-compact\);/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-button\[data-size="medium"\]\s*\{[\s\S]*?--gn-button-height:\s*var\(--control-default\);/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-button\[data-size="large"\]\s*\{[\s\S]*?--gn-button-height:\s*var\(--control-large\);/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-input\s*\{[\s\S]*?--gn-input-height:\s*var\(--control-default\);/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-input\[data-size="small"\]\s*\{[\s\S]*?--gn-input-height:\s*var\(--control-compact\);/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-input\[data-size="large"\]\s*\{[\s\S]*?--gn-input-height:\s*var\(--control-large\);/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-select__trigger\.gn-button\s*\{[\s\S]*?justify-content:\s*space-between;/
    );
    expect(sharedSelectSource).toContain(
      'size = "medium"'
    );
    expect(sharedSelectSource).toContain(
      "size={size}"
    );
    for (const source of [
      prototypeButtonCss,
      prototypeInputCss
    ]) {
      expect(source).toContain(
        "size-small: var(--control-compact)"
      );
      expect(source).toContain(
        "size-medium: var(--control-default)"
      );
      expect(source).toContain(
        "size-large: var(--control-large)"
      );
    }
    expect(prototypeMenuGalleryHtml).toMatch(
      /--dropdown-size-small:\s*var\(--control-compact\);[\s\S]*?--dropdown-size-medium:\s*var\(--control-default\);[\s\S]*?--dropdown-size-large:\s*var\(--control-large\);/
    );
    expect(prototypeMenuGalleryHtml).toContain(
      "默认选择器支持 32 / 35 / 40px 三档尺寸"
    );
    expect(prototypeMenuGalleryHtml).not.toContain(
      "Medium · 40px"
    );
    expect(prototypeMenuGalleryHtml).not.toContain(
      "Large · 48px"
    );
  });

  it("keeps standard dialogs on the shared component while search stays specialized", () => {
    expect(sharedButtonCss).toMatch(
      /\.gn-dialog\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[\s\S]*?max-height:\s*min\(680px,\s*calc\(100vh - 48px\)\);/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-dialog\[data-size="compact"\]\s*\{[^}]*width:\s*min\(520px,/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-dialog\[data-size="target"\]\s*\{[^}]*width:\s*min\(560px,/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-dialog\[data-size="information"\]\s*\{[^}]*width:\s*min\(620px,/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-dialog__header\s*\{[\s\S]*?min-height:\s*56px;[\s\S]*?padding:\s*var\(--space-3\)\s+var\(--space-5\);/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-dialog__icon\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-dialog__footer\s*\{[\s\S]*?min-height:\s*56px;[\s\S]*?justify-content:\s*flex-end;/
    );
    expect(sharedButtonCss).toMatch(
      /\.gn-dialog__close\.gn-button:hover:not\(:disabled\),[\s\S]*?background:\s*transparent;[\s\S]*?border-color:\s*transparent;/
    );
    expect(sharedDialogSource).toContain(
      'className="gn-dialog__header"'
    );
    expect(sharedDialogSource).not.toContain(
      "headerDescription"
    );
    expect(sharedDialogSource).not.toContain("footerNote");

    for (const source of standardDialogSources) {
      expect(source).toContain('shared/ui/Dialog"');
      expect(source).not.toContain(
        'className="command-dialog-backdrop"'
      );
      expect(source).not.toContain(
        'className="command-dialog-header"'
      );
      expect(source).not.toContain(
        'className="command-dialog-footer"'
      );
    }

    expect(globalSearchDialogSource).not.toContain(
      'shared/ui/Dialog"'
    );
    expect(globalSearchDialogSource).toContain(
      'className="global-search-backdrop"'
    );
    expect(globalSearchDialogSource).toContain(
      'className="global-search-dialog"'
    );
  });

  it("lets settings pages and their skeletons fill the available content width", () => {
    const applicationSettingsRule =
      css.match(/\.application-settings-page\s*\{([^}]*)\}/)?.[1] ??
      "";
    const prototypeSettingsRule =
      prototypeShellHtml.match(/\.settings-page\s*\{([^}]*)\}/)?.[1] ??
      "";

    for (const rule of [
      applicationSettingsRule,
      prototypeSettingsRule
    ]) {
      expect(rule).toContain("width: 100%");
      expect(rule).toContain("min-width: 0");
      expect(rule).not.toContain("max-width");
      expect(rule).not.toContain("margin-left: auto");
      expect(rule).not.toContain("margin-right: auto");
    }
  });

  it("reserves one truncated help line below analysis budget inputs", () => {
    expect(
      applicationSettingsPageSource.match(
        /reserveHelpSpace/g
      )
    ).toHaveLength(17);
    expect(
      prototypeShellHtml.match(
        /reserveHelpSpace:\s*true/g
      )
    ).toHaveLength(10);

    for (const source of [
      sharedButtonCss,
      prototypeInputCss
    ]) {
      const helpRule = [
        ...source.matchAll(
          /\.gn-input-field__help\s*\{([^}]*)\}/g
        )
      ]
        .map((match) => match[1] ?? "")
        .find((rule) => rule.includes("height: 1lh"));

      expect(helpRule).toContain("overflow: hidden");
      expect(helpRule).toContain("text-overflow: ellipsis");
      expect(helpRule).toContain("white-space: nowrap");
    }
  });

  it("keeps the prototype analysis budgets aligned with the application", () => {
    for (const fieldId of [
      "analysis-max-files",
      "analysis-max-file-size",
      "analysis-max-total-source",
      "analysis-max-graph-nodes",
      "analysis-max-graph-edges",
      "analysis-max-request-chains",
      "analysis-max-diagnostics",
      "analysis-concurrency",
      "analysis-graph-depth",
      "analysis-lsp-timeout"
    ]) {
      expect(prototypeShellHtml).toContain(
        `id: "${fieldId}"`
      );
    }
    expect(prototypeShellHtml).toContain(
      "analysisMaxGraphEdges: 100000"
    );
    expect(prototypeShellHtml).toContain(
      "analysisConcurrency: 4"
    );
    expect(prototypeShellHtml).toContain(
      "analysisGraphDepth: 8"
    );
    expect(prototypeShellHtml).toContain(
      'min="5000" max="200000"'
    );
    expect(
      prototypeShellHtml.indexOf(
        '<div class="settings-card-title">性能预算</div>'
      )
    ).toBeLessThan(
      prototypeShellHtml.indexOf(
        "${renderAnalysisLanguageServerSettings()}"
      )
    );

    for (const source of [css, prototypeShellHtml]) {
      expect(source).toContain(
        "container: settings-content / inline-size"
      );
      expect(source).toMatch(
        /@container settings-content \(min-width: 700px\)[\s\S]*?\.analysis-settings-number-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/
      );
      expect(source).toMatch(
        /\.analysis-settings-number-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/
      );
    }
  });

  it("auto-fits compact settings preference groups to the available width", () => {
    for (const source of [css, prototypeShellHtml]) {
      const preferenceGridRules = [
        ...source.matchAll(
          /\.settings-preference-groups\s*\{([^}]*)\}/g
        )
      ].map((match) => match[1] ?? "");

      expect(preferenceGridRules).toHaveLength(1);
      expect(preferenceGridRules[0]).toContain(
        "repeat(auto-fit, minmax(min(220px, 100%), 1fr))"
      );
    }
  });

  it("uses clearable shared inputs for Worktree text filters", () => {
    expect(loadingUiSources).toContain(
      'clearLabel="清除 Worktree 筛选"'
    );
    expect(loadingUiSources).toContain(
      'clearLabel="清除跨仓 Worktree 筛选"'
    );
    expect(prototypeShellHtml).toContain(
      'ariaLabel: "清除 Worktree 筛选"'
    );
    expect(prototypeShellHtml).toContain(
      'ariaLabel: "清除跨仓 Worktree 筛选"'
    );
  });

  it("uses shared dropdown components for the default terminal selector", () => {
    const settingsCardStart =
      applicationSettingsPageSource.indexOf(
        'title="默认终端"'
      );
    const settingsCardSource =
      applicationSettingsPageSource.slice(
        settingsCardStart,
        settingsCardStart + 1_800
      );
    const prototypeCardStart =
      prototypeShellHtml.indexOf(
        '<div class="settings-card-title">默认终端</div>'
      );
    const prototypeCardSource = prototypeShellHtml.slice(
      prototypeCardStart,
      prototypeCardStart + 2_500
    );

    expect(settingsCardStart).toBeGreaterThan(-1);
    expect(settingsCardSource).toContain(
      "<Select"
    );
    expect(applicationSettingsPageSource).toContain(
      'from "../../shared/ui/Select"'
    );
    expect(applicationSettingsPageSource).not.toContain(
      "function TerminalProfileDropdown"
    );
    expect(settingsCardSource).not.toContain("<select");

    expect(prototypeCardStart).toBeGreaterThan(-1);
    expect(prototypeCardSource).toContain(
      'id="settingsTerminalTrigger"'
    );
    expect(prototypeCardSource).toContain(
      'id="settingsTerminalMenu"'
    );
    expect(prototypeCardSource).not.toContain("<details");
    expect(prototypeCardSource).not.toContain("<select");
    expect(prototypeShellHtml).toContain(
      'dropdownManager.register({\n        id: "settings-terminal"'
    );
  });

  it("keeps the AI API Key opt-in visible and clears it after saving", () => {
    const saveAiSettingsStart =
      applicationSettingsPageSource.indexOf(
        "const saveAiSettings = async () =>"
      );
    const saveAiSettingsSource =
      applicationSettingsPageSource.slice(
        saveAiSettingsStart,
        applicationSettingsPageSource.indexOf(
          "const testAiConnection",
          saveAiSettingsStart
        )
      );
    const prototypeApiKeyStart = prototypeShellHtml.indexOf(
      'id: "aiCommitApiKey"'
    );
    const prototypeApiKeySource = prototypeShellHtml.slice(
      prototypeApiKeyStart,
      prototypeApiKeyStart + 1_200
    );

    expect(saveAiSettingsStart).toBeGreaterThan(-1);
    expect(saveAiSettingsSource).toContain('setAiKey("")');
    expect(saveAiSettingsSource).toContain(
      "setAiKeyVisible(false)"
    );
    expect(applicationSettingsPageSource).toContain(
      "useState(false)"
    );
    expect(applicationSettingsPageSource).toContain(
      'type={aiKeyVisible ? "text" : "password"}'
    );
    expect(applicationSettingsPageSource).toContain(
      'aria-label={\n                          aiKeyVisible'
    );

    expect(prototypeShellHtml).toContain(
      "function toggleAiApiKeyVisibility()"
    );
    expect(prototypeApiKeyStart).toBeGreaterThan(-1);
    expect(prototypeApiKeySource).toContain(
      'type: state.aiKeyVisible ? "text" : "password"'
    );
    expect(prototypeApiKeySource).toContain(
      'onclick="toggleAiApiKeyVisibility()"'
    );
  });

  it("keeps code-analysis cards level and its diff drawer aligned to the graph", () => {
    expect(css).toMatch(
      /\.analysis-summary-grid\s*>\s*\.analysis-summary-card\s*\{[^}]*margin-top:\s*0;/
    );
    expect(css).toMatch(
      /\.analysis-node-diff-drawer\s*\{[^}]*inset:\s*0 auto 0 0;/
    );
    expect(css).toMatch(
      /\.analysis-workbench\.is-fullscreen\s+\.analysis-node-diff-drawer\s*\{[\s\S]*?inset:\s*0\s+auto\s+0\s+0;/
    );
  });

  it("keeps the analysis graph height independent from node-detail content", () => {
    expect(css).toMatch(
      /\.code-analysis-page\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/
    );
    expect(prototypeShellHtml).toMatch(
      /\.analysis-page-scroll\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/
    );
    for (const source of [css, prototypeShellHtml]) {
      expect(source).toMatch(
        /\.analysis-workbench\s*\{[^}]*flex:\s*1 0 590px;/
      );
    }
  });

  it("keeps code-analysis progress information on one line", () => {
    expect(codeAnalysisPageSource).toContain(
      "执行时间 {formatExecutionTime(elapsedTime)}"
    );
    expect(prototypeShellHtml).toContain(
      "执行时间 ${formatAnalysisExecutionTime"
    );
    for (const source of [css, prototypeShellHtml]) {
      expect(source).toMatch(
        /\.analysis-progress-copy\s*\{[^}]*min-width:\s*0;[^}]*white-space:\s*nowrap;/
      );
      expect(source).toMatch(
        /\.analysis-progress-copy\s*>\s*span:first-child\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*white-space:\s*nowrap;/
      );
      expect(source).toMatch(
        /\.analysis-progress-copy\s*>\s*span:last-child\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/
      );
    }
  });

  it("fills and centers the code-analysis empty state in the remaining page space", () => {
    const emptyStateRule =
      css.match(/\.analysis-empty-state\s*\{([^}]*)\}/)?.[1] ??
      "";

    expect(emptyStateRule).toContain("flex: 1 1 0");
    expect(emptyStateRule).toContain(
      "flex-direction: column"
    );
    expect(emptyStateRule).toContain(
      "justify-content: center"
    );
    expect(emptyStateRule).toContain("min-height: 0");
    expect(emptyStateRule).toContain("text-align: center");
  });

  it("wraps graph-node paths with compact node insets", () => {
    for (const source of [
      codeRelationGraphSource,
      prototypeShellHtml
    ]) {
      expect(source).toContain("analysis-node-copy");
      expect(source).toContain("analysis-node-copy-inner");
      expect(source).toContain("foreignObject");
      expect(source).not.toMatch(
        /truncate(?:AnalysisText)?\(node\.(?:name|location\.path)/
      );
    }
    expect(codeRelationGraphSource).toContain(
      "const NODE_HEIGHT = 88"
    );
    expect(codeRelationGraphSource).toContain(
      "const NODE_TEXT_INSET = 8"
    );
    expect(codeRelationGraphSource).toContain(
      "const NODE_TEXT_TOP = 24"
    );
    expect(prototypeShellHtml).toContain(
      "const nodeHeight = 88"
    );
    expect(prototypeShellHtml).toContain(
      "const nodeTextInset = 8"
    );
    expect(prototypeShellHtml).toContain(
      "const nodeTextTop = 24"
    );
    for (const source of [css, prototypeShellHtml]) {
      expect(source).toMatch(
        /\.analysis-node-copy-inner\s*\{[^}]*padding:\s*0;[^}]*overflow:\s*hidden;/
      );
      expect(source).toMatch(
        /\.analysis-node-copy-inner\s*>\s*\*\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/
      );
      expect(source).toMatch(
        /\.analysis-node-path\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;/
      );
    }
  });

  it("uses distinct colors for graph-node names, documentation, and paths", () => {
    for (const source of [css, prototypeShellHtml]) {
      expect(source).toMatch(
        /\.analysis-node-name\s*\{[^}]*color:\s*var\(--text\);[^}]*fill:\s*var\(--text\);/
      );
      expect(source).toMatch(
        /\.analysis-node-path\s*\{[^}]*color:\s*var\(--muted\);[^}]*fill:\s*var\(--muted\);/
      );
    }
    expect(css).toMatch(
      /\.analysis-node-documentation-summary\s*\{[^}]*color:\s*color-mix\(in srgb,\s*var\(--green\) 62%,\s*var\(--muted\)\);[^}]*fill:\s*color-mix\(in srgb,\s*var\(--green\) 62%,\s*var\(--muted\)\);/
    );
    expect(prototypeShellHtml).toMatch(
      /\.analysis-node-description\s*\{[^}]*color:\s*color-mix\(in srgb,\s*var\(--green\) 62%,\s*var\(--muted\)\);[^}]*fill:\s*color-mix\(in srgb,\s*var\(--green\) 62%,\s*var\(--muted\)\);/
    );
  });

  it("keeps the prototype request-chain focus mirrored in the graph", () => {
    expect(prototypeShellHtml).toMatch(
      /const graphSelected = state\.analysisGraphSelectionCleared\s*\?\s*null\s*:\s*selected \|\| chain\?\.nodes\[0\] \|\| null;/
    );
    expect(prototypeShellHtml).toContain(
      "renderAnalysisFlow(chain, graphSelected)"
    );
    expect(prototypeShellHtml).toContain(
      'element.getAttribute("data-analysis-node-id") === graphSelected?.id'
    );
  });

  it("uses a 300px breadcrumb-switched commit detail surface", () => {
    for (const source of [css, prototypeShellHtml]) {
      expect(source).toMatch(
        /\.history-layout\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\) 300px;/
      );
      expect(source).toMatch(
        /\.history-commit-detail\s*\{[^}]*height:\s*300px;[^}]*min-height:\s*300px;[^}]*max-height:\s*300px;/
      );
      expect(source).toMatch(
        /\.history-commit-breadcrumb button\[aria-current="page"\]\s*\{/
      );
      expect(source).toMatch(
        /\.history-commit-file-browser\s*\{[^}]*grid-template-columns:\s*minmax\(220px,\s*300px\) minmax\(0,\s*1fr\);[^}]*height:\s*100%;/
      );
      expect(source).not.toMatch(
        /\.history-commit-files\[open\]\s*\{/
      );
    }
    expect(css).toMatch(
      /\.history-commit-detail\s+\.commit-file-list\s*\{[^}]*align-content:\s*start;[^}]*grid-auto-rows:\s*max-content;[^}]*overflow:\s*auto;/
    );
    expect(prototypeShellHtml).toMatch(
      /\.history-commit-file-list\s*\{[^}]*align-content:\s*start;[^}]*grid-auto-rows:\s*max-content;[^}]*overflow:\s*auto;/
    );

    expect(repositoryHistorySource).toContain(
      'aria-label="提交详情导航"'
    );
    expect(repositoryHistorySource).toContain(
      'data-history-commit-view="details"'
    );
    expect(repositoryHistorySource).toContain(
      'data-history-commit-view="files"'
    );
    expect(repositoryHistorySource).toContain(
      "view={commitDetailView}"
    );
    expect(repositoryCommitDetailSource).toContain(
      'view === "details"'
    );
    expect(repositoryCommitDetailSource).toContain(
      'className="history-commit-files"'
    );
    expect(repositoryCommitDetailSource).not.toContain(
      'className="history-commit-files-header"'
    );

    expect(prototypeShellHtml).toContain(
      'historyCommitView: "details"'
    );
    expect(prototypeShellHtml).toContain(
      "function setHistoryCommitView(view)"
    );
    expect(prototypeShellHtml).toContain(
      'historyCommitView === "files"'
    );
    expect(prototypeShellHtml).toContain(
      "onclick=\"setHistoryCommitView('details')\""
    );
    expect(prototypeShellHtml).toContain(
      "onclick=\"setHistoryCommitView('files')\""
    );
    expect(prototypeShellHtml).toContain(
      'data-history-commit-view="${historyCommitView}"'
    );
    expect(prototypeShellHtml).not.toContain(
      "historyCommitFilesOpen"
    );
    expect(prototypeShellHtml).not.toContain(
      '<details class="history-commit-files"'
    );
  });

  it("keeps the prototype analysis time first and updates it only after a successful run", () => {
    const runtimeStripStart = prototypeShellHtml.indexOf(
      '<div class="analysis-runtime-strip">'
    );
    const runtimeStrip = prototypeShellHtml.slice(
      runtimeStripStart,
      runtimeStripStart + 500
    );
    expect(runtimeStrip.indexOf("分析时间")).toBeGreaterThan(
      -1
    );
    expect(runtimeStrip.indexOf("分析时间")).toBeLessThan(
      runtimeStrip.indexOf('workspaceScope ? "全部代码"')
    );
    expect(prototypeShellHtml).toContain(
      "state.analysisGeneratedAt = new Date().toISOString();"
    );
  });

  it("keeps prototype analysis scopes isolated and switches between Diff and source", () => {
    expect(prototypeShellHtml).not.toContain(
      "Workspace 代码智能"
    );
    expect(prototypeShellHtml).not.toContain(
      "可观察后台任务"
    );
    expect(prototypeShellHtml).toContain(
      "for (const chain of analysisChainsInCurrentScope())"
    );
    expect(prototypeShellHtml).toContain(
      "analysisChainsInCurrentScope().find((candidate) => candidate.id === chainId)"
    );
    expect(prototypeShellHtml).toContain(
      'selectedNode.changed ? "查看文件 Diff" : "查看代码"'
    );
    expect(prototypeShellHtml).toContain(
      "function analysisNodeCodeRows(node)"
    );
    expect(prototypeShellHtml).toContain(
      "if (selected && state.analysisDiffExpanded)"
    );
    expect(prototypeShellHtml).not.toContain(
      "if (!selected?.changed)"
    );
  });

  it("keeps blank relationship-graph clicks in an explicit unselected state", () => {
    expect(codeAnalysisPageSource).toContain(
      "const graphSelectedNodeId = graphSelectionCleared"
    );
    expect(codeAnalysisPageSource).toContain(
      "setGraphSelectionCleared(true);"
    );
    expect(prototypeShellHtml).toContain(
      "analysisGraphSelectionCleared: false"
    );
    expect(prototypeShellHtml).toContain(
      "state.analysisGraphSelectionCleared = true;"
    );
    expect(
      prototypeShellHtml.match(
        /const graphSelected = state\.analysisGraphSelectionCleared/g
      )
    ).toHaveLength(2);
  });

  it("keeps the analysis node action area fixed below the scrollable details", () => {
    expect(css).toMatch(
      /\.analysis-chain-panel\.is-node-detail\s*\{\s*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;/
    );
    expect(css).toMatch(
      /\.analysis-node-details\s*\{[^}]*overflow:\s*auto;/
    );
    expect(codeAnalysisPageSource).toMatch(
      /<\/div>\s*<section className="analysis-node-diff-trigger">/
    );
    expect(prototypeShellHtml).toContain(
      ".analysis-chain-panel.is-node-detail"
    );
    expect(prototypeShellHtml).toMatch(
      /<\/div>\s*<section class="analysis-node-diff-trigger">/
    );
  });

  it("keeps prototype node details aligned with the application layout", () => {
    expect(prototypeShellHtml).toMatch(
      /\.analysis-node-details \.detail-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/
    );
    expect(prototypeShellHtml).toMatch(
      /\.analysis-node-details \.detail-row\s*\{[^}]*padding:\s*var\(--space-2\);[^}]*background:\s*var\(--surface-2\);[^}]*border:\s*1px solid var\(--border-soft\);/
    );
    expect(prototypeShellHtml).toContain(
      'class="detail-row analysis-detail-wide"'
    );
    expect(prototypeShellHtml).toContain(
      '<section class="analysis-node-documentation">'
    );
    expect(prototypeShellHtml).toContain("<h3>代码注释</h3>");
  });

  it("uses the shared editor palette for code-analysis source and neutral Diff rows", () => {
    expect(designTokensCss).toContain(
      "--color-code-bg: #1f1f1f;"
    );
    expect(designTokensCss).toContain(
      "--color-code-keyword: #c586c0;"
    );
    expect(designTokensCss).toContain(
      "--color-code-type: #4ec9b0;"
    );
    expect(designTokensCss).toContain(
      "--color-code-function: #dcdcaa;"
    );
    expect(designTokensCss).toContain(
      "--color-code-property: #9cdcfe;"
    );
    expect(designTokensCss).toContain(
      "--color-code-string: #ce9178;"
    );
    expect(designTokensCss).toContain(
      "--color-code-comment: #6a9955;"
    );
    expect(css).toContain(
      ".analysis-node-source-line .analysis-source-token.is-keyword"
    );
    expect(css).toContain(
      "color: var(--color-code-keyword);"
    );
    expect(css).toContain(
      "color: var(--color-code-type);"
    );
    expect(css).toContain(
      "color: var(--color-code-function);"
    );
    expect(css).toContain(
      ".diff-viewer-search-hit.current"
    );
    expect(prototypeShellHtml).toContain(
      ".analysis-node-diff-panel.is-code-view .gn-diff-panel__syntax-token.is-keyword"
    );
    expect(prototypeShellHtml).toContain(
      "syntaxTokens: syntaxLines[index] || []"
    );
    expect(prototypeDiffPanelSource).toContain(
      "function tokenizeSourceLines("
    );
    expect(prototypeDiffPanelSource).toContain(
      "row.syntaxTokens"
    );
    expect(prototypeDiffPanelSource).toMatch(
      /syntaxMarkup\(\s*text,\s*hit\.start,\s*hit\.end,\s*tokens\s*\)/
    );
  });

  it("uses a layout-matched skeleton for the initial code-analysis load", () => {
    expect(codeAnalysisPageSource).toContain(
      "fallback={<CodeAnalysisSkeleton />}"
    );
    expect(codeAnalysisPageSource).toContain(
      "hasContent={Boolean(availableSnapshot)}"
    );
    expect(codeAnalysisPageSource).toContain(
      'label="正在读取代码分析"'
    );
    expect(css).toMatch(
      /\.analysis-skeleton-workbench\s*\{[^}]*flex:\s*1 0 590px;/
    );
    expect(prototypeShellHtml).toContain(
      "function renderCodeAnalysisSkeleton()"
    );
    expect(prototypeShellHtml).toContain(
      'aria-label="正在读取代码分析"'
    );
    expect(prototypeShellHtml).toContain(
      "if (state.analysisLoading)"
    );
    expect(prototypeButtonCss).toContain(
      "@keyframes gn-skeleton-shimmer"
    );
  });

  it("keeps analysis warnings beside the aggregated LSP state at the runtime row height", () => {
    const runtimeStripStart = prototypeShellHtml.indexOf(
      '<div class="analysis-runtime-strip">'
    );
    const runtimeStrip = prototypeShellHtml.slice(
      runtimeStripStart,
      runtimeStripStart + 900
    );
    const serverStateIndex = runtimeStrip.indexOf(
      "renderAnalysisLanguageServerStates()"
    );
    const warningIndex = runtimeStrip.indexOf(
      'class="analysis-warning-panel"'
    );

    expect(serverStateIndex).toBeGreaterThan(-1);
    expect(warningIndex).toBeGreaterThan(serverStateIndex);
    expect(codeAnalysisPageSource).toContain(
      "LSP：{connectedLanguageServers.length} 个已连接"
    );
    expect(prototypeShellHtml).toContain(
      "LSP：${connectedServers.length} 个已连接"
    );
    for (const source of [css, prototypeShellHtml]) {
      expect(source).toMatch(
        /\.analysis-runtime-strip\s*>\s*span,\s*\.analysis-warning-panel\s*>\s*summary(?:,\s*[^{}]+)?\s*\{[\s\S]*?height:\s*28px;/
      );
      expect(source).toMatch(
        /\.analysis-warning-panel\s*>\s*\.analysis-warning-menu\s*\{[\s\S]*?position:\s*absolute;/
      );
    }
  });

  it("uses clearable code-analysis filters and the shared dropdown component", () => {
    expect(prototypeShellHtml).toContain(
      'ariaLabel: "清空请求链筛选"'
    );
    expect(prototypeShellHtml).toContain(
      'class="analysis-method-menu"'
    );
    expect(prototypeShellHtml).toContain(
      'data-dropdown-id="analysis-method-filter"'
    );
    expect(prototypeShellHtml).toContain(
      'role: "menuitemradio"'
    );
    expect(prototypeShellHtml).not.toContain(
      '<select aria-label="按 HTTP 方法筛选"'
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
