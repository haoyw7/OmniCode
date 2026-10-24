import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { analyze, collectLocalProviderReferences, compareBaseline, renderReport, toBaseline } from "./arch-baseline.mjs";

const rule = "ui-local-provider-execution";

test("keeps contracts, domain and client independent of their consumers and platform", (t) => {
  const root = fixture(t, {
    "src/contracts/session.ts": 'import type { Session } from "../features/sessions/model/session";\nimport type { ReactNode } from "react";',
    "src/contracts/wire.ts": 'import type { Session } from "./session";',
    "src/domain/project.ts": 'import { invoke } from "@tauri-apps/api/core";\nimport { value } from "../shared/lib/value";\nimport type { Session } from "../contracts/session";',
    "src/client/runtime.ts": 'import { value } from "../shared/lib/value";\nimport type { Session } from "../contracts/session";\nimport { platform } from "../platform/http";\nimport { http } from "@capacitor/core";',
    "src/features/sessions/model/session.ts": 'export type Session = {};',
    "src/shared/lib/value.ts": 'export const value = 1;',
    "src/platform/http.ts": 'export const platform = {};',
  });
  const result = analyze(root);
  for (const id of ["contracts-upward", "domain-upward", "client-upward"])
    assert.equal(result.rules.find((entry) => entry.id === id).hits.length, 2);
});

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "omnicode-arch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) write(root, name, source);
  return root;
}

function write(root, name, source) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

test("rejects local provider references in features and app, including computed access", (t) => {
  const root = fixture(t, {
    "src/features/chat/send.ts": 'import { spawnChild } from "runtime";\nspawnChild(id);',
    "src/app/controller.ts": 'invoke("harness_spawn");\nchild["spawnChild"]();\ninvoke(`harness_spawn`);',
  });
  const analysis = analyze(root);
  const hits = analysis.rules.find((entry) => entry.id === rule).hits;
  assert.equal(hits.length, 5);
  assert.deepEqual(hits.map((hit) => hit.line), [1, 2, 3, 1, 2]);
  const delta = compareBaseline({ rules: {}, cycleFiles: [] }, toBaseline(analysis));
  assert.equal(delta.added.filter((entry) => entry.rule === rule).length, 5);
  assert.match(renderReport(analysis), /src\/app\/controller.ts:1/);
});

test("does not baseline comments, test stubs, declaration files or non-UI owners", (t) => {
  const root = fixture(t, {
    "src/features/chat/send.ts": '// spawnChild(id)\n/* invoke("harness_spawn") */\nconst text = "do not use spawnChild here";',
    "src/features/chat/send.test.ts": 'spawnChild(); invoke("harness_spawn");',
    "src/app/view.test.tsx": 'spawnChild();',
    "src/app/types.d.ts": 'declare const spawnChild: unknown;',
    "src/integrations/harness/core/child.ts": 'invoke("harness_spawn");',
    "host/engine.ts": 'spawnChild();',
  });
  assert.deepEqual(collectLocalProviderReferences(root), []);
});

test("additional calls in an existing file fail while line shifts are stable", (t) => {
  const name = "src/features/chat/send.ts";
  const source = 'import { spawnChild as launch } from "runtime";\nlaunch(id);';
  const root = fixture(t, { [name]: source });
  const baseline = toBaseline(analyze(root));
  write(root, name, `\n// unrelated explanation\n${source}`);
  assert.deepEqual(compareBaseline(baseline, toBaseline(analyze(root))), { added: [], resolved: [] });
  write(root, name, `${source}\nlaunch(otherId);`);
  const delta = compareBaseline(baseline, toBaseline(analyze(root)));
  assert.equal(delta.added.length, 1);
  assert.equal(delta.added[0].rule, rule);
  assert.match(delta.added[0].key, /spawnChild \[reference 4\]/);
  write(root, name, "export const hostOwned = true;");
  const resolved = compareBaseline(baseline, toBaseline(analyze(root)));
  assert.equal(resolved.added.length, 0);
  assert.equal(resolved.resolved.filter((entry) => entry.rule === rule).length, 3);
});

test("tracks destructured aliases and namespace references", (t) => {
  const root = fixture(t, {
    "src/app/controller.ts": 'const { spawnChild: launch } = child;\nlaunch(id);\nchild.spawnChild(other);',
  });
  assert.equal(collectLocalProviderReferences(root).length, 4);
});

test("does not count shadowed aliases or unrelated properties as local execution", (t) => {
  const root = fixture(t, {
    "src/app/controller.ts": `import { spawnChild as launch } from "runtime";
launch(id);
function preview(launch) { launch(); }
const text = { launch: "preview" };
text.launch;`,
  });
  assert.equal(collectLocalProviderReferences(root).length, 3);
});

test("tracks value aliases and catches additional calls through them", (t) => {
  const file = "src/app/controller.ts";
  const source = `import * as child from "runtime";
const start = child.spawnChild;
const launch = start;
launch(id);`;
  const root = fixture(t, { [file]: source });
  const baseline = toBaseline(analyze(root));
  write(root, file, `${source}\nlaunch(otherId);`);
  const { added } = compareBaseline(baseline, toBaseline(analyze(root)));
  assert.equal(added.length, 1);
  assert.equal(added[0].rule, rule);
});

test("recognizes escaped literals and constant computed names", (t) => {
  const root = fixture(t, {
    "src/app/controller.ts": String.raw`invoke("harness_\u0073pawn");
invoke("harness_" + "spawn");
child["spawn" + "Child"]();`,
  });
  assert.equal(collectLocalProviderReferences(root).length, 3);
});

test("test-looking product filenames are still checked", (t) => {
  const root = fixture(t, {
    "src/features/chat/testHelpers.ts": "spawnChild();",
    "src/app/controller.test-support.ts": "spawnChild();",
  });
  assert.equal(collectLocalProviderReferences(root).length, 2);
});

test("preserves dependency and cycle checks alongside execution references", (t) => {
  const root = fixture(t, {
    "src/features/chat/model.ts": 'import "../../app/controller";\nspawnChild(id);',
    "src/app/controller.ts": 'import "../features/chat/model";',
  });
  const baseline = toBaseline(analyze(root));
  assert.deepEqual(baseline.rules["features-to-app"], ["src/features/chat/model.ts -> src/app/controller.ts"]);
  assert.deepEqual(baseline.cycleFiles, ["src/app/controller.ts", "src/features/chat/model.ts"]);
  assert.equal(baseline.rules[rule].length, 1);
});
