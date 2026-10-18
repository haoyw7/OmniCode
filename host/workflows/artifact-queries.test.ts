import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { InMemoryJournalStore } from "../../src/integrations/workflow/dynamic-workflow/index.js";
import { readArtifactBytes } from "./artifact-queries";
import { FileArtifactStore } from "./node-ports";

it("returns the actual stored path for the requested version under a custom data directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-artifact-path-"));
  try {
    const store = new FileArtifactStore(join(directory, "custom-artifacts"));
    const journal = new InMemoryJournalStore();
    journal.createRun({ runId: "run", status: "running", caps: {}, spentTokens: 0 });
    const paths: string[] = [];
    for (const version of [1, 2]) {
      const stored = await store.writeToolResultArtifact({ sessionId: "parent", toolCallId: `publish-${version}`,
        toolName: "CreateWorkflow", retention: "project", content: `Report ${version}`, contentType: "text/markdown" });
      paths.push(stored.path!);
      journal.putNode({ runId: "run", siteId: "publish", ordinal: version, kind: "artifact", artifactId: "report",
        inputHash: "hash", status: "completed", result: { id: "report", kind: "markdown", version, uri: stored.uri } });
    }
    const first = await readArtifactBytes(store, journal, "run", "report", 1, 0, 512);
    const latest = await readArtifactBytes(store, journal, "run", "report", undefined, 0, 512);
    expect(first.storedPath).toBe(paths[0]);
    expect(latest.storedPath).toBe(paths[1]);
    expect(await readFile(first.storedPath, "utf8")).toBe(Buffer.from(first.dataBase64, "base64").toString());
    expect(await readFile(latest.storedPath, "utf8")).toBe("Report 2");
    expect(await store.read("omnicode-artifact://parent/../../outside")).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
