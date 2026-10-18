import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveProject,
  forgetProject,
  loadArchivedProjects,
  loadPinnedProjects,
  loadProjectRailOrder,
  loadRecents,
  looksLikeProject,
  projectRailItems,
  projectRailSections,
  rememberImportedProject,
  rememberProject,
  replaceProjectPath,
  savePinnedProjects,
  saveProjectRailOrder,
  syncProjectRailOrder,
} from "./recents";
import {
  loadProjectTreeExpanded,
  saveProjectTreeExpanded,
} from "./projectTree";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("looksLikeProject", () => {
  it("rejects the home directory so it is never indexed", () => {
    // Home arrives expanded from `default_cwd`. Walking it reaches
    // ~/Library, which makes macOS prompt for access to other apps' data.
    expect(looksLikeProject("/Users/me")).toBe(false);
    expect(looksLikeProject("/Users/me/")).toBe(false);
    expect(looksLikeProject("/home/me")).toBe(false);
    expect(looksLikeProject("C:/Users/me")).toBe(false);
    expect(looksLikeProject("C:\\Users\\me")).toBe(false);
    expect(looksLikeProject("~")).toBe(false);
  });

  it("rejects system roots and app bundles", () => {
    expect(looksLikeProject("/")).toBe(false);
    expect(looksLikeProject("")).toBe(false);
    expect(looksLikeProject("C:/")).toBe(false);
    expect(looksLikeProject("C:")).toBe(false);
    expect(looksLikeProject("/Applications/Some.app/Contents")).toBe(false);
  });

  it("accepts real projects, including ones directly under home", () => {
    expect(looksLikeProject("/Users/me/code/app")).toBe(true);
    expect(looksLikeProject("/Users/me/Desktop")).toBe(true);
    expect(looksLikeProject("/tmp/scratch")).toBe(true);
    expect(looksLikeProject("C:/Users/me/code/app")).toBe(true);
  });
});

describe("projectRailSections", () => {
  it("retains the manual order of ordinary projects when one is reopened", () => {
    const recents = [
      { path: "/tmp/older", openedAt: 1 },
      { path: "/tmp/current", openedAt: 2 },
    ];
    const { pinned, projects } = projectRailSections(
      recents,
      "/tmp/current/",
      ["/tmp/older", "/tmp/current"],
      [],
    );
    expect([...pinned, ...projects].map((item) => item.path)).toEqual([
      "/tmp/older",
      "/tmp/current",
    ]);
  });

  it("places pinned projects before unpinned ones", () => {
    const recents = [
      { path: "/tmp/a", openedAt: 1 },
      { path: "/tmp/b", openedAt: 2 },
      { path: "/tmp/c", openedAt: 3 },
    ];
    const { pinned, projects } = projectRailSections(
      recents,
      "/tmp/a",
      ["/tmp/a", "/tmp/b", "/tmp/c"],
      ["/tmp/b"],
    );
    expect(pinned.map((item) => item.path)).toEqual(["/tmp/b"]);
    expect(projects.map((item) => item.path)).toEqual(["/tmp/a", "/tmp/c"]);
  });

  it("retains manual pin order and places a newly opened project first", () => {
    const recents = [
      { path: "/tmp/old-pin", openedAt: 1 },
      { path: "/tmp/new-pin", openedAt: 4 },
      { path: "/tmp/older", openedAt: 2 },
      { path: "/tmp/new", openedAt: 5 },
    ];
    const { pinned, projects } = projectRailSections(
      recents,
      "/tmp/older",
      ["/tmp/old-pin", "/tmp/older", "/tmp/new-pin"],
      ["/tmp/new-pin", "/tmp/old-pin"],
    );
    expect(pinned.map((item) => item.path)).toEqual([
      "/tmp/old-pin",
      "/tmp/new-pin",
    ]);
    expect(projects.map((item) => item.path)).toEqual([
      "/tmp/new",
      "/tmp/older",
    ]);
  });

  it("prepends new projects by recency without reordering existing entries", () => {
    const projects = new Map([
      ["/tmp/older", { path: "/tmp/older", openedAt: 1 }],
      ["/tmp/new", { path: "/tmp/new", openedAt: 3 }],
      ["/tmp/current", { path: "/tmp/current", openedAt: 5 }],
      ["/tmp/newest", { path: "/tmp/newest", openedAt: 4 }],
    ]);
    expect(
      syncProjectRailOrder(["/tmp/older", "/tmp/current"], projects),
    ).toEqual(["/tmp/newest", "/tmp/new", "/tmp/older", "/tmp/current"]);
  });
});

describe("project rail order migration", () => {
  beforeEach(mockLocalStorage);

  it("migrates legacy recency order once while retaining the saved pin order", () => {
    localStorage.setItem(
      "monocode.recentProjects",
      JSON.stringify([
        { path: "/tmp/old-pin", openedAt: 1 },
        { path: "/tmp/new-pin", openedAt: 10 },
        { path: "/tmp/older", openedAt: 2 },
        { path: "/tmp/current", openedAt: 6 },
        { path: "/tmp/unsaved", openedAt: 4 },
      ]),
    );
    localStorage.setItem(
      "monocode.projectRailOrder",
      JSON.stringify([
        "/tmp/older",
        "/tmp/new-pin",
        "/tmp/current",
        "/tmp/old-pin",
        "/tmp/saved-only",
      ]),
    );
    savePinnedProjects(["/tmp/old-pin", "/tmp/new-pin"]);

    const migrated = [
      "/tmp/new-pin",
      "/tmp/old-pin",
      "/tmp/current",
      "/tmp/unsaved",
      "/tmp/older",
      "/tmp/saved-only",
    ];
    expect(loadProjectRailOrder()).toEqual(migrated);
    expect(
      JSON.parse(localStorage.getItem("monocode.projectRailOrder")!),
    ).toEqual(migrated);
    expect(localStorage.getItem("monocode.projectRailOrderVersion")).toBe("1");

    rememberProject("/tmp/older");
    expect(loadProjectRailOrder()).toEqual(migrated);

    const manualOrder = [
      "/tmp/older",
      ...migrated.filter((path) => path !== "/tmp/older"),
    ];
    saveProjectRailOrder(manualOrder);
    expect(loadProjectRailOrder()).toEqual(manualOrder);
  });

  it("treats an explicitly saved order as manual without a legacy migration", () => {
    rememberProject("/tmp/older");
    rememberProject("/tmp/current");

    saveProjectRailOrder(["/tmp/older", "/tmp/current"]);

    expect(loadProjectRailOrder()).toEqual(["/tmp/older", "/tmp/current"]);
    expect(localStorage.getItem("monocode.projectRailOrderVersion")).toBe("1");
  });
});

describe("projectRailItems", () => {
  it("ignores home as a current folder", () => {
    expect(
      projectRailItems([{ path: "/tmp/app", openedAt: 1 }], "/Users/me").map(
        (item) => item.path,
      ),
    ).toEqual(["/tmp/app"]);
  });
});

describe("rememberImportedProject", () => {
  beforeEach(mockLocalStorage);

  it("retains existing project order and visit times across repeated imports", () => {
    rememberProject("/work/a");
    rememberProject("/work/b");
    saveProjectRailOrder(["/work/a", "/work/b"]);
    const previous = loadRecents();
    expect(rememberImportedProject("/work/a/")).toEqual(previous);
    expect(rememberImportedProject("/work/b")).toEqual(previous);
    expect(loadProjectRailOrder()).toEqual(["/work/a", "/work/b"]);
  });

  it("appends imported projects without moving the existing rows, including after reload", () => {
    rememberProject("/work/a");
    rememberProject("/work/b");
    const previousOrder = projectRailItems(loadRecents(), "").map((row) => row.path);
    rememberImportedProject("/work/import-one");
    rememberImportedProject("/work/import-two");
    rememberImportedProject("/work/import-one/");
    expect(projectRailItems(loadRecents(), "").map((row) => row.path)).toEqual([
      ...previousOrder, "/work/import-one", "/work/import-two",
    ]);
    expect(loadRecents().slice(-2)).toEqual([
      { path: "/work/import-one", openedAt: 0 },
      { path: "/work/import-two", openedAt: 0 },
    ]);
  });

  it("does not restore archived projects or add non-project paths", () => {
    rememberProject("/work/archived");
    archiveProject("/work/archived");
    const archived = loadArchivedProjects();
    for (const path of ["/work/archived/", "~", "/", ""])
      expect(rememberImportedProject(path)).toEqual([]);
    expect(loadArchivedProjects()).toEqual(archived);
  });
});

describe("rememberProject retention", () => {
  beforeEach(mockLocalStorage);

  it("keeps more than 20 projects across storage reloads using the existing schema", () => {
    for (let i = 0; i < 25; i++) rememberProject(`/work/project-${i}`);
    expect(loadRecents()).toHaveLength(25);
    expect(loadRecents().at(-1)?.path).toBe("/work/project-0");
    const stored = JSON.parse(localStorage.getItem("monocode.recentProjects")!);
    expect(stored[0]).toEqual({
      path: "/work/project-24",
      openedAt: expect.any(Number),
    });
    rememberProject("/work/project-0/");
    expect(loadRecents()).toHaveLength(25);
    expect(loadRecents()[0].path).toBe("/work/project-0");
    replaceProjectPath("/work/project-1", "/work/renamed");
    archiveProject("/work/project-2");
    forgetProject("/work/project-3");
    expect(loadRecents()).toHaveLength(23);
    expect(loadRecents().some(({ path }) => path === "/work/renamed")).toBe(
      true,
    );
  });
});

describe("forgetProject", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    mockLocalStorage();
  });

  it("drops the recent entry, rail order slot, and pin", () => {
    rememberProject("/tmp/keep");
    rememberProject("/tmp/gone");
    saveProjectRailOrder(["/tmp/keep", "/tmp/gone"]);
    savePinnedProjects(["/tmp/gone"]);
    saveProjectTreeExpanded(["/tmp/gone", "/tmp/keep"]);

    expect(forgetProject("/tmp/gone").map((item) => item.path)).toEqual([
      "/tmp/keep",
    ]);
    expect(loadRecents().map((item) => item.path)).toEqual(["/tmp/keep"]);
    expect(loadProjectRailOrder()).toEqual(["/tmp/keep"]);
    expect(loadPinnedProjects()).toEqual([]);
    expect([...loadProjectTreeExpanded("/tmp/current")]).toEqual(["/tmp/keep"]);
  });

  it("treats differently-cased Windows paths as one project", () => {
    rememberProject("C:/Users/me/Code/App");
    rememberProject("c:/users/ME/code/app");
    expect(loadRecents().map((item) => item.path)).toEqual([
      "c:/users/ME/code/app",
    ]);
  });
});

describe("replaceProjectPath", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  it("keeps rail order and pin state under the renamed path", () => {
    rememberProject("/work/other");
    rememberProject("/work/monocode");
    saveProjectRailOrder(["/work/other", "/work/monocode"]);
    savePinnedProjects(["/work/monocode"]);
    saveProjectTreeExpanded(["/work/monocode"]);

    expect(
      replaceProjectPath("/work/monocode", "/work/monocode-personal").map(
        (item) => item.path,
      ),
    ).toEqual(["/work/monocode-personal", "/work/other"]);
    expect(loadProjectRailOrder()).toEqual([
      "/work/other",
      "/work/monocode-personal",
    ]);
    expect(loadPinnedProjects()).toEqual(["/work/monocode-personal"]);
    expect([...loadProjectTreeExpanded("/work/other")]).toEqual([
      "/work/monocode-personal",
    ]);
  });
});

describe("archiveProject", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    mockLocalStorage();
  });

  it("files the project in the archive and takes it off the rail", () => {
    rememberProject("/tmp/keep");
    rememberProject("/tmp/gone");
    savePinnedProjects(["/tmp/gone"]);
    saveProjectTreeExpanded(["/tmp/gone"]);

    expect(archiveProject("/tmp/gone").map((item) => item.path)).toEqual([
      "/tmp/keep",
    ]);
    expect(loadArchivedProjects().map((item) => item.path)).toEqual([
      "/tmp/gone",
    ]);
    expect(loadPinnedProjects()).toEqual([]);
    expect(loadRecents().map((item) => item.path)).toEqual(["/tmp/keep"]);
    expect([...loadProjectTreeExpanded("/tmp/keep")]).toEqual([]);
  });

  it("opening a project again restores it from the archive", () => {
    rememberProject("/tmp/gone");
    archiveProject("/tmp/gone");
    expect(loadArchivedProjects()).toHaveLength(1);

    rememberProject("/tmp/gone");
    expect(loadArchivedProjects()).toEqual([]);
    expect(loadRecents().map((item) => item.path)).toEqual(["/tmp/gone"]);
  });

  it("delete drops an archived project instead of restoring it", () => {
    rememberProject("/tmp/gone");
    archiveProject("/tmp/gone");
    forgetProject("/tmp/gone");
    expect(loadArchivedProjects()).toEqual([]);
    expect(loadRecents()).toEqual([]);
  });
});
