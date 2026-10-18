// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopBotMemory } from "./DesktopBotMemory";
import { BotMemoryDrafts } from "../model/botMemoryDrafts";
import type { BotMemoryDocument } from "../model/botMemory";
import { setUiLanguage } from "../../../shared/i18n/language";

let node: HTMLDivElement, root: Root, drafts: BotMemoryDrafts;
let rpc: ReturnType<typeof vi.fn>;
let doc: BotMemoryDocument;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  drafts = new BotMemoryDrafts();
  doc = { path: "MEMORY.md", kind: "resident", text: "Saved memory", hash: "h1", revision: 1, bytes: 12, updatedAt: 1,
    budget: { maxLines: 200, maxBytes: 24576, lines: 201, bytes: 30000, loadedLines: 200, loadedBytes: 24576, truncated: true } };
  rpc = vi.fn(async (method: string, params: Record<string, any> = {}) => {
    if (method === "botMemory.list") return { revision: doc.revision, files: [doc], topicLimit: 100, topicsTruncated: false };
    if (method === "botMemory.read") return params.path === "MEMORY.md" ? doc : { ...doc, path: params.path, kind: "topic", text: "", hash: "empty", revision: 0, budget: undefined };
    if (method === "botMemory.save") {
      if (params.expectedRevision !== doc.revision || params.expectedHash !== doc.hash) throw Object.assign(new Error("Memory changed elsewhere"), { code: "MEMORY_CONFLICT" });
      doc = { ...doc, text: params.text, revision: doc.revision + 1, hash: "h3" };
      return doc;
    }
    if (method === "botMemory.log") return [{ id: "change1", path: doc.path, at: 1, source: "user", revision: doc.revision, beforeHash: "before", afterHash: doc.hash }];
    if (method === "botMemory.undo") { doc = { ...doc, text: "Before change", revision: doc.revision + 1, hash: "undo" }; return doc; }
    throw new Error(`Unexpected RPC ${method}`);
  });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); }
async function render() { act(() => root.render(createElement(DesktopBotMemory, { botId: "A", rpc: rpc as never, drafts }))); await flush(); }
const editor = () => node.querySelector<HTMLTextAreaElement>('[aria-label="File contents"]')!;
const button = (text: string) => [...node.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text)!;
function input(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
it("preserves a conflicted draft and requires an explicit choice before saving against the latest hash", async () => {
  await render();
  expect(node.textContent).toContain("Memory is truncated in prompts");
  expect(node.textContent).toContain("200 / 200 lines · 24576 / 24576 bytes loaded");
  act(() => input(editor(), "My draft"));
  doc = { ...doc, revision: 2, hash: "h2", text: "External edit" };
  act(() => button("Save file").click()); await flush();
  expect(editor().value).toBe("My draft");
  expect(button("Save file").disabled).toBe(true);
  expect(node.querySelector<HTMLTextAreaElement>('[aria-label="Latest saved version"]')!.value).toBe("External edit");
  const first = rpc.mock.calls.find(([method]) => method === "botMemory.save")![1];
  expect(first).toMatchObject({ botId: "A", path: "MEMORY.md", expectedRevision: 1, expectedHash: "h1", text: "My draft" });
  act(() => button("Keep draft over latest").click());
  expect(editor().value).toBe("My draft");
  act(() => button("Save file").click()); await flush();
  const second = rpc.mock.calls.filter(([method]) => method === "botMemory.save")[1][1];
  expect(second).toMatchObject({ expectedRevision: 2, expectedHash: "h2", text: "My draft" });
  expect(second.commandId).not.toBe(first.commandId);
  expect(button("Save file").disabled).toBe(true);
});
it("keeps a command ID across an uncertain save and disables undo until the draft is saved", async () => {
  await render();
  act(() => button("Change history").click()); await flush();
  act(() => input(editor(), "Updated memory"));
  expect(button("Undo").disabled).toBe(true);
  rpc.mockImplementationOnce(async () => { throw new Error("Connection lost"); });
  act(() => button("Save file").click()); await flush();
  expect(editor().value).toBe("Updated memory");
  act(() => button("Save file").click()); await flush();
  const saves = rpc.mock.calls.filter(([method]) => method === "botMemory.save");
  expect(saves[0][1].commandId).toBe(saves[1][1].commandId);
  expect(button("Undo").disabled).toBe(false);
  act(() => button("Undo").click()); await flush();
  expect(rpc.mock.calls.find(([method]) => method === "botMemory.undo")![1]).toMatchObject({ botId: "A", changeId: "change1", expectedRevision: 2, expectedHash: "h3" });
  expect(editor().value).toBe("Before change");
});
it("opens a topic as an unsaved draft and retains it when switching files", async () => {
  await render();
  act(() => button("New topic").click());
  act(() => input(node.querySelector<HTMLInputElement>('input[placeholder="Topic name"]')!, "preferences"));
  act(() => node.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await flush();
  expect(rpc.mock.calls.some(([method]) => method === "botMemory.save")).toBe(false);
  expect(rpc.mock.calls.some(([method, params]) => method === "botMemory.read" && params.path === "memory/preferences.md")).toBe(true);
  act(() => input(editor(), "Preferred style"));
  const select = node.querySelector<HTMLSelectElement>('[aria-label="Memory file"]')!;
  act(() => { select.value = "MEMORY.md"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
  expect([...select.options].some((option) => option.value === "memory/preferences.md")).toBe(true);
  act(() => { select.value = "memory/preferences.md"; select.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
  expect(editor().value).toBe("Preferred style");
});
