import { describe, expect, it } from "vitest";
import {
  newAppViewWorkspaceTab,
  newTab,
} from "../../features/workspace/model/layout";
import { contentTabTarget } from "./appViewNavigation";

describe("app-view document destination", () => {
  const settings = newAppViewWorkspaceTab("settings");
  const search = newAppViewWorkspaceTab("search");
  const first = newTab("a");
  const recent = newTab("b");
  const other = newTab("c");
  const sessions = [
    { id: "a", cwd: "/repo" },
    { id: "b", cwd: "/repo" },
    { id: "c", cwd: "/other" },
  ];
  const tabs = [first, recent, other, settings, search];

  it("opens from app-only tabs into the project's last visited tab", () => {
    expect(
      contentTabTarget(tabs, sessions, settings.id, "/repo", [
        first.id,
        recent.id,
        other.id,
        search.id,
      ]),
    ).toBe(recent);
  });

  it("skips closed and foreign tabs and falls back within the project", () => {
    expect(
      contentTabTarget(tabs, sessions, search.id, "/repo", [
        "closed",
        other.id,
      ]),
    ).toBe(first);
    expect(
      contentTabTarget(tabs, sessions, search.id, "/missing", []),
    ).toBeUndefined();
  });

  it("keeps the current document/chat destination", () => {
    expect(
      contentTabTarget(tabs, sessions, first.id, "/repo", [recent.id]),
    ).toBe(first);
  });
});
