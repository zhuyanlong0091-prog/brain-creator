import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.brain-creator-test/**",
      "**/.brain-creator/**",
      "tests/e2e/**",
      "tests/generated/**",
      "tests/seed-*.spec.ts"
    ]
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname
    }
  }
});
