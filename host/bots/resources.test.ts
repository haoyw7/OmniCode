import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import { checkoutExecutionPrefix, checkoutPath, claimCheckoutResource, claimCheckoutWrite, notifyCheckoutRelease, withCheckoutIntegration, withCheckoutOwner, withCheckoutRemoval } from "../checkout-guards";
import { HostResourceGuard, HostResourceWaiter, withHostResources } from "./resources";
import { WslMachineIO, withMachineIO } from "../machine-io";
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.useRealTimers(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bot-resources-")), path = join(root, "project"); mkdirSync(path);
  const store = new HostStore(join(root, "host.db")), guard = new HostResourceGuard(store);
  cleanups.push(() => { guard.close(); store.close(); rmSync(root, { force: true, recursive: true }); });
  return { root, path, store, guard };
}
it("retries each waiting checkout in its original machine after another machine releases a resource", async () => {
  const f = fixture(), waiter = new HostResourceWaiter(f.store); cleanups.push(() => waiter.close());
  const transport = { request: async <T>(): Promise<T> => { throw new Error("No filesystem call expected"); } };
  const ubuntu = new WslMachineIO("Ubuntu", transport), debian = new WslMachineIO("Debian", transport);
  f.store.db.prepare("INSERT INTO checkout_resources VALUES ('other-process', ?, 'integrating', ?)").run("wsl%3AUbuntu:/repo", process.pid);
  const pending = withMachineIO(ubuntu, () => waiter.wait(f.guard, "ubuntu", { paths: ["/repo"] }, new AbortController().signal, () => {}));
  withMachineIO(debian, () => {
    f.store.db.prepare("DELETE FROM checkout_resources WHERE id='other-process'").run();
    notifyCheckoutRelease(f.store);
  });
  await pending;
  expect(f.store.db.prepare("SELECT path FROM checkout_resources").all()).toEqual([{ path: "wsl%3AUbuntu:/repo" }]);
});
it("shares parent and child workspaces with terminals and writes, but acquires computer access atomically", () => {
  const f = fixture(), other = new HostResourceGuard(f.store);
  const terminal = claimCheckoutWrite(f.store, "native:terminal", f.path);
  expect(f.guard.acquire("a", { workingDirectory: f.path, computer: true }).acquired).toBe(true);
  expect(other.acquire("b", { workingDirectory: join(f.path, "child") }).acquired).toBe(true);
  expect(other.acquire("c", { workingDirectory: f.root, computer: true })).toMatchObject({ acquired: false, blockers: [{ kind: "computer", ownerPid: process.pid }] });
  expect(f.store.db.prepare("SELECT * FROM checkout_resources WHERE path=?").all(checkoutPath(f.root))).toEqual([]);
  f.guard.close();
  expect(other.acquire("c", { workingDirectory: f.root, computer: true }).acquired).toBe(true);
  other.close(); terminal();
});
it("never lets shared use bypass integration or removal, including symlink aliases", async () => {
  const f = fixture();
  const alias = join(f.root, "alias"); symlinkSync(f.path, alias, process.platform === "win32" ? "junction" : "dir");
  await withCheckoutIntegration(f.store, [f.path], async () => {
    expect(f.guard.acquire("blocked", { workingDirectory: join(alias, "child") })).toMatchObject({ acquired: false, blockers: [{ kind: "integrating", path: checkoutPath(f.path) }] });
    expect(f.guard.acquire("other", { workingDirectory: `${f.path}-2` }).acquired).toBe(true);
    expect(() => claimCheckoutWrite(f.store, "write", f.path)).toThrow();
  });
  await withCheckoutRemoval(f.store, f.path, async () => {
    expect(f.guard.acquire("blocked", { workingDirectory: f.path })).toMatchObject({ acquired: false, blockers: [{ kind: "removing" }] });
  });
});
it("releases only its claims and preserves foreign execution against integration", async () => {
  const f = fixture(), other = new HostResourceGuard(f.store);
  f.guard.acquire("same", { paths: [f.path] }); other.acquire("same", { paths: [f.path] });
  await expect(withHostResources(f.store, "same", { paths: [f.path] }, async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  expect(f.store.db.prepare("SELECT * FROM checkout_resources").all()).toHaveLength(2);
  other.close();
  await withCheckoutOwner(f.store, "same", () => withCheckoutIntegration(f.store, [f.path], async () => {}));
  const id = `${checkoutExecutionPrefix("same")}foreign`;
  f.store.db.prepare("INSERT INTO checkout_resources VALUES (?, ?, 'executing', ?)").run(id, checkoutPath(f.path), process.ppid);
  await expect(withCheckoutOwner(f.store, "same", () => withCheckoutIntegration(f.store, [f.path], async () => {}))).rejects.toThrow();
  f.guard.close();
  expect(f.store.db.prepare("SELECT id FROM checkout_resources").all()).toEqual([{ id }]);
});
it("cleans dead owners but keeps mounted resources protecting removal", async () => {
  const f = fixture();
  f.store.db.prepare("INSERT INTO checkout_resources VALUES ('dead', ?, 'integrating', 0)").run(checkoutPath(f.path));
  const mounted = claimCheckoutResource(f.store, "buffer", f.path);
  expect(f.guard.acquire("run", { paths: [f.path] }).acquired).toBe(true);
  f.guard.close();
  await expect(withCheckoutRemoval(f.store, f.path, async () => {})).rejects.toThrow();
  mounted();
  await withCheckoutRemoval(f.store, f.path, async () => {});
});
it("wakes on local release, aborts promptly, and never acquires after cancellation", async () => {
  const f = fixture(), waiter = new HostResourceWaiter(f.store); cleanups.push(() => waiter.close());
  let unblock!: () => void;
  const integration = withCheckoutIntegration(f.store, [f.path], () => new Promise<void>(r => { unblock = r; }));
  const aborted = new AbortController(), blocked = vi.fn();
  const wait = waiter.wait(f.guard, "cancelled", { paths: [f.path] }, aborted.signal, blocked);
  expect(blocked).toHaveBeenCalledWith([expect.objectContaining({ kind: "integrating" })]);
  aborted.abort(); await expect(wait).rejects.toThrow("cancelled");
  const next = waiter.wait(f.guard, "next", { paths: [f.path] }, new AbortController().signal, () => {});
  unblock(); await integration; await next;
  expect(f.store.db.prepare("SELECT id FROM checkout_resources").all()).toEqual([{ id: expect.stringContaining(checkoutExecutionPrefix("next")) }]);
});
it("uses one fallback poll and times out without stealing or later replaying", async () => {
  vi.useFakeTimers();
  const f = fixture(), waiter = new HostResourceWaiter(f.store); cleanups.push(() => waiter.close());
  f.store.db.prepare("INSERT INTO checkout_resources VALUES ('foreign', ?, 'integrating', ?)").run(checkoutPath(f.path), process.pid);
  const wait = waiter.wait(f.guard, "timeout", { paths: [f.path] }, new AbortController().signal, () => {});
  const failed = expect(wait).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
  await vi.advanceTimersByTimeAsync(30_000); await failed;
  expect(f.store.db.prepare("SELECT id FROM checkout_resources").all()).toEqual([{ id: "foreign" }]);
  f.store.db.prepare("DELETE FROM checkout_resources").run();
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.store.db.prepare("SELECT id FROM checkout_resources").all()).toEqual([]);
});
it("notices a release by another process with a single shared fallback timer", async () => {
  vi.useFakeTimers();
  const f = fixture(), waiter = new HostResourceWaiter(f.store); cleanups.push(() => waiter.close());
  f.store.db.prepare("INSERT INTO checkout_resources VALUES ('foreign', ?, 'integrating', ?)").run(checkoutPath(f.path), process.pid);
  const other = new HostResourceGuard(f.store); cleanups.push(() => other.close());
  const one = waiter.wait(f.guard, "one", { paths: [f.path] }, new AbortController().signal, () => {});
  const two = waiter.wait(other, "two", { paths: [f.path] }, new AbortController().signal, () => {});
  expect(vi.getTimerCount()).toBe(1);
  f.store.db.prepare("DELETE FROM checkout_resources WHERE id='foreign'").run();
  await vi.advanceTimersByTimeAsync(1000); await Promise.all([one, two]);
  expect(vi.getTimerCount()).toBe(0);
  expect(f.store.db.prepare("SELECT * FROM checkout_resources").all()).toHaveLength(2);
});
