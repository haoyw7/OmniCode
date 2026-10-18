import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/helpers/localeEnvironment.ts", "./tests/helpers/motionEnvironment.ts"],
    include: ["src/**/*.test.ts"],
  },
});
