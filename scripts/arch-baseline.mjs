import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Architecture dependency ratchet. Existing violations are recorded in the
// baseline; new ones fail, and fixed ones tighten the baseline.
//   node scripts/arch-baseline.mjs                  check (CI: stale baseline fails)
//   node scripts/arch-baseline.mjs --update         rewrite the baseline
//   node scripts/arch-baseline.mjs --report out.md  write a readable report

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BASELINE = "docs/architecture-baseline.json";
const SCAN_ROOTS = ["src", "host"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build"]);
const SKIP_PATHS = new Set(["host/bots/eval"]);

const featureOf = (p) => p.match(/^src\/features\/([^/]+)\//)?.[1];

export const RULES = [
  {
    id: "shared-upward",
    title: "src/shared 依赖上层（features/app/mobile/integrations/platform）",
    test: (i) => !i.bare && i.from.startsWith("src/shared/") && /^src\/(features|app|mobile|integrations|platform)\//.test(i.to),
  },
  {
    id: "platform-upward",
    title: "src/platform 依赖业务层（features/app/mobile/integrations）",
    test: (i) => !i.bare && i.from.startsWith("src/platform/") && /^src\/(features|app|mobile|integrations)\//.test(i.to),
  },
  {
    id: "integrations-to-features",
    title: "src/integrations 依赖 features/app/mobile",
    test: (i) => !i.bare && i.from.startsWith("src/integrations/") && /^src\/(features|app|mobile)\//.test(i.to),
  },
  {
    id: "harness-core-to-providers",
    title: "harness/core 依赖具体 provider",
    test: (i) => !i.bare && i.from.startsWith("src/integrations/harness/core/") && i.to.startsWith("src/integrations/harness/providers/"),
  },
  {
    id: "features-to-app",
    title: "features 依赖 src/app（应用壳）",
    test: (i) => !i.bare && i.from.startsWith("src/features/") && i.to.startsWith("src/app/"),
  },
  {
    id: "desktop-to-mobile",
    title: "非移动端代码依赖 src/mobile",
    test: (i) => !i.bare && /^src\/(features|app|integrations|shared|platform)\//.test(i.from) && i.to.startsWith("src/mobile/"),
  },
  {
    id: "mobile-to-app",
    title: "src/mobile 依赖桌面应用壳 src/app",
    test: (i) => !i.bare && i.from.startsWith("src/mobile/") && i.to.startsWith("src/app/"),
  },
  {
    id: "mobile-desktop-css",
    title: "src/mobile 引入桌面 CSS",
    test: (i) => !i.bare && i.from.startsWith("src/mobile/") && i.to.endsWith(".css") && !/^src\/(mobile|shared)\//.test(i.to),
  },
  {
    id: "feature-ui-cross",
    title: "feature 深层引用其他 feature 的 ui/ 内部组件",
    test: (i) => {
      if (i.bare) return false;
      const from = featureOf(i.from);
      const to = featureOf(i.to);
      return Boolean(from && to && from !== to && /^src\/features\/[^/]+\/(.+\/)?ui\//.test(i.to));
    },
  },
  {
    id: "tauri-outside-platform",
    title: "在 src/platform 之外直接引用 @tauri-apps",
    test: (i) => i.bare && i.to.startsWith("@tauri-apps/") && i.from.startsWith("src/") && !i.from.startsWith("src/platform/"),
  },
  {
    id: "mobile-tauri",
    title: "src/mobile 引用 @tauri-apps（移动端是 Capacitor）",
    test: (i) => i.bare && i.to.startsWith("@tauri-apps/") && i.from.startsWith("src/mobile/"),
  },
  {
    id: "host-to-ui",
    title: "host 依赖前端 UI / app / mobile / platform",
    test: (i) => !i.bare && i.from.startsWith("host/") && (/^src\/(app|mobile|platform)\//.test(i.to) || /\/ui\//.test(i.to) || i.to.endsWith(".tsx")),
  },
  {
    id: "host-to-feature-model",
    title: "host 依赖 features 非 UI 模块（待迁移到契约层）",
    test: (i) => !i.bare && i.from.startsWith("host/") && i.to.startsWith("src/features/") && !/\/ui\//.test(i.to) && !i.to.endsWith(".tsx"),
  },
];

const IMPORT = /^\s*(import|export)\s+(type\s+)?(?:([^'";]*?)\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm;
const slash = (p) => p.replaceAll("\\", "/");

function sourceFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const local = slash(relative(root, path));
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name) || SKIP_PATHS.has(local)) continue;
      if (entry.isDirectory()) walk(path);
      else if (/\.(tsx?|mjs)$/.test(entry.name) && !/\.test\.(tsx?|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
        files.push(path);
    }
  };
  for (const dir of SCAN_ROOTS) if (existsSync(join(root, dir))) walk(join(root, dir));
  return files.sort();
}

function resolveImport(from, spec) {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx"), base.replace(/\.js$/, ".ts")])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return undefined;
}

function isTypeOnly(match) {
  if (match[2]) return true;
  const clause = match[3]?.trim();
  if (!clause || !/^\{[^}]*\}$/s.test(clause)) return false;
  const names = clause.slice(1, -1).split(",").map((name) => name.trim()).filter(Boolean);
  return names.length > 0 && names.every((name) => name.startsWith("type "));
}

export function collectImports(root = ROOT) {
  const imports = [];
  for (const file of sourceFiles(root)) {
    const source = readFileSync(file, "utf8");
    const from = slash(relative(root, file));
    for (const match of source.matchAll(IMPORT)) {
      const spec = match[4] ?? match[5];
      const start = match.index + match[0].length - match[0].trimStart().length;
      const line = source.slice(0, start).split("\n").length;
      const typeOnly = isTypeOnly(match);
      if (!spec.startsWith(".")) imports.push({ from, to: spec, typeOnly, line, bare: true });
      else {
        const target = resolveImport(file, spec);
        if (target) imports.push({ from, to: slash(relative(root, target)), typeOnly, line, bare: false });
      }
    }
  }
  return imports;
}

function cycles(imports) {
  const graph = new Map();
  for (const { from, to, bare } of imports) {
    if (bare) continue;
    if (!graph.has(from)) graph.set(from, new Set());
    graph.get(from).add(to);
  }
  let next = 0;
  const stack = [];
  const onStack = new Set();
  const index = new Map();
  const low = new Map();
  const found = [];
  const visit = (node) => {
    index.set(node, next);
    low.set(node, next++);
    stack.push(node);
    onStack.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node), low.get(target)));
      } else if (onStack.has(target)) low.set(node, Math.min(low.get(node), index.get(target)));
    }
    if (low.get(node) !== index.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1) found.push(component.sort());
  };
  for (const node of [...graph.keys()].sort()) if (!index.has(node)) visit(node);
  return found.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

export function analyze(root = ROOT) {
  const imports = collectImports(root);
  const rules = RULES.map((rule) => ({
    id: rule.id,
    title: rule.title,
    hits: imports.filter(rule.test).sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line),
  }));
  return { fileCount: new Set(imports.map((i) => i.from)).size, importCount: imports.length, rules, cycles: cycles(imports) };
}

const edgeKey = (hit) => `${hit.from} -> ${hit.to}`;

export function toBaseline(analysis) {
  return {
    version: 1,
    rules: Object.fromEntries(analysis.rules.map((rule) => [rule.id, [...new Set(rule.hits.map(edgeKey))].sort()])),
    cycleFiles: [...new Set(analysis.cycles.flat())].sort(),
  };
}

/** New entries are regressions; resolved entries mean the baseline can tighten. */
export function compareBaseline(baseline, current) {
  const added = [];
  const resolved = [];
  const ids = new Set([...Object.keys(baseline.rules ?? {}), ...Object.keys(current.rules)]);
  for (const id of ids) {
    const before = new Set(baseline.rules?.[id] ?? []);
    const after = new Set(current.rules[id] ?? []);
    for (const key of after) if (!before.has(key)) added.push({ rule: id, key });
    for (const key of before) if (!after.has(key)) resolved.push({ rule: id, key });
  }
  const beforeCycles = new Set(baseline.cycleFiles ?? []);
  const afterCycles = new Set(current.cycleFiles);
  for (const file of afterCycles) if (!beforeCycles.has(file)) added.push({ rule: "file-cycles", key: file });
  for (const file of beforeCycles) if (!afterCycles.has(file)) resolved.push({ rule: "file-cycles", key: file });
  return { added, resolved };
}

export function renderReport(analysis) {
  const lines = [
    "# 架构依赖违规报告",
    "",
    `扫描 ${analysis.fileCount} 个非测试源文件，共 ${analysis.importCount} 条 import。\`[T]\` 表示 type-only 导入。`,
    "",
    "| 规则 | 违规数 | 其中 type-only | 涉及文件 |",
    "|---|---|---|---|",
  ];
  for (const rule of analysis.rules)
    lines.push(`| \`${rule.id}\` ${rule.title} | ${rule.hits.length} | ${rule.hits.filter((h) => h.typeOnly).length} | ${new Set(rule.hits.map((h) => h.from)).size} |`);
  lines.push(`| \`file-cycles\` 文件级循环依赖 | ${analysis.cycles.length} 个环 | — | ${analysis.cycles.flat().length} |`, "");
  for (const rule of analysis.rules) {
    lines.push(`## \`${rule.id}\` — ${rule.title}（${rule.hits.length}）`, "");
    if (!rule.hits.length) lines.push("无。");
    for (const hit of rule.hits) lines.push(`- \`${hit.from}:${hit.line}\` → \`${hit.to}\`${hit.typeOnly ? " [T]" : ""}`);
    lines.push("");
  }
  lines.push(`## \`file-cycles\` — 文件级循环依赖（${analysis.cycles.length}）`, "");
  analysis.cycles.forEach((component, n) => {
    lines.push(`${n + 1}. **${component.length} 个文件**`);
    for (const file of component) lines.push(`   - \`${file}\``);
  });
  return `${lines.join("\n")}\n`;
}

function main(args) {
  const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const baselinePath = resolve(ROOT, option("--baseline") ?? BASELINE);
  const analysis = analyze();
  const current = toBaseline(analysis);
  const write = () => writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  const report = option("--report");
  if (report) {
    writeFileSync(resolve(process.cwd(), report), renderReport(analysis));
    console.log(`Architecture report written to ${report}`);
  }
  if (args.includes("--update")) {
    write();
    console.log(`Architecture baseline updated: ${slash(relative(ROOT, baselinePath))}`);
    return 0;
  }
  if (!existsSync(baselinePath)) {
    console.error(`Missing ${slash(relative(ROOT, baselinePath))}; run: node scripts/arch-baseline.mjs --update`);
    return 1;
  }
  const { added, resolved } = compareBaseline(JSON.parse(readFileSync(baselinePath, "utf8")), current);
  if (added.length) {
    const location = new Map(analysis.rules.flatMap((rule) => rule.hits.map((hit) => [`${rule.id}|${edgeKey(hit)}`, hit])));
    console.error(`New architecture violations (${added.length}):`);
    for (const { rule, key } of added) {
      const hit = location.get(`${rule}|${key}`);
      console.error(`  [${rule}] ${hit ? `${hit.from}:${hit.line} -> ${hit.to}` : key}`);
    }
    console.error("Fix the dependency direction; see AGENTS.md. Update the baseline only for an approved exception.");
    return 1;
  }
  if (resolved.length) {
    if (process.env.CI) {
      console.error(`${resolved.length} baseline entries are resolved; run npm run check:arch locally and commit ${BASELINE}.`);
      return 1;
    }
    write();
    console.log(`Architecture baseline tightened by ${resolved.length} resolved entries.`);
    return 0;
  }
  const total = Object.values(current.rules).reduce((sum, keys) => sum + keys.length, 0);
  console.log(`Architecture check passed: no new violations (${total} baseline edges, ${current.cycleFiles.length} files in cycles).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
