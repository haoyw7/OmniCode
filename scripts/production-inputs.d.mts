import type { Plugin as EsbuildPlugin } from "esbuild";
import type { Plugin as VitePlugin } from "vite";

export function isEvaluationInput(path: string, root?: string): boolean;
export function excludeEvaluationEsbuild(): EsbuildPlugin;
export function excludeEvaluationVite(): VitePlugin;
