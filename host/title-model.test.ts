import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { TitleModelApi } from "./title-model";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "monocode-title-model-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, api: new TitleModelApi(directory) };
}
async function endpoint(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`;
}
const input = {
  enabled: true,
  endpoint: "https://example.com/v1/chat/completions",
  model: "title-model",
  apiKey: "test-secret",
};

it("keeps credentials on the Host and explicitly preserves, replaces and clears them", () => {
  const { directory, api } = setup();
  expect(api.status().enabled).toBe(false);
  expect(api.save(input)).toEqual({
    enabled: true,
    endpoint: input.endpoint,
    model: input.model,
    hasApiKey: true,
  });
  const { apiKey: _, ...update } = input;
  api.save({ ...update, model: "another-model" });
  const path = join(directory, "title-model.json");
  expect(JSON.parse(readFileSync(path, "utf8")).apiKey).toBe("test-secret");
  if (process.platform !== "win32")
    expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(() =>
    api.save({ ...update, endpoint: "https://other.example/chat" }),
  ).toThrow("Re-enter or clear");
  expect(() =>
    api.save({ ...input, endpoint: "http://remote.example/chat" }),
  ).toThrow("HTTPS");
  expect(() =>
    api.save({ ...input, endpoint: "https://secret@example.com/chat" }),
  ).toThrow("HTTPS");
  api.save({ ...update, apiKey: "replacement" });
  expect(new TitleModelApi(directory).status().hasApiKey).toBe(true);
  expect(api.save({ ...update, apiKey: "" }).hasApiKey).toBe(false);
});

it("does not issue any request when unconfigured or disabled", async () => {
  const { api } = setup();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await api.generate("Name this")).toBeNull();
  expect(await api.generateBranch("Name this")).toBeNull();
  api.save({ ...input, enabled: false });
  expect(await api.generate("Name this")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("generates a branch fragment through the configured stateless API", async () => {
  const { api } = setup();
  api.save(input);
  const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: '{"branch":"fix-login"}' } }] }));
  vi.stubGlobal("fetch", fetch);
  expect(await api.generateBranch("修复登录")).toBe("fix-login");
  expect(fetch).toHaveBeenCalledWith(input.endpoint, expect.objectContaining({
    body: expect.stringContaining("lowercase English words joined by hyphens"),
  }));
});

it("sends a single stateless model request and parses its title", async () => {
  const { api } = setup();
  const requests: { authorization?: string; body: any; path?: string }[] = [];
  const url = await endpoint((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({
        authorization: req.headers.authorization,
        body: JSON.parse(body),
        path: req.url,
      });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { content: '{"title":"修复会话标题","workItem":null}', tool_calls: [] },
              finish_reason: "stop",
            },
          ],
        }),
      );
    });
  });
  api.save({ ...input, endpoint: url });
  expect(await api.generate("修复标题" + "x".repeat(9_000))).toEqual({
    title: "修复会话标题",
    workItem: null,
  });
  expect(requests).toHaveLength(1);
  expect(requests[0].authorization).toBe("Bearer test-secret");
  expect(requests[0].path).toBe("/v1/chat/completions");
  expect(requests[0].body).toEqual({
    model: "title-model",
    messages: [
      { role: "user", content: expect.stringContaining("[truncated]") },
    ],
    stream: false,
    store: false,
  });
});

it("does not follow redirects or leak provider error bodies", async () => {
  const { api } = setup();
  const target = vi.fn((_req: IncomingMessage, res: ServerResponse) =>
    res.end("secret response"),
  );
  const targetUrl = await endpoint(target);
  const redirect = await endpoint((_req, res) => {
    res.writeHead(307, { Location: targetUrl });
    res.end();
  });
  api.save({ ...input, endpoint: redirect });
  await expect(api.generate("Name this")).rejects.toThrow(
    "Title model request failed or timed out.",
  );
  expect(target).not.toHaveBeenCalled();
  const failure = await endpoint((_req, res) => {
    res.writeHead(401);
    res.end("secret response");
  });
  api.save({ ...input, endpoint: failure });
  await expect(api.generate("Name this")).rejects.toThrow(
    /^Title model returned HTTP 401\.$/,
  );
});

it.each([
  { choices: [{ message: { tool_calls: [{}], content: "Wrong title" } }] },
  {
    choices: [
      { message: { content: "Partial title" }, finish_reason: "length" },
    ],
  },
  { choices: [{ message: { content: "{}" } }] },
])("rejects unusable model results", async (body) => {
  const { api } = setup();
  api.save(input);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body)),
  );
  await expect(api.generate("Name this")).rejects.toThrow(
    "did not return a title",
  );
});

it("bounds response size and discards results after settings change", async () => {
  const { api } = setup();
  api.save(input);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("x".repeat(256 * 1024 + 1))),
  );
  await expect(api.generate("Name this")).rejects.toThrow("invalid response");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      api.save({ ...input, enabled: false });
      return Response.json({
        choices: [{ message: { content: "Old result" } }],
      });
    }),
  );
  expect(await api.generate("Name this")).toBeNull();
});
