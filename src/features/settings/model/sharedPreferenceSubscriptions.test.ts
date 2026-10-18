// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { loadArchivedProjects, loadRecents, subscribeArchivedProjects, subscribeProjectPathsChanged } from "../../projects/model/recents";
import { loadPinnedSessionsCollapsed, loadSessionFolders, subscribeSessionFolders } from "../../sessions/model/sessionFolders";

beforeEach(() => localStorage.clear());
const changed = (key: string) => window.dispatchEvent(new StorageEvent("storage", { key }));

it("refreshes project and archive observers when Host preferences arrive", () => {
  const projects = vi.fn(() => loadRecents());
  const archived = vi.fn(() => loadArchivedProjects());
  const stopProjects = subscribeProjectPathsChanged(projects);
  const stopArchived = subscribeArchivedProjects(archived);
  localStorage.setItem("omnicode.recentProjects", JSON.stringify([{ path: "/remote-project", openedAt: 8 }]));
  changed("omnicode.recentProjects");
  expect(projects).toHaveLastReturnedWith([{ path: "/remote-project", openedAt: 8 }]);
  expect(archived).not.toHaveBeenCalled();
  localStorage.setItem("omnicode.archivedProjects", JSON.stringify([{ path: "/archived", archivedAt: 9 }]));
  changed("omnicode.archivedProjects");
  expect(archived).toHaveLastReturnedWith([{ path: "/archived", archivedAt: 9 }]);
  stopProjects(); stopArchived();
  projects.mockClear(); archived.mockClear();
  changed("omnicode.archivedProjects");
  expect(projects).not.toHaveBeenCalled();
  expect(archived).not.toHaveBeenCalled();
});

it("refreshes folders and pinned disclosure state without responding to unrelated settings", () => {
  const read = vi.fn(() => ({ folders: loadSessionFolders("/project"), collapsed: loadPinnedSessionsCollapsed("/project") }));
  const stop = subscribeSessionFolders("/project", read);
  localStorage.setItem("omnicode.sessionFolders", JSON.stringify({ "/project": [{ id: "folder", name: "Saved", sessionIds: ["session"], collapsed: true }] }));
  changed("omnicode.sessionFolders");
  expect(read.mock.results.at(-1)?.value.folders[0].name).toBe("Saved");
  localStorage.setItem("omnicode.pinnedSessionsCollapsed", JSON.stringify({ "/project": true }));
  changed("omnicode.pinnedSessionsCollapsed");
  expect(read.mock.results.at(-1)?.value.collapsed).toBe(true);
  read.mockClear();
  changed("omnicode.colorScheme");
  expect(read).not.toHaveBeenCalled();
  stop();
  changed("omnicode.sessionFolders");
  expect(read).not.toHaveBeenCalled();
});
