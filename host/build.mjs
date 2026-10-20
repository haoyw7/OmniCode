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
    name: "raw-resources",
    setup(builder) {
      builder.onLoad({ filter: /\.[cm]js\?raw$/ }, async args => ({
        contents: await readFile(args.path.slice(0, -4), "utf8"), loader: "text",
      }));
      builder.onResolve({ filter: /\.[cm]js\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path) }));
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
