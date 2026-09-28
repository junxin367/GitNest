import { join } from "node:path";

export function resolvePreloadPath(mainOutputDirectory: string): string {
  return join(mainOutputDirectory, "../preload/index.js");
}

export function resolveRendererPath(mainOutputDirectory: string): string {
  return join(mainOutputDirectory, "../renderer/index.html");
}
