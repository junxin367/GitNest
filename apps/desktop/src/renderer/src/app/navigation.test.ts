import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppPageLoadingFallback } from "./App";

import {
  repositoryTabForTargetSwitch,
  shouldOpenGlobalSearch,
  type RepositoryTab
} from "./navigation";

describe("repositoryTabForTargetSwitch", () => {
  it.each<RepositoryTab>([
    "overview",
    "changes",
    "history",
    "branches",
    "worktrees"
  ])("keeps the current %s tab", (tab) => {
    expect(repositoryTabForTargetSwitch(tab)).toBe(tab);
  });

  it("opens the overview when there is no previous repository tab", () => {
    expect(repositoryTabForTargetSwitch()).toBe("overview");
  });
});

describe("page loading layouts", () => {
  it.each([
    ["settings", "settings", "正在读取应用设置"],
    ["analysis", "analysis", "正在读取代码分析"],
    ["operations", "list", "正在读取操作中心"],
    ["workspace", "overview", "正在读取 Workspace 概览"]
  ] as const)("matches the %s page before its module or data is ready", (view, layout, label) => {
    const markup = renderToStaticMarkup(createElement(AppPageLoadingFallback, { view }));
    expect(markup).toContain(`data-layout="${layout}"`);
    expect(markup).toContain(`aria-label="${label}"`);
    if (view === "analysis") {
      expect(markup.match(/analysis-skeleton-summary-card/g)).toHaveLength(5);
      expect(markup).toContain("analysis-workbench");
      expect(markup).toContain("analysis-graph-controls");
      expect(markup).not.toContain("app-skeleton-columns");
    }
  });

  it("uses the changes workspace and commit panel when switching repositories on the changes tab", () => {
    const markup = renderToStaticMarkup(createElement(AppPageLoadingFallback, {
      view: "repository", repositoryTab: "changes"
    }));
    expect(markup).toContain("diff-workspace-skeleton");
    expect(markup).toContain("diff-workspace-skeleton-commit");
    expect(markup).not.toContain("gn-skeleton-heading");
  });
});

describe("global search shortcut", () => {
  const shortcut = {
    key: "k", ctrlKey: true, metaKey: false,
    defaultPrevented: false, isComposing: false
  };

  it("keeps an existing modal in control of the keyboard and permits search after dismissal", () => {
    expect(shouldOpenGlobalSearch(shortcut, true)).toBe(false);
    expect(shouldOpenGlobalSearch(shortcut, false)).toBe(true);
    expect(shouldOpenGlobalSearch({
      ...shortcut, ctrlKey: false, metaKey: true, key: "K"
    }, false)).toBe(true);
  });

  it("does not react to consumed keys, IME composition, or ordinary typing", () => {
    expect(shouldOpenGlobalSearch({
      ...shortcut, defaultPrevented: true
    }, false)).toBe(false);
    expect(shouldOpenGlobalSearch({
      ...shortcut, isComposing: true
    }, false)).toBe(false);
    expect(shouldOpenGlobalSearch({
      ...shortcut, ctrlKey: false
    }, false)).toBe(false);
  });
});
