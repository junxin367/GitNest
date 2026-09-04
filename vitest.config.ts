import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/**/*.test.{ts,tsx}",
      "packages/**/*.test.{ts,tsx}"
    ],
    exclude: [
      "**/node_modules/**",
      "**/out/**",
      "**/dist/**"
    ],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    passWithNoTests: false
  }
});
