import { describe, expect, it } from "vitest";
import type { Skill } from "../features/skills/model/skillTypes";
import { insertMobileSkill } from "./skillCommands";
const review: Skill = {
  kind: "file",
  name: "review",
  invocation: "review",
  path: "/skills/review/SKILL.md",
  scope: "project",
  source: "agents",
  description: "Review",
};
describe("mobile skill insertion", () => {
  it("replaces the current slash token without losing the text after the caret", () => {
    expect(insertMobileSkill("Before /rev later", 11, 11, review)).toEqual({
      text: "Before /review later",
      cursor: 15,
    });
  });
  it("inserts a command at a selection and preserves surrounding whitespace", () => {
    expect(insertMobileSkill("Before OLD after", 7, 10, review)).toEqual({
      text: "Before /review after",
      cursor: 15,
    });
    expect(insertMobileSkill("Hello", 5, 5, review)).toEqual({
      text: "Hello /review ",
      cursor: 14,
    });
  });
  it("keeps native namespaces exact and does not replace URLs, paths or quoted slash tokens", () => {
    const native: Skill = {
      kind: "native",
      name: "review",
      invocation: "skill:review",
      source: "pi",
      description: "Native",
    };
    expect(insertMobileSkill("/r @raw", 2, 2, native)).toEqual({
      text: "/skill:review @raw",
      cursor: 14,
    });
    const quoted = insertMobileSkill("> /review quoted", 9, 9, review);
    expect(quoted.text).toContain("> /review");
    expect(insertMobileSkill("/tmp/file", 9, 9, review).text).toBe(
      "/tmp/file /review ",
    );
  });
});
