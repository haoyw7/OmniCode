import { describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browseHostDirectories } from "./browse";

describe("host directory browser", () => {
  it("lists folders without exposing files and rejects relative paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "monocode-browse-"));
    try {
      mkdirSync(join(root, "repo"));
      writeFileSync(join(root, "secret.txt"), "private data");
      const result = await browseHostDirectories(root);
      expect(result.path).toBe(root);
      expect(result.entries).toEqual([
        { name: "repo", path: join(root, "repo") },
      ]);
      expect(result.parent).not.toBeNull();
      await expect(browseHostDirectories("relative/path")).rejects.toThrow(
        "absolute",
      );
      await expect(browseHostDirectories("bad\0path")).rejects.toThrow(
        "Invalid",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "includes directory symlinks, follows them without replacing their paths and ignores file/broken/loop links",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "monocode-browse-links-"));
      const target = mkdtempSync(join(tmpdir(), "monocode-browse-target-"));
      try {
        mkdirSync(join(root, "repo"));
        mkdirSync(join(target, "child"));
        writeFileSync(join(root, "file.txt"), "ordinary file");
        const link = join(root, "linked 项目");
        symlinkSync(target, link, "dir");
        symlinkSync("repo", join(root, "local alias"), "dir");
        symlinkSync("file.txt", join(root, "file alias"), "file");
        symlinkSync("missing", join(root, "broken alias"), "dir");
        symlinkSync("loop", join(root, "loop"), "dir");
        const result = await browseHostDirectories(root);
        expect(result.entries).toEqual([
          { name: "linked 项目", path: link },
          { name: "local alias", path: join(root, "local alias") },
          { name: "repo", path: join(root, "repo") },
        ]);
        expect(await browseHostDirectories(link)).toEqual({
          path: link,
          parent: root,
          entries: [{ name: "child", path: join(link, "child") }],
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(target, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "can list and leave the parent of an unreadable directory or directory symlink",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "monocode-browse-permissions-"));
      const denied = join(root, "denied");
      mkdirSync(denied);
      try {
        symlinkSync(denied, join(root, "denied alias"), "dir");
        chmodSync(denied, 0);
        expect((await browseHostDirectories(root)).entries).toEqual([
          { name: "denied", path: denied },
          { name: "denied alias", path: join(root, "denied alias") },
        ]);
        await expect(browseHostDirectories(denied)).rejects.toMatchObject({
          code: "EACCES",
        });
        await expect(
          browseHostDirectories(join(root, "denied alias")),
        ).rejects.toMatchObject({ code: "EACCES" });
        expect((await browseHostDirectories(root)).path).toBe(root);
      } finally {
        chmodSync(denied, 0o700);
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
