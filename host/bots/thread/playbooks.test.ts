import { expect, it } from "vitest";
import {
  assignedPlaybookPrompt,
  formatPlaybook,
  matchPlaybook,
  parsePlaybook,
  playbookName,
  type Playbook,
} from "./playbooks";

const release: Playbook = {
  name: "mobile-release",
  description: "发布手机端 APK 到局域网时使用",
  updated: "2026-10-09",
  verified: "2026-10-09",
  body: "1. 跑 npm run mobile:publish\n2. 确认更新源版本号",
};

it("round-trips the SKILL.md-style document", () => {
  expect(parsePlaybook("mobile-release", formatPlaybook(release))).toEqual(release);
  expect(() => playbookName("Mobile Release")).toThrow("lowercase");
});

it("assigns one or an ordered deduplicated list without unrelated procedures", () => {
  const other = { ...release, name: "verify-release", body: "Check the installed version" };
  const unused = { ...release, name: "unrelated", body: "Private unrelated procedure" };
  const playbooks = [release, other, unused];
  const single = assignedPlaybookPrompt("Ship it", release.name, playbooks);
  expect(single).toContain("Ship it\n\n## Assigned playbooks");
  expect(single).toContain(release.description);
  expect(single).toContain(release.body);
  expect(single).not.toContain(other.body);
  expect(single).not.toContain(unused.body);
  const many = assignedPlaybookPrompt("Ship it", [other.name, release.name, other.name], playbooks);
  expect(many.indexOf(other.body)).toBeLessThan(many.indexOf(release.body));
  expect(many.split(other.body)).toHaveLength(2);
  expect(assignedPlaybookPrompt("Unchanged", [], playbooks)).toBe("Unchanged");
});

it("rejects invalid or missing assignments and never truncates oversized procedures", () => {
  for (const selection of [null, {}, 1, "", [null], ["Mobile Release"], Array(51).fill(release.name)])
    expect(() => assignedPlaybookPrompt("Task", selection, [release])).toThrow();
  expect(() => assignedPlaybookPrompt("Task", [release.name, "missing"], [release])).toThrow("missing");
  expect(() => assignedPlaybookPrompt(undefined, release.name, [release])).toThrow("message");
  expect(() => assignedPlaybookPrompt("a".repeat(256_000), release.name, [release])).toThrow("too long");
  const large = { ...release, body: "完整流程".repeat(6_000) };
  expect(assignedPlaybookPrompt("Task", release.name, [large])).toContain(large.body);
});

it("pulls in a playbook only when the input clearly matches it", () => {
  const other: Playbook = {
    ...release,
    name: "weekly-report",
    description: "每周五整理项目周报时使用",
  };
  expect(matchPlaybook([other, release], "帮我把手机端发布一下")?.name).toBe(
    "mobile-release",
  );
  expect(matchPlaybook([other, release], "手机没电了")).toBeUndefined();
});
