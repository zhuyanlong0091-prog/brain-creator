import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    fileParallelism: false,
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.worktrees/**",
      "**/.brain-creator-test/**",
      "**/.brain-creator/**",
      "**/output/**",
      "**/outputs/**",
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
