import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Host-private secrets, deliberately separate from synchronised preferences. */
export class InboxCredentials {
  private file: string;
  constructor(private directory: string, private desktopDirectory: () => string | undefined = () => {
    const ownerFile = join(directory, "desktop-owner.json");
    if (!existsSync(ownerFile)) return undefined;
    const owner = JSON.parse(readFileSync(ownerFile, "utf8")) as { desktopDirectory?: unknown };
    return typeof owner.desktopDirectory === "string" ? owner.desktopDirectory : undefined;
  }) {
    this.file = join(directory, "inbox-credentials.json");
  }
  private read(): Record<string, unknown> {
    if (!existsSync(this.file)) return {};
    const value: unknown = JSON.parse(readFileSync(this.file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid inbox credential store");
    return value as Record<string, unknown>;
  }
  private write(value: Record<string, unknown>) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.file);
    } finally { rmSync(temporary, { force: true }); }
  }
  get(key: string, legacyFile: string): unknown {
    const values = this.read();
    if (Object.hasOwn(values, key)) return values[key];
    const desktop = this.desktopDirectory();
    // A headless Host may be associated with a desktop after its first launch.
    if (!desktop) return undefined;
    const file = join(desktop, legacyFile);
    const value = existsSync(file) ? readFileSync(file, "utf8").trim() : null;
    this.write({ ...values, [key]: value });
    return value;
  }
  set(key: string, value: unknown): void { this.write({ ...this.read(), [key]: value }); }
}
