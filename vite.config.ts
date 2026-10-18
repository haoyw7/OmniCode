import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fontScale from "./scripts/postcss-font-scale.mjs";
import { excludeEvaluationVite } from "./scripts/production-inputs.mjs";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  const stable = mode === "stable";

  return {
    plugins: [excludeEvaluationVite(), react(), tailwindcss()],
    // Pierre's highlighting worker imports Shiki's WASM engine dynamically.
    worker: { format: "es", plugins: () => [excludeEvaluationVite()] },
    // Settings → Appearance font sizes and reduced-motion override.
    css: { postcss: { plugins: [fontScale()] } },
    clearScreen: false,
    build: {
      rollupOptions: {
        // The quick composer panel loads its own page so it does not boot the
        // whole workspace.
        input: {
          main: "index.html",
          quickComposer: "quick-composer.html",
        },
      },
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: stable
        ? false
        : host
          ? {
              protocol: "ws",
              host,
              port: 1421,
            }
          : undefined,
      watch: {
        // Cargo writes into the workspace-level target directory. On Windows,
        // watching a binary while the linker writes it can fail with EBUSY.
        ignored: stable
          ? ["**/*"]
          : ["**/src-tauri/**", "**/target/**", "**/build/**"],
      },
    },
  };
});
