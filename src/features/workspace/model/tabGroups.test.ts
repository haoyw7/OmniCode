import { beforeEach, describe, expect, it } from "vitest";
import {
  addTabToGroup,
  addTabsToNewGroup,
  applyGroupedReorder,
  canJoinTabGroup,
  canJoinTabOnto,
  insertTabBesideActive,
  insertTabInGroup,
  joinTabOnto,
  removeTabFromGroup,
  loadTabGroupColors,
  loadTabGroupLabels,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupLogo,
  saveTabGroupColor,
  saveTabGroupLabel,
  sharedGroupProject,
  ungroupTabs,
} from "./tabGroups";
import { projectKey, projectName } from "../../../shared/lib/paths";

type Tab = { id: string; project: string; groupId?: string };

function tab(id: string, project: string, groupId?: string): Tab {
  return { id, project, ...(groupId ? { groupId } : {}) };
}

/** Projects live on the title tab, so callers pass this lookup explicitly. */
function projectOf(tabs: Tab[]) {
  return (id: string) => tabs.find((entry) => entry.id === id)?.project;
}

describe("sharedGroupProject", () => {
  it("returns the project when every tab matches", () => {
    expect(sharedGroupProject([tab("a", "foo"), tab("b", "foo")])).toBe("foo");
  });

  it("returns null for mixed or missing projects", () => {
    expect(sharedGroupProject([tab("a", "foo"), tab("b", "bar")])).toBeNull();
    expect(sharedGroupProject([tab("a", "~")])).toBeNull();
  });
});

describe("applyGroupedReorder", () => {
  it("joins an ungrouped tab dropped between two members of the same group", () => {
    const tabs = [
      tab("a", "foo", "g"),
      tab("b", "foo", "g"),
      tab("c", "bar"),
    ];
    const next = applyGroupedReorder(tabs, ["a", "c", "b"], "c");
    expect(next?.map((entry) => [entry.id, entry.groupId])).toEqual([
      ["a", "g"],
      ["c", "g"],
      ["b", "g"],
    ]);
  });

  it("ungroups a tab dragged out of its group", () => {
    const tabs = [
      tab("a", "foo", "g"),
      tab("b", "foo", "g"),
      tab("c", "bar"),
    ];
    const next = applyGroupedReorder(tabs, ["a", "c", "b"], "b");
    expect(next?.map((entry) => [entry.id, entry.groupId ?? null])).toEqual([
      ["a", "g"],
      ["c", null],
      ["b", null],
    ]);
  });

  it("keeps membership when sliding a grouped tab along its own group", () => {
    const tabs = [
      tab("a", "foo", "g"),
      tab("b", "foo", "g"),
      tab("c", "bar"),
    ];
    const next = applyGroupedReorder(tabs, ["b", "a", "c"], "b");
    expect(next?.map((entry) => [entry.id, entry.groupId])).toEqual([
      ["b", "g"],
      ["a", "g"],
      ["c", undefined],
    ]);
  });

  it("does not auto-join when placed beside a group edge", () => {
    const tabs = [
      tab("a", "foo", "g"),
      tab("b", "foo", "g"),
      tab("c", "bar"),
    ];
    const next = applyGroupedReorder(tabs, ["a", "b", "c"], "c");
    expect(next?.map((entry) => [entry.id, entry.groupId ?? null])).toEqual([
      ["a", "g"],
      ["b", "g"],
      ["c", null],
    ]);
  });
});

describe("joinTabOnto", () => {
  it("creates a group from two ungrouped tabs and places the dragged tab after the target", () => {
    const tabs = [tab("a", "foo"), tab("b", "bar"), tab("c", "baz")];
    const result = joinTabOnto(tabs, "c", "a", () => "g-new");
    expect(result?.created).toBe(true);
    expect(result?.groupId).toBe("g-new");
    expect(result?.tabs.map((entry) => [entry.id, entry.groupId ?? null])).toEqual([
      ["a", "g-new"],
      ["c", "g-new"],
      ["b", null],
    ]);
  });

  it("joins a tab onto an existing group", () => {
    const tabs = [tab("a", "foo", "g"), tab("b", "foo", "g"), tab("c", "bar")];
    const result = joinTabOnto(tabs, "c", "a");
    expect(result?.created).toBe(false);
    expect(result?.tabs.map((entry) => [entry.id, entry.groupId ?? null])).toEqual([
      ["a", "g"],
      ["b", "g"],
      ["c", "g"],
    ]);
  });
});

describe("group membership helpers", () => {
  it("adds a tab to the end of an existing group", () => {
    const tabs = [tab("a", "foo", "g"), tab("b", "bar"), tab("c", "foo", "g")];
    expect(addTabToGroup(tabs, "b", "g").map((entry) => entry.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("creates a one-tab group in place", () => {
    const tabs = [tab("a", "foo"), tab("b", "bar")];
    expect(addTabsToNewGroup(tabs, ["b"], "g").map((entry) => [entry.id, entry.groupId ?? null])).toEqual([
      ["a", null],
      ["b", "g"],
    ]);
  });

  it("clears a group and a single tab's membership", () => {
    const tabs = [tab("a", "foo", "g"), tab("b", "foo", "g"), tab("c", "bar", "g2")];
    expect(ungroupTabs(tabs, "g").map((entry) => entry.groupId ?? null)).toEqual([
      null,
      null,
      "g2",
    ]);
    expect(removeTabFromGroup(tabs, "a")[0].groupId).toBeUndefined();
  });

  it("inserts a new tab beside the active tab and inherits its group", () => {
    const tabs = [tab("a", "foo", "g"), tab("b", "bar")];
    const next = insertTabBesideActive(tabs, tab("n", "foo"), "a");
    expect(next.map((entry) => [entry.id, entry.groupId ?? null])).toEqual([
      ["a", "g"],
      ["n", "g"],
      ["b", null],
    ]);
  });

  it("inserts an ungrouped tab after the active ungrouped tab", () => {
    const tabs = [tab("a", "foo"), tab("b", "bar")];
    const next = insertTabBesideActive(tabs, tab("n", "foo"), "a");
    expect(next.map((entry) => [entry.id, entry.groupId ?? null])).toEqual([
      ["a", null],
      ["n", null],
      ["b", null],
    ]);
  });

  it("inserts into a group after its last member", () => {
    const tabs = [tab("a", "foo", "g"), tab("b", "foo", "g"), tab("c", "bar")];
    const next = insertTabInGroup(tabs, tab("n", "foo"), "g");
    expect(next.map((entry) => entry.id)).toEqual(["a", "b", "n", "c"]);
    expect(next[2].groupId).toBe("g");
  });
});

describe("tab group logos", () => {
  it("resolves logo paths by project key", () => {
    const logos = { foo: "/tmp/foo.png" };
    expect(resolveTabGroupLogo("foo", logos)).toBe("/tmp/foo.png");
    expect(resolveTabGroupLogo("bar", logos)).toBeNull();
  });
});

describe("project-scoped grouping", () => {
  const tabs = [
    tab("a", "foo", "g"),
    tab("b", "foo", "g"),
    tab("c", "bar"),
    tab("d", "foo"),
  ];
  const lookup = projectOf(tabs);

  it("refuses a tab from another project on a tab and on a group", () => {
    expect(canJoinTabOnto(tabs, "c", "a", lookup)).toBe(false);
    expect(canJoinTabOnto(tabs, "c", "d", lookup)).toBe(false);
    expect(canJoinTabGroup(tabs, "c", "g", lookup)).toBe(false);
  });

  it("allows tabs that share a project", () => {
    expect(canJoinTabOnto(tabs, "d", "a", lookup)).toBe(true);
    expect(canJoinTabGroup(tabs, "d", "g", lookup)).toBe(true);
  });

  it("leaves the tabs untouched when a cross-project join is attempted", () => {
    expect(joinTabOnto(tabs, "c", "a", () => "g-new", lookup)).toBeNull();
    expect(addTabToGroup(tabs, "c", "g", lookup)).toBe(tabs);
  });

  it("slides a foreign tab past a group instead of joining or splitting it", () => {
    // Dragged leftwards into the middle of `g`, so it lands before the group.
    const next = applyGroupedReorder(tabs, ["a", "c", "b", "d"], "c", lookup);
    expect(next?.map((entry) => [entry.id, entry.groupId ?? null])).toEqual([
      ["c", null],
      ["a", "g"],
      ["b", "g"],
      ["d", null],
    ]);
  });

  it("slides a foreign tab out on the far side when dragged rightwards", () => {
    const rightward = [
      tab("c", "bar"),
      tab("a", "foo", "g"),
      tab("b", "foo", "g"),
    ];
    const next = applyGroupedReorder(
      rightward,
      ["a", "c", "b"],
      "c",
      projectOf(rightward),
    );
    expect(next?.map((entry) => [entry.id, entry.groupId ?? null])).toEqual([
      ["a", "g"],
      ["b", "g"],
      ["c", null],
    ]);
  });

  it("still joins a group when the dropped tab shares its project", () => {
    const next = applyGroupedReorder(tabs, ["a", "d", "b", "c"], "d", lookup);
    expect(next?.map((entry) => [entry.id, entry.groupId ?? null])).toEqual([
      ["a", "g"],
      ["d", "g"],
      ["b", "g"],
      ["c", null],
    ]);
  });

  it("does not inherit the active tab's group across projects", () => {
    const next = insertTabBesideActive(tabs, tab("n", "bar"), "a", (id) =>
      id === "n" ? "bar" : lookup(id),
    );
    expect(next.map((entry) => [entry.id, entry.groupId ?? null])).toEqual([
      ["a", "g"],
      ["n", null],
      ["b", "g"],
      ["c", null],
      ["d", null],
    ]);
  });
});

function mockLocalStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
    configurable: true,
  });
  return data;
}

const FINANCE = "/Users/me/cortex-finance/agentbase";
const CORTEX = "/Users/me/cortex/agentbase";

describe("project appearance keys", () => {
  beforeEach(() => {
    mockLocalStorage({ "monocode:tab-group:key-version": "2" });
  });

  it("keeps same-named projects in different folders apart", () => {
    // Both checkouts share a folder name — the collision this guards against.
    expect(projectName(FINANCE)).toBe(projectName(CORTEX));
    expect(projectKey(FINANCE)).not.toBe(projectKey(CORTEX));

    saveTabGroupLabel(projectKey(FINANCE), "Finance");
    saveTabGroupColor(projectKey(FINANCE), 3);

    const labels = loadTabGroupLabels();
    expect(resolveTabGroupLabel(projectKey(FINANCE), labels, "agentbase")).toBe(
      "Finance",
    );
    expect(resolveTabGroupLabel(projectKey(CORTEX), labels, "agentbase")).toBe(
      "agentbase",
    );
    expect(loadTabGroupColors()[projectKey(CORTEX)]).toBeUndefined();
  });
});

describe("migrateProjectAppearanceKeys", () => {
  it("moves folder-name entries onto every project that carries the name", () => {
    const store = mockLocalStorage({
      "monocode.recentProjects": JSON.stringify([
        { path: FINANCE, openedAt: 2 },
        { path: CORTEX, openedAt: 1 },
      ]),
      "monocode:tab-group:labels": JSON.stringify({ agentbase: "Agentbase" }),
      "monocode:tab-group:colors": JSON.stringify({ agentbase: "4" }),
    });

    const labels = loadTabGroupLabels();
    expect(labels[projectKey(FINANCE)]).toBe("Agentbase");
    expect(labels[projectKey(CORTEX)]).toBe("Agentbase");
    expect(labels.agentbase).toBeUndefined();
    expect(loadTabGroupColors()[projectKey(CORTEX)]).toBe(4);
    expect(store.get("monocode:tab-group:key-version")).toBe("2");

    // Renaming one afterwards leaves the other alone.
    saveTabGroupLabel(projectKey(CORTEX), "Cortex");
    const after = loadTabGroupLabels();
    expect(after[projectKey(CORTEX)]).toBe("Cortex");
    expect(after[projectKey(FINANCE)]).toBe("Agentbase");
  });

  it("leaves entries for projects it no longer knows about", () => {
    const store = mockLocalStorage({
      "monocode:tab-group:labels": JSON.stringify({ gone: "Gone" }),
    });
    expect(loadTabGroupLabels().gone).toBe("Gone");
    // Unfinished: a later launch must still get the chance to claim it.
    expect(store.get("monocode:tab-group:key-version")).toBeUndefined();
  });

  it("claims an entry once its project is remembered again", () => {
    // Evicted from the 20-slot recents cap, so the first pass cannot match it.
    mockLocalStorage({
      "monocode:tab-group:labels": JSON.stringify({ agentbase: "Finance" }),
    });
    expect(loadTabGroupLabels()[projectKey(FINANCE)]).toBeUndefined();

    // Next launch, with the project reopened.
    mockLocalStorage({
      "monocode.recentProjects": JSON.stringify([{ path: FINANCE, openedAt: 1 }]),
      "monocode:tab-group:labels": JSON.stringify({ agentbase: "Finance" }),
    });
    expect(loadTabGroupLabels()[projectKey(FINANCE)]).toBe("Finance");
  });

  it("keeps Windows checkouts that differ only in case together", () => {
    mockLocalStorage({
      "monocode.recentProjects": JSON.stringify([
        { path: "C:\\Users\\me\\cortex\\Agentbase", openedAt: 1 },
      ]),
      "monocode:tab-group:labels": JSON.stringify({ Agentbase: "Finance" }),
    });
    const labels = loadTabGroupLabels();
    expect(labels[projectKey("C:/Users/me/cortex/agentbase")]).toBe("Finance");
  });
});

describe("resolveTabGroupColor", () => {
  it("falls back to the folder-name hash so existing rails keep their color", () => {
    expect(resolveTabGroupColor(projectKey(FINANCE), {}, {}, "agentbase")).toBe(
      resolveTabGroupColor("agentbase", {}, {}, "agentbase"),
    );
  });
});
