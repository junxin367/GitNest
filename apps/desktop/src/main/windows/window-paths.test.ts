import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolvePreloadPath,
  resolveTrayMenuPreloadPath,
  resolveRendererPath
} from "./window-paths";

describe("desktop build paths", () => {
  it("loads the CommonJS preload emitted for a sandboxed renderer", () => {
    const mainOutputDirectory = join("C:", "GitNest", "out", "main");

    expect(resolvePreloadPath(mainOutputDirectory)).toBe(
      join("C:", "GitNest", "out", "preload", "index.js")
    );
  });

  it("loads the renderer next to the main output directory", () => {
    const mainOutputDirectory = join("C:", "GitNest", "out", "main");

    expect(resolveRendererPath(mainOutputDirectory)).toBe(
      join("C:", "GitNest", "out", "renderer", "index.html")
    );
  });

  it("loads the isolated tray menu preload from packaged output", () => {
    expect(resolveTrayMenuPreloadPath(join("C:", "GitNest", "out", "main"))).toBe(
      join("C:", "GitNest", "out", "preload", "tray-menu.js")
    );
  });
});
