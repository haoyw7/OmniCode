import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, openSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";

export const config = JSON.parse(
  readFileSync(new URL("./update-config.json", import.meta.url)),
);
export const updateDirectory = () =>
  process.env.OMNICODE_MOBILE_UPDATE_DIR ||
  join(
    process.env.XDG_DATA_HOME || join(homedir(), ".local/share"),
    "omnicode/mobile-updates",
  );

export function createUpdateServer(directory = updateDirectory()) {
  return createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const path = req.url?.split("?")[0];
    if (path === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        req.method === "HEAD"
          ? undefined
          : JSON.stringify({ service: "omnicode-mobile-updates" }),
      );
      return;
    }
    if (
      path !== "/latest.json" &&
      !/^\/apk\/omnicode-\d+\.apk$/.test(path || "")
    ) {
      res.writeHead(404).end();
      return;
    }
    const file = join(directory, path.slice(1));
    try {
      const info = await stat(file);
      res.setHeader("Content-Length", info.size);
      res.setHeader(
        "Content-Type",
        path.endsWith(".apk")
          ? "application/vnd.android.package-archive"
          : "application/json",
      );
      if (path.endsWith(".apk")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${path.split("/").pop()}"`,
        );
      }
      if (req.method === "HEAD") res.end();
      else
        createReadStream(file)
          .on("error", () => res.destroy())
          .pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
}

export async function ensureUpdateServer() {
  const endpoint = new URL(config.baseUrl);
  if (
    !Object.values(networkInterfaces())
      .flat()
      .some((entry) => entry?.address === endpoint.hostname)
  ) {
    console.log(
      `APK published locally; ${endpoint.hostname} is not on this computer.`,
    );
    return;
  }
  const healthy = async () => {
    try {
      const response = await fetch(`${config.baseUrl}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      return (await response.json()).service === "omnicode-mobile-updates";
    } catch {
      return false;
    }
  };
  if (await healthy()) return;
  await mkdir(updateDirectory(), { recursive: true });
  const log = openSync(join(updateDirectory(), "server.log"), "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
  closeSync(log);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await healthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Update server could not start. See ${join(updateDirectory(), "server.log")}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await mkdir(updateDirectory(), { recursive: true });
  const endpoint = new URL(config.baseUrl);
  createUpdateServer().listen(Number(endpoint.port), endpoint.hostname, () => {
    console.log(
      `OmniCode mobile updates: ${config.baseUrl} (${updateDirectory()})`,
    );
  });
}
