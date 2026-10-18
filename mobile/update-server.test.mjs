import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createUpdateServer, config } from "./update-server.mjs";
import { publishUpdate } from "./publish-update.mjs";

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "omnicode-updates-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = join(root, "published");
  const build = async (code, data = `apk-${code}`) => {
    const directory = join(root, `build-${code}`);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "app-debug.apk"), data);
    await writeFile(
      join(directory, "output-metadata.json"),
      JSON.stringify({
        applicationId: config.packageId,
        elements: [
          {
            outputFile: "app-debug.apk",
            versionCode: code,
            versionName: "0.7.0",
          },
        ],
      }),
    );
    return directory;
  };
  return { store, build };
}

test("publishes complete APKs and never regresses or changes a versioned download", async (context) => {
  const { store, build } = await fixture(context);
  const manifest = await publishUpdate(await build(12), store);
  assert.equal(
    manifest.sha256,
    createHash("sha256").update("apk-12").digest("hex"),
  );
  assert.equal(
    await readFile(join(store, "apk/omnicode-12.apk"), "utf8"),
    "apk-12",
  );
  await publishUpdate(await build(11), store);
  assert.equal(
    JSON.parse(await readFile(join(store, "latest.json"))).versionCode,
    12,
  );
  await assert.rejects(
    publishUpdate(await build(12, "different"), store),
    /different APK/,
  );
  assert.equal(
    await readFile(join(store, "apk/omnicode-12.apk"), "utf8"),
    "apk-12",
  );
  await publishUpdate(await build(13), store);
  assert.equal(
    JSON.parse(await readFile(join(store, "latest.json"))).versionCode,
    13,
  );
});

test("parallel publications choose the largest build and leave usable immutable files", async (context) => {
  const { store, build } = await fixture(context);
  const directories = await Promise.all(
    [21, 24, 23, 22].map((code) => build(code)),
  );
  await Promise.all(
    directories.map((directory) => publishUpdate(directory, store)),
  );
  assert.equal(
    JSON.parse(await readFile(join(store, "latest.json"))).versionCode,
    24,
  );
  for (const code of [21, 22, 23, 24])
    assert.equal(
      await readFile(join(store, `apk/omnicode-${code}.apk`), "utf8"),
      `apk-${code}`,
    );
});

test("serves metadata and APK with correct caching, HEAD, CORS, and restricted paths", async (context) => {
  const { store, build } = await fixture(context);
  const manifest = await publishUpdate(await build(2), store);
  const server = createUpdateServer(store);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const latest = await fetch(`${endpoint}/latest.json`);
  assert.equal(latest.headers.get("cache-control"), "no-store");
  assert.equal(latest.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await latest.json(), manifest);
  const head = await fetch(`${endpoint}${manifest.downloadPath}`, {
    method: "HEAD",
  });
  assert.equal(head.headers.get("content-length"), `${manifest.size}`);
  assert.match(head.headers.get("cache-control"), /immutable/);
  assert.equal(await head.text(), "");
  const apk = await fetch(`${endpoint}${manifest.downloadPath}`);
  assert.equal(await apk.text(), "apk-2");
  assert.equal((await fetch(`${endpoint}/version-code`)).status, 404);
  assert.equal(
    (await fetch(`${endpoint}/apk/%2e%2e/version-code`)).status,
    404,
  );
  assert.equal(
    (await fetch(`${endpoint}/latest.json`, { method: "POST" })).status,
    405,
  );
  assert.equal(
    (await fetch(`${endpoint}/latest.json`, { method: "OPTIONS" })).status,
    204,
  );
});

test("rejects APK metadata from another app and missing packages without replacing latest", async (context) => {
  const { store, build } = await fixture(context);
  await publishUpdate(await build(2), store);
  const directory = await build(3);
  const metadata = JSON.parse(
    await readFile(join(directory, "output-metadata.json")),
  );
  metadata.applicationId = "other.app";
  await writeFile(
    join(directory, "output-metadata.json"),
    JSON.stringify(metadata),
  );
  await assert.rejects(publishUpdate(directory, store), /OmniCode APK/);
  assert.equal(
    JSON.parse(await readFile(join(store, "latest.json"))).versionCode,
    2,
  );
});
