import { queryClient } from "../../../../shared/lib/queryClient";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsEntry } from "../../../../platform/tauri/fs";
import {
  forgetDir,
  listCachedDir,
  notifyDirsChanged,
  peekDir,
  refreshCachedDirs,
  refreshDir,
  subscribeDirsChanged,
} from "./fileTree";

const root = "/tmp/empty-project";

function entry(name: string): FsEntry {
  return {
    name,
    path: `${root}/${name}`,
    isDir: false,
    ignored: false,
  };
}

const listDir = vi.fn<(path: string) => Promise<FsEntry[]>>();

vi.mock("../../../../platform/tauri/fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../platform/tauri/fs")>();
  return {
    ...actual,
    listDir: (path: string) => listDir(path),
  };
});

describe("fileTree cache", () => {
  beforeEach(() => {
    queryClient.clear();
    forgetDir(root);
    listDir.mockReset();
  });

  afterEach(() => {
    queryClient.clear();
    vi.useRealTimers();
  });

  it("keeps the first listing until refreshDir", async () => {
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    expect(peekDir(root)).toEqual([]);

    listDir.mockResolvedValueOnce([entry("hello.ts")]);
    expect(await listCachedDir(root)).toEqual([]);
    expect(listDir).toHaveBeenCalledTimes(1);

    expect(await refreshDir(root)).toEqual([entry("hello.ts")]);
    expect(peekDir(root)).toEqual([entry("hello.ts")]);
  });

  it("refreshCachedDirs re-lists every cached folder", async () => {
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);
    listDir.mockResolvedValueOnce([entry("created.ts")]);
    await refreshCachedDirs();
    expect(peekDir(root)).toEqual([entry("created.ts")]);
  });

  it("notifyDirsChanged refreshes the cache and tells listeners", async () => {
    vi.useFakeTimers();
    listDir.mockResolvedValueOnce([]);
    await listCachedDir(root);

    const onChange = vi.fn();
    const stop = subscribeDirsChanged(onChange);
    listDir.mockResolvedValueOnce([entry("from-agent.ts")]);
    notifyDirsChanged();
    expect(peekDir(root)).toEqual([]);

    await vi.runAllTimersAsync();
    expect(peekDir(root)).toEqual([entry("from-agent.ts")]);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });
});

it("shares simultaneous directory reads and rejects an old answer after a watcher refresh", async () => {
  queryClient.clear();
  let finish!: (entries: FsEntry[]) => void;
  listDir.mockReset().mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const first = listCachedDir(root).catch(() => undefined);
  const second = listCachedDir(root).catch(() => undefined);
  expect(listDir).toHaveBeenCalledTimes(1);
  listDir.mockResolvedValueOnce([entry("new.ts")]);
  await refreshDir(root);
  finish([entry("old.ts")]);
  await Promise.all([first, second]);
  expect(peekDir(root)).toEqual([entry("new.ts")]);
  queryClient.clear();
});

it("forgets a pending directory read when its folder is removed", async () => {
  queryClient.clear();
  let finish!: (entries: FsEntry[]) => void;
  listDir.mockReset().mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const read = listCachedDir(root).catch(() => undefined);
  forgetDir(root);
  finish([entry("deleted.ts")]);
  await read;
  expect(peekDir(root)).toBeNull();
});
