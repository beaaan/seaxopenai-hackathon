import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, whose root is web/.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)) },
  },
  test: {
    root: ".",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "web/src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
