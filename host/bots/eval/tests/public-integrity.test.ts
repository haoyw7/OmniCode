import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyPublicIntegrity } from "../src/publicIntegrity";

it("rejects added executable files as well as edited locked bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "public-integrity-test-"));
  try {
    for (const path of [
      "public",
      "data/upstream/bfcl-v4-sample",
      "data/upstream/longmemeval-oracle-sample",
    ])
      await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, "public/adapter.py"), "original");
    await writeFile(
      join(root, "public/integrity.json"),
      JSON.stringify({
        files: {
          "public/adapter.py": createHash("sha256")
            .update("original")
            .digest("hex"),
        },
      }),
    );
    expect((await verifyPublicIntegrity(root)).files).toBe(1);
    await writeFile(join(root, "public/extra.py"), "unexpected tool");
    await expect(verifyPublicIntegrity(root)).rejects.toThrow(
      "inventory drift",
    );
    await rm(join(root, "public/extra.py"));
    await writeFile(join(root, "public/adapter.py"), "changed");
    await expect(verifyPublicIntegrity(root)).rejects.toThrow("hash drift");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("checks only selected cache sources while rejecting altered or injected cached files", async () => {
  const { vi } = await import("vitest");
  const root = await mkdtemp(join(tmpdir(), "public-cached-integrity-test-"));
  const cache = join(root, "cache");
  const source = "bfcl";
  const relativePath = "public/bfcl/cases.jsonl";
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  try {
    vi.stubEnv("MONOCODE_EVAL_DATA_ROOT", cache);
    await mkdir(join(root, "public"), { recursive: true });
    await mkdir(join(root, "data"));
    await mkdir(join(root, "data/upstream/bfcl-v4-sample"), {
      recursive: true,
    });
    await mkdir(join(root, "data/upstream/longmemeval-oracle-sample"), {
      recursive: true,
    });
    await mkdir(join(cache, source, "public/bfcl"), { recursive: true });
    await writeFile(join(root, "public/bridge.py"), "audited bridge");
    await writeFile(join(cache, source, relativePath), "locked data");
    await writeFile(
      join(root, "data/datasets.lock.json"),
      JSON.stringify({
        version: 1,
        sources: {
          bfcl: { files: { [relativePath]: hash("locked data") } },
          hotpotqa: {
            files: { "public/hotpotqa/cases.jsonl": hash("unselected") },
          },
        },
      }),
    );
    await writeFile(
      join(root, "public/integrity.json"),
      JSON.stringify({
        files: {
          "public/bridge.py": hash("audited bridge"),
        },
      }),
    );
    expect((await verifyPublicIntegrity(root, [source])).files).toBe(2);
    const injected = join(cache, source, "public/bfcl/injected.py");
    await writeFile(injected, "unaudited code");
    await expect(verifyPublicIntegrity(root, [source])).rejects.toThrow(
      "inventory drift",
    );
    await rm(injected);
    await writeFile(join(cache, source, relativePath), "changed data");
    await expect(verifyPublicIntegrity(root, [source])).rejects.toThrow(
      "hash drift",
    );
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
