import { expect, it } from "vitest";
import type { StartupProgress } from "../src/integrations/harness/core/startupProgress";
import { reportStartupProgress, sharedStartupProgress, withStartupProgress } from "./startup-progress";
import { npmInstallProgress } from "./npm-install-progress";

it("fans out a shared install, replays the latest progress and removes failed tasks", async () => {
  const first: StartupProgress[] = [], second: StartupProgress[] = [];
  let finish!: () => void;
  const wait = new Promise<void>(done => { finish = done; });
  const install = async () => {
    reportStartupProgress({ stage: "downloading", completed: 10, total: 20, unit: "bytes" });
    await wait;
    reportStartupProgress({ stage: "installing" });
    return 42;
  };
  const a = withStartupProgress(value => first.push(value), () => sharedStartupProgress("fixture", install));
  await Promise.resolve();
  const b = withStartupProgress(value => second.push(value), () => sharedStartupProgress("fixture", async () => { throw new Error("duplicate"); }));
  expect(second).toEqual(first);
  finish();
  expect(await Promise.all([a, b])).toEqual([42, 42]);
  expect(first).toEqual(second);
  await expect(sharedStartupProgress("fixture", async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  expect(await sharedStartupProgress("fixture", async () => "retry")).toBe("retry");
});

it("counts fragmented npm download and reify events without leaking package names", () => {
  const events: StartupProgress[] = [];
  withStartupProgress(value => events.push(value), () => {
    const progress = npmInstallProgress();
    progress("npm http fetch GET 200 https://registry.npmjs.org/private/-/private.t");
    progress("gz 50ms (cache miss)\nnpm timing reifyNode:node_modules/private Com");
    progress("pleted in 55ms\nnpm timing reifyNode:node_modules/private Completed in 55ms\n");
  });
  expect(events.at(-1)).toEqual({ stage: "installing-dependencies", completed: 1, downloaded: 1, unit: "packages" });
  expect(JSON.stringify(events)).not.toContain("private");
});
