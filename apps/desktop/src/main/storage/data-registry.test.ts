import { isAbsolute, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createDataRegistry } from "./data-registry";

describe("createDataRegistry", () => {
  it("keeps every unique dataset inside the user data root", () => {
    const registry = createDataRegistry(
      resolve("C:\\fixture\\gitnest-user-data")
    );
    const ids = registry.descriptors.map(
      (descriptor) => descriptor.id
    );
    const paths = registry.descriptors.map(
      (descriptor) => descriptor.path
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      const child = relative(registry.root, path);
      expect(isAbsolute(child)).toBe(false);
      expect(child).not.toBe("..");
      expect(child.startsWith(`..\\`)).toBe(false);
      expect(child.startsWith("../")).toBe(false);
    }
  });

  it("classifies secrets, durable state, caches and runtime data", () => {
    const registry = createDataRegistry(
      resolve("C:\\fixture\\gitnest-user-data")
    );
    const byId = new Map(
      registry.descriptors.map((descriptor) => [
        descriptor.id,
        descriptor
      ])
    );

    expect(byId.get("app-settings")).toMatchObject({
      category: "durable",
      rebuildable: false,
      sensitive: true
    });
    expect(byId.get("credential-vault")).toMatchObject({
      category: "durable",
      rebuildable: false,
      sensitive: true
    });
    expect(
      byId.get("code-analysis-index")?.retention
    ).toMatchObject({
      policy: "bounded",
      maxAgeDays: 30
    });
    expect(byId.get("askpass-runtime")).toMatchObject({
      category: "runtime",
      rebuildable: true,
      sensitive: true
    });
  });

  it("rejects a relative root", () => {
    expect(() =>
      createDataRegistry("relative/user-data")
    ).toThrow(/absolute/i);
  });
});
