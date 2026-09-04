import type { GitNestBridge } from "@gitnest/contracts";

declare global {
  interface Window {
    gitnest: GitNestBridge;
  }
}

export {};
