import { cp, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { withProviderRuntimeLock } from "./provider-runtime";

const canonical = async (path: string) => realpath(path).catch(() => resolve(path));
const exists = async (path: string) => lstat(path).then(() => true, error => {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
  throw error;
});

/** The package and its own launchers; never npm metadata or other packages. */
export class ProviderNpmInstallation {
  constructor(readonly root: string, readonly launchers: string[], readonly prefix: string, readonly packageName: string) {}

  static async find(command: string, packageName: string, windows = process.platform === "win32"): Promise<ProviderNpmInstallation | undefined> {
    const real = await canonical(command);
    const candidates: string[] = [];
    for (let path = real; ; path = dirname(path)) {
      candidates.push(path);
      if (dirname(path) === path) break;
    }
    candidates.push(join(dirname(command), "node_modules", packageName));
    if (packageName === "@earendil-works/pi-coding-agent") candidates.push(join(dirname(command), "node_modules", "@mariozechner/pi-coding-agent"));
    for (const root of candidates) {
      let manifest;
      try { manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")); } catch { continue; }
      const name = manifest.name;
      if (name !== packageName && !(packageName === "@earendil-works/pi-coding-agent" && name === "@mariozechner/pi-coding-agent")) continue;
      const modules = name.startsWith("@") ? dirname(dirname(root)) : dirname(root);
      if (basename(modules) !== "node_modules") continue;
      const base = dirname(modules);
      if (!windows && basename(base) !== "lib") throw new Error("Cannot safely back up a non-global npm installation");
      const prefix = windows ? base : dirname(base);
      const bin = windows ? prefix : join(prefix, "bin");
      const names = typeof manifest.bin === "string" ? [name.split("/").at(-1)!]
        : manifest.bin && typeof manifest.bin === "object" ? Object.keys(manifest.bin) : [];
      if (!names.length) throw new Error("npm package has no launchers to back up");
      const launchers: string[] = [];
      for (const name of names) {
        if (!name || name === "." || name === ".." || /[/\\:\0]/.test(name)) throw new Error("npm package has an invalid launcher name");
        launchers.push(join(bin, name));
        if (windows) launchers.push(join(bin, name + ".cmd"), join(bin, name + ".ps1"));
      }
      return new ProviderNpmInstallation(root, launchers, prefix, name);
    }
  }

  async update(update: () => Promise<void>, verify: () => Promise<string>): Promise<void> {
    const parent = dirname(this.root);
    await withProviderRuntimeLock(parent, async () => {
      let previous: string;
      try { previous = await verify(); } catch (error) { throw new Error(`Cannot verify the installed CLI before updating: ${error}`); }
      const backup = join(parent, `.omnicode-${basename(this.root)}-backup-${randomUUID()}`);
      const paths = [this.root, ...this.launchers];
      await mkdir(backup);
      try {
        await writeFile(join(backup, "paths.json"), JSON.stringify(paths));
        for (let i = 0; i < paths.length; i++) if (await exists(paths[i])) await cp(paths[i], join(backup, String(i)), { recursive: true, dereference: false, verbatimSymlinks: true });
      } catch (error) {
        await rm(backup, { recursive: true, force: true }).catch(() => {});
        throw new Error(`Could not back up CLI; update was not started: ${error}`);
      }
      try { await update(); await verify(); }
      catch (error) {
        try {
          const failed = join(backup, "failed-installation");
          await mkdir(failed);
          for (let i = 0; i < paths.length; i++) {
            if (await exists(paths[i])) await rename(paths[i], join(failed, String(i)));
            const saved = join(backup, String(i));
            if (await exists(saved)) await cp(saved, paths[i], { recursive: true, dereference: false, verbatimSymlinks: true });
          }
          const restored = await verify();
          if (restored !== previous) throw new Error(`Expected ${previous}, found ${restored}`);
        } catch (restoreError) { throw new Error(`${error}\nRollback failed: ${restoreError}\nRecovery files retained at ${backup}`); }
        await rm(backup, { recursive: true, force: true }).catch(() => {});
        throw new Error(`${error}\nPrevious CLI installation restored (${previous}).`);
      }
      await rm(backup, { recursive: true, force: true }).catch(() => {});
    });
  }
}
