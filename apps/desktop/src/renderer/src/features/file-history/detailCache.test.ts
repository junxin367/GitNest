import { describe, expect, it } from "vitest";
import { DetailCache } from "./detailCache";

describe("file history detail cache bounds", () => {
  it("evicts the least recently read entry at the count limit", () => {
    const cache = new DetailCache<string>(2, 100);
    cache.set("a", "A", 1);
    cache.set("b", "B", 1);
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C", 1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
  });

  it("also bounds retained weight and never retains an oversized result", () => {
    const cache = new DetailCache<string>(12, 10);
    cache.set("a", "A", 6);
    cache.set("b", "B", 6);
    expect(cache.get("a")).toBeUndefined();
    cache.set("large", "large", 11);
    expect(cache.get("large")).toBeUndefined();
    expect(cache.get("b")).toBe("B");
  });

  it("replaces weights and clears all scope data", () => {
    const cache = new DetailCache<string>(12, 10);
    cache.set("a", "old", 8);
    cache.set("a", "new", 2);
    cache.set("b", "B", 8);
    expect(cache.get("a")).toBe("new");
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    cache.set("c", "C", 10);
    expect(cache.get("c")).toBe("C");
  });
});
