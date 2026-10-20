import { build } from "esbuild";
import { copyFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { excludeEvaluationEsbuild } from "../scripts/production-inputs.mjs";

await build({
  entryPoints: ["host/cli.ts"],
  outfile: "build/host/omnicode-host.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  loader: { ".ps1": "text", ".sh": "text", ".md": "text" },
  define: { "import.meta.hot": "undefined" },
  plugins: [excludeEvaluationEsbuild(), {
    name: "workbuddy-runtime-source",
    setup(build) {
      build.onResolve({ filter: /workbuddyRuntime\.cjs\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "workbuddy-runtime" }));
      build.onLoad({ filter: /.*/, namespace: "workbuddy-runtime" }, async args => ({ contents: await readFile(args.path, "utf8"), loader: "text" }));
    },
  }],
  sourcemap: true,
  // The workflow analyzer bundles the CommonJS TypeScript compiler, which reads
  // require/__filename at load time; provide them in the ESM output.
  banner: {
    js: [
      'import { createRequire as __omnicodeCreateRequire } from "node:module";',
      'import { fileURLToPath as __omnicodeFileURLToPath } from "node:url";',
      'import { dirname as __omnicodeDirname } from "node:path";',
      "const require = __omnicodeCreateRequire(import.meta.url);",
      "const __filename = __omnicodeFileURLToPath(import.meta.url);",
      "const __dirname = __omnicodeDirname(__filename);",
    ].join("\n"),
  },
});
await copyFile("host/provider-guard.mjs", "build/host/provider-guard.mjs");
