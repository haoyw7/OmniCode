import { isAbsolute, relative, resolve } from "node:path";

// Evaluation code, datasets and reports are development-only, including the
// legacy repository-root directory. Keep this check shared by every bundler
// and the source snapshot sent to the Windows builder.
export function isEvaluationInput(path, root = process.cwd()) {
  const clean = path.replace(/[?#].*$/, "");
  const local = relative(root, isAbsolute(clean) ? clean : resolve(root, clean))
    .replaceAll("\\", "/");
  return /^(?:host\/bots\/)?eval(?:\/|$)/.test(local);
}

function rejectEvaluationInput(path, root) {
  if (isEvaluationInput(path, root))
    throw new Error(`Evaluation files must not enter production bundles: ${path}`);
}

export function excludeEvaluationEsbuild() {
  return {
    name: "exclude-evaluation",
    setup(build) {
      const root = build.initialOptions.absWorkingDir ?? process.cwd();
      build.onLoad({ filter: /[\\/]eval[\\/]/ }, ({ path }) => {
        rejectEvaluationInput(path, root);
        return null;
      });
    },
  };
}

export function excludeEvaluationVite() {
  let root = process.cwd();
  return {
    name: "exclude-evaluation",
    apply: "build",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    load(id) {
      rejectEvaluationInput(id, root);
      return null;
    },
  };
}
