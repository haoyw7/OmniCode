import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  test: {
    environment: "node",
    include: ["host/bots/eval/tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  cacheDir: "/tmp/monocode-eval-vite-cache",
});
