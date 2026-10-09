/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import { Icon } from "../../shared/ui/Icon";
import { ActivityRail } from "./ActivityRail";

describe("ActivityRail", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("places code analysis above the operation center", () => {
    const markup = renderToStaticMarkup(
      <ActivityRail
        activeView="workspace"
        onNavigate={vi.fn()}
        onOpenSearch={vi.fn()}
        onOpenTerminal={vi.fn()}
        onToggleSidebar={vi.fn()}
        onToggleTheme={vi.fn()}
        searchOpen={false}
        sidebarCollapsed={false}
        sidebarDisabled={false}
        terminalDisabled={false}
        terminalTitle="打开终端"
        theme="dark"
      />
    );
    const analysisIndex = markup.indexOf(
      'aria-label="代码分析"'
    );
    const operationsIndex = markup.indexOf(
      'aria-label="操作中心"'
    );

    expect(analysisIndex).toBeGreaterThan(-1);
    expect(operationsIndex).toBeGreaterThan(analysisIndex);
    expect(markup).not.toContain("rail-badge");
  });

  it("uses the four-node graph icon from the prototype", () => {
    const markup = renderToStaticMarkup(
      <Icon name="graph" size={20} />
    );

    expect(markup).toContain('cx="8" cy="19"');
    expect(markup).toContain('cx="19" cy="18"');
    expect(markup).toContain(
      'd="m7 6 10-1M6 8l2 9M10 18l7-1M18 7v9M7 7l10 9"'
    );
  });

  it.each([true, false])("only toggles the directory panel when available (disabled: %s)", sidebarDisabled => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onToggleSidebar = vi.fn();
    try {
      act(() => root.render(
        <ActivityRail
          activeView={sidebarDisabled ? "settings" : "repository"}
          searchOpen={false}
          sidebarCollapsed
          sidebarDisabled={sidebarDisabled}
          terminalDisabled
          terminalTitle="打开终端"
          theme="dark"
          onNavigate={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenTerminal={vi.fn()}
          onToggleSidebar={onToggleSidebar}
          onToggleTheme={vi.fn()}
        />
      ));
      const toggle = container.querySelector<HTMLButtonElement>('[aria-label="展开仓库目录"]')!;
      expect(toggle.disabled).toBe(sidebarDisabled);
      expect(toggle.getAttribute("title")).toBe(sidebarDisabled ? null : "展开仓库目录");
      act(() => toggle.click());
      expect(onToggleSidebar).toHaveBeenCalledTimes(sidebarDisabled ? 0 : 1);
    } finally {
      act(() => root.unmount());
    }
  });
});
