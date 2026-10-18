import { expect, it, vi } from "vitest";
import { MobileClient, type RpcTransport } from "./client";
import type { StorageKey } from "./storage";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { post: vi.fn() },
}));

it("tracks notes capability across pairing, verification and Host switches, and sends scoped RPC", async () => {
  const saved = new Map<StorageKey, string>();
  let capable = true;
  const transport = vi.fn<RpcTransport>(async (endpoint, _token, request) => {
    if ((request as { method: string }).method === "environment.describe")
      return {
        protocolVersion: 1,
        environmentId: endpoint.includes("host-a") ? "a" : "b",
        name: "Host",
        providers: ["codex"],
        capabilities:
          capable && endpoint.includes("host-a") ? ["notes.v1"] : [],
      };
    return null;
  });
  const client = new MobileClient(
    {
      get: async (key) => saved.get(key) ?? null,
      set: async (key, value) => {
        saved.set(key, value);
      },
      remove: async (key) => {
        saved.delete(key);
      },
    },
    transport,
  );
  await client.connect("http://host-a:3774", "token-a");
  expect(client.hasCapability("notes.v1")).toBe(true);
  const note = { id: "n1", title: "Plan", body: "Text", tags: [] };
  await client.listNotes();
  await client.getNote("n1");
  await client.upsertNote(note);
  await client.saveNoteImage("n1", "flow.png", "YQ==");
  await client.noteImage("/note-assets/n1/1-flow.png");
  await client.deleteNote("n1");
  expect(transport.mock.calls.slice(1).map(([, , request]) => request)).toEqual(
    [
      { version: 1, environmentId: "a", method: "notes.list", params: {} },
      {
        version: 1,
        environmentId: "a",
        method: "notes.get",
        params: { id: "n1" },
      },
      {
        version: 1,
        environmentId: "a",
        method: "notes.upsert",
        params: { note },
      },
      {
        version: 1,
        environmentId: "a",
        method: "notes.saveImage",
        params: { noteId: "n1", name: "flow.png", data: "YQ==" },
      },
      {
        version: 1,
        environmentId: "a",
        method: "notes.image",
        params: { asset: "/note-assets/n1/1-flow.png" },
      },
      {
        version: 1,
        environmentId: "a",
        method: "notes.delete",
        params: { id: "n1" },
      },
    ],
  );
  capable = false;
  await client.verify();
  expect(client.hasCapability("notes.v1")).toBe(false);
  capable = true;
  await client.verify();
  expect(client.hasCapability("notes.v1")).toBe(true);
  await client.connect("http://host-b:3774", "token-b");
  expect(client.hasCapability("notes.v1")).toBe(false);
  await client.switchTo("http://host-a:3774");
  expect(client.hasCapability("notes.v1")).toBe(true);
  await client.disconnect();
  expect(client.hasCapability("notes.v1")).toBe(false);
});

it("keeps Notes hidden for older Hosts that omit capabilities", async () => {
  const client = new MobileClient(
    { get: async () => null, set: async () => {}, remove: async () => {} },
    async () => ({
      protocolVersion: 1,
      environmentId: "old",
      name: "Old Host",
      providers: ["codex"],
    }),
  );
  await client.connect("http://old-host:3774", "token");
  expect(client.hasCapability("notes.v1")).toBe(false);
  await client.verify();
  expect(client.hasCapability("notes.v1")).toBe(false);
});
