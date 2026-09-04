import { describe, expect, it } from "vitest";

import { createWindowOptions } from "./window-options";

describe("createWindowOptions", () => {
  it("keeps the renderer isolated from Node.js", () => {
    const options = createWindowOptions("C:\\GitNest\\preload.js");

    expect(options.minWidth).toBe(1100);
    expect(options.width).toBe(1440);
    expect(options.height).toBe(900);
    expect(options.webPreferences).toMatchObject({
      preload: "C:\\GitNest\\preload.js",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    });
  });

  it("applies clamped restored bounds without weakening minimums", () => {
    const options = createWindowOptions(
      "C:\\GitNest\\preload.js",
      {
        x: -1200,
        y: 80,
        width: 1280,
        height: 800
      }
    );

    expect(options).toMatchObject({
      x: -1200,
      y: 80,
      width: 1280,
      height: 800,
      minWidth: 1100,
      minHeight: 720
    });
  });
});
