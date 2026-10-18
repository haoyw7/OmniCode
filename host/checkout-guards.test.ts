import { HostResourceGuard } from "./bots/resources";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  assertCheckoutAvailable,
  checkoutPath,
  claimCheckoutResource,
  claimCheckoutWrite,
  initCheckoutGuards,
  waitForProviderDrain,
  withCheckoutRemoval,
  withCheckoutIntegration,
} from "./checkout-guards";
import { HostStore } from "./store";
import conformance from "./checkout-guards.conformance.json";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "monocode-checkout-guard-"));
  const path = join(root, "tree");
  mkdirSync(path);
  const database = join(root, "host.db");
  const store = new HostStore(database);
  initCheckoutGuards(store);
  cleanups.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, path, database, store };
}

it("blocks overlapping native editor/process rows until explicit release and respects path boundaries", async () => {
  const f = setup();
  const release = claimCheckoutResource(
    f.store,
    "editor",
    join(f.path, "src/missing.txt"),
  );
  await expect(
    withCheckoutRemoval(f.store, f.path, async () => true),
  ).rejects.toThrow("Close files and terminals");
  expect(
    await withCheckoutRemoval(f.store, `${f.path}-sibling`, async () => true),
  ).toBe(true);
  release();
  expect(await withCheckoutRemoval(f.store, f.path, async () => true)).toBe(
    true,
  );
});

it("reserves removal across asynchronous work without holding a SQLite write transaction", async () => {
  const f = setup();
  const native = new DatabaseSync(f.database);
  cleanups.push(() => native.close());
  await withCheckoutRemoval(f.store, f.path, async () => {
    await Promise.resolve();
    expect(() =>
      claimCheckoutResource(f.store, "new-process", join(f.path, "nested")),
    ).toThrow("being removed");
    expect(() => assertCheckoutAvailable(f.store, f.path)).toThrow(
      "being removed",
    );
    // A native writer can still use SQLite while the reservation spans Git.
    native.exec(
      "PRAGMA busy_timeout=0; CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('available');",
    );
    const row = native
      .prepare("SELECT * FROM checkout_resources WHERE kind='removing'")
      .get();
    expect(row?.path).toBe(checkoutPath(f.path));
    expect(row?.owner_pid).toBe(process.pid);
  });
  expect(() => assertCheckoutAvailable(f.store, f.path)).not.toThrow();
  expect(f.store.db.prepare("SELECT * FROM checkout_resources").all()).toEqual(
    [],
  );
});

it("recovers dead owners, keeps live reservations and releases removal after failures", async () => {
  const f = setup();
  f.store.db
    .prepare("INSERT INTO checkout_resources VALUES ('dead', ?, 'resource', 0)")
    .run(checkoutPath(f.path));
  await expect(
    withCheckoutRemoval(f.store, f.path, async () => {
      throw new Error("Git failed");
    }),
  ).rejects.toThrow("Git failed");
  expect(f.store.db.prepare("SELECT * FROM checkout_resources").all()).toEqual(
    [],
  );
  f.store.db
    .prepare(
      "INSERT INTO checkout_resources VALUES ('native', ?, 'resource', ?)",
    )
    .run(checkoutPath(f.path), process.pid);
  await expect(
    withCheckoutRemoval(f.store, f.path, async () => true),
  ).rejects.toThrow("Close files and terminals");
});

it("allows mounted buffers while excluding active saves from integration without holding a DB lock", async () => {
  const f = setup();
  const editor = claimCheckoutResource(
    f.store,
    "editor:mounted",
    join(f.path, "a.txt"),
  );
  const writing = claimCheckoutWrite(
    f.store,
    "write:active",
    join(f.path, "a.txt"),
  );
  await expect(
    withCheckoutIntegration(f.store, [f.path], async () => true),
  ).rejects.toThrow("being changed");
  writing();
  await withCheckoutIntegration(f.store, [f.path], async () => {
    expect(() =>
      claimCheckoutWrite(f.store, "write:new", join(f.path, "a.txt")),
    ).toThrow("receiving an accepted result");
    const anotherBuffer = claimCheckoutResource(
      f.store,
      "editor:opened",
      join(f.path, "b.txt"),
    );
    const unrelated = claimCheckoutWrite(
      f.store,
      "write:sibling",
      `${f.path}-sibling`,
    );
    const native = new DatabaseSync(f.database);
    try {
      native.exec(
        "PRAGMA busy_timeout=0; CREATE TABLE integration_unrelated (value TEXT)",
      );
    } finally {
      native.close();
      unrelated();
      anotherBuffer();
    }
    await expect(
      withCheckoutIntegration(f.store, [f.path], async () => true),
    ).rejects.toThrow("being changed");
  });
  const saved = claimCheckoutWrite(
    f.store,
    "write:after",
    join(f.path, "a.txt"),
  );
  saved();
  editor();
  expect(f.store.db.prepare("SELECT * FROM checkout_resources").all()).toEqual(
    [],
  );
});

it("transfers a prelaunch reservation to a provider process and releases the exact generation", async () => {
  const f = setup();
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], {
    stdio: "ignore",
  });
  cleanups.push(() => {
    child.kill();
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const release = claimCheckoutResource(f.store, "provider-generation", f.path);
  release.transfer(child.pid!);
  expect(
    f.store.db.prepare("SELECT owner_pid FROM checkout_resources").get()
      ?.owner_pid,
  ).toBe(child.pid);
  await expect(
    withCheckoutRemoval(f.store, f.path, async () => true),
  ).rejects.toThrow("Close files and terminals");
  release();
  expect(f.store.db.prepare("SELECT * FROM checkout_resources").all()).toEqual(
    [],
  );
});

it("waits for retained provider drain while leaving editor buffers available for later cleanup checks", async () => {
  const f = setup();
  const editor = claimCheckoutResource(f.store, "editor:unsaved", f.path);
  await expect(
    waitForProviderDrain(f.store, f.path, 20),
  ).resolves.toBeUndefined();
  const provider = claimCheckoutResource(
    f.store,
    "host-guard:retained",
    f.path,
  );
  await expect(waitForProviderDrain(f.store, f.path, 20)).rejects.toThrow(
    "still stopping",
  );
  const draining = waitForProviderDrain(f.store, f.path, 1000);
  setTimeout(provider, 10);
  await expect(draining).resolves.toBeUndefined();
  await expect(
    withCheckoutRemoval(f.store, f.path, async () => true),
  ).rejects.toThrow("Close files and terminals");
  editor();
});

it.skipIf(process.platform === "win32")(
  "retains a process-group reservation when its leader exited but a descendant still runs",
  async () => {
    const f = setup();
    const leader = spawn(
      process.execPath,
      [
        "-e",
        "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'}); c.unref();",
      ],
      { detached: true, stdio: "ignore" },
    );
    await new Promise<void>((resolve, reject) => {
      leader.once("spawn", resolve);
      leader.once("error", reject);
    });
    cleanups.push(() => {
      try {
        process.kill(-leader.pid!, "SIGKILL");
      } catch {
        /* exited */
      }
    });
    const release = claimCheckoutResource(f.store, "process-group", f.path);
    release.transfer(leader.pid!);
    await new Promise<void>((resolve) => leader.once("exit", () => resolve()));
    expect(() => process.kill(leader.pid!, 0)).toThrow();
    await expect(
      withCheckoutRemoval(f.store, f.path, async () => true),
    ).rejects.toThrow("Close files and terminals");
    release();
  },
);

// The desktop replays the same file in src-tauri/src/local_host.rs.
it.each(conformance.cases)("shares the desktop rule: $name", async ({ rows, request, allowed }) => {
  const f = setup();
  rows.forEach((row, index) =>
    f.store.db
      .prepare("INSERT INTO checkout_resources VALUES (?, ?, ?, ?)")
      .run(`row:${index}`, checkoutPath(join(f.root, row.path)), row.kind,
        row.owner === "live" ? process.pid : 0));
  const path = join(f.root, request.path);
  const claim = async () => {
    if (request.kind === "resource") claimCheckoutResource(f.store, "request", path)();
    else if (request.kind === "writing") claimCheckoutWrite(f.store, "request", path)();
    else if (request.kind === "executing") { const guard = new HostResourceGuard(f.store); if (!guard.acquire("test", { paths: [path] }).acquired) throw new Error("busy"); guard.close(); }
    else if (request.kind === "integrating") await withCheckoutIntegration(f.store, [path], async () => {});
    else await withCheckoutRemoval(f.store, path, async () => {});
  };
  if (allowed) await expect(claim()).resolves.toBeUndefined();
  else await expect(claim()).rejects.toThrow();
});
