import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HostStore } from "./store";

it("migrates existing project identities and scopes identical paths by execution machine", () => {
  const directory = mkdtempSync(join(tmpdir(), "monocode-machines-"));
  const file = join(directory, "host.db");
  let store: HostStore | undefined;
  try {
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE projects(id TEXT PRIMARY KEY, cwd TEXT NOT NULL UNIQUE, name TEXT NOT NULL); INSERT INTO projects VALUES ('old', '/repo', 'Repo')");
    old.close();
    store = new HostStore(file);
    const ubuntu = store.addProject("/repo", "Ubuntu", undefined, { kind: "wsl", distribution: "Ubuntu" });
    const debian = store.addProject("/repo", "Debian", undefined, { kind: "wsl", distribution: "Debian" });
    expect(store.addProject("/repo", "same").id).toBe("old");
    expect(store.addProject("/repo", "same", undefined, ubuntu.machine).id).toBe(ubuntu.id);
    expect(new Set(store.projects().map(project => project.id)).size).toBe(3);
    expect(debian.id).not.toBe(ubuntu.id);
    expect(store.db.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
    expect(store.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    store.close(); store = new HostStore(file);
    expect(store.project(ubuntu.id).machine).toEqual({ kind: "wsl", distribution: "Ubuntu" });
    expect(store.project("old").machine).toBeUndefined();
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
