import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    setupFiles: ["./tests/helpers/localeEnvironment.ts", "./tests/helpers/motionEnvironment.ts"],
    include: ["src/**/*.test.ts"],
  },
});
