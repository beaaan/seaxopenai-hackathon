import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, whose root is web/.
export default defineConfig({
  test: {
    root: ".",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
