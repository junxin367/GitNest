/** @vitest-environment jsdom */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./Button";
import { Skeleton, SkeletonSurface } from "./Skeleton";

describe("Button", () => {
  it("renders the shared size, variant, and selected contract", () => {
    const markup = renderToStaticMarkup(
      <Button
        aria-label="切换视图"
        icon={<span>icon</span>}
        selected
        size="small"
        variant="toolbar"
      >
        统一
      </Button>
    );

    expect(markup).toContain('class="gn-button"');
    expect(markup).toContain('data-size="small"');
    expect(markup).toContain('data-variant="toolbar"');
    expect(markup).toContain('data-selected="true"');
    expect(markup).toContain('class="gn-button__icon"');
    expect(markup).toContain('class="gn-button__label"');
  });

  it("uses icon-only structure for icon buttons", () => {
    const markup = renderToStaticMarkup(
      <Button
        aria-label="关闭"
        icon={<span>x</span>}
        variant="icon"
      />
    );

    expect(markup).toContain('data-size="small"');
    expect(markup).toContain('data-icon-only="true"');
    expect(markup).not.toContain("gn-button__label");
  });

  it("preserves legacy structure for unstyled buttons", () => {
    const markup = renderToStaticMarkup(
      <Button className="window-button" variant="unstyled">
        最小化
      </Button>
    );

    expect(markup).toContain('class="window-button"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain(">最小化</button>");
    expect(markup).not.toContain("gn-button");
    expect(markup).not.toContain("gn-button__label");
  });

  it("renders the shared skeleton shape and accessible surface contracts", () => {
    const markup = renderToStaticMarkup(
      <SkeletonSurface
        as="section"
        className="page-skeleton"
        label="正在读取页面"
      >
        <Skeleton height={32} variant="circle" width={32} />
        <Skeleton variant="text" width="60%" />
        <Skeleton height={96} variant="block" />
      </SkeletonSurface>
    );

    expect(markup).toContain(
      'class="gn-skeleton-surface page-skeleton"'
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-label="正在读取页面"');
    expect(markup).toContain('data-variant="circle"');
    expect(markup).toContain('data-variant="text"');
    expect(markup).toContain('data-variant="block"');
    expect(markup).toContain('aria-hidden="true"');
  });
});
