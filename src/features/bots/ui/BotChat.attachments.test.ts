// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotChat } from "./BotChat";
import { MobileAssistant } from "../../../mobile/MobileAssistant";
import { fullBotPolicy } from "../model/botView";
import { setUiLanguage } from "../../../shared/i18n/language";

const native = vi.hoisted(() => ({ enabled: false, read: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled, invoke: native.read }));
vi.mock("./BotWorkerDetails", () => ({ BotWorkerDetails: () => null }));
let root: Root, node: HTMLDivElement;
let revoke: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  localStorage.clear();
  setUiLanguage("en");
  native.enabled = false;
  native.read.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:assistant-preview");
  revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function flush() {
  await act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  });
}
async function mount(mobile: boolean) {
  let failSend = false;
  const rpc = vi.fn(async (method: string, params?: any) => {
    if (method === "environment.describe") return { capabilities: ["assistant.v1"] };
    if (method === "assistant.get") return {
      id: "assistant", name: "Assistant", lifecycle: "idle", revision: 1,
      enabled: true, triggers: { user: true }, brainGeneration: 1,
      policy: fullBotPolicy(), harness: "codex", model: "test",
    };
    if (method === "assistant.messages") return { entries: [], nextRevision: 0, hasMore: false };
    if (method === "models.list") return { models: {}, errors: {} };
    if (method === "projects.list") return [];
    if (method === "attachments.upload") return { offset: params.offset + atob(params.data).length };
    if (method === "assistant.send" && failSend) throw new Error("offline");
    return {};
  });
  act(() => root.render(createElement(mobile ? MobileAssistant : BotChat, {
    hostKey: "host", hostName: "Host", rpc: rpc as any, onOpen: () => {},
  })));
  await flush();
  return { rpc, fail: (value: boolean) => { failSend = value; } };
}
function paste(files: File[], text = "") {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: {
    files: [], items: files.map(file => ({ kind: "file", type: file.type, getAsFile: () => file })),
    getData: () => text,
  } });
  act(() => node.querySelector("textarea")!.dispatchEvent(event));
  return event;
}
function button(label: string) {
  return node.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}
const photo = () => new File([new Uint8Array([137, 80, 78, 71])], "photo.png", { type: "image/png" });

it.each([false, true])("pastes image-only messages, previews them and retries the same attachment (%s)", async mobile => {
  const { rpc, fail } = await mount(mobile);
  expect(paste([], "ordinary text").defaultPrevented).toBe(false);
  expect(paste([photo()]).defaultPrevented).toBe(true);
  expect(button("Send").disabled).toBe(true);
  await flush();
  expect(node.querySelector<HTMLImageElement>(".attachment-chip-thumbnail")?.src).toBe("blob:assistant-preview");
  expect(button("Send").disabled).toBe(false);
  act(() => button("Open photo.png full screen").click());
  expect(document.querySelector(".image-lightbox img")?.getAttribute("src")).toBe("blob:assistant-preview");
  act(() => document.querySelector<HTMLButtonElement>(".image-lightbox-close")!.click());
  fail(true);
  act(() => button("Send").click());
  await flush();
  const sent = rpc.mock.calls.find(([method]) => method === "assistant.send")![1];
  expect(sent).toMatchObject({ text: "", attachments: [{ name: "photo.png", mimeType: "image/png", kind: "image", size: 4 }] });
  expect(sent.attachments[0]).not.toHaveProperty("previewFile");
  expect(button("Attach files").disabled).toBe(true);
  expect(node.querySelector(".attachment-chip-thumbnail")).not.toBeNull();
  fail(false);
  act(() => [...node.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Retry message")!.click());
  await flush();
  expect(rpc.mock.calls.filter(([method]) => method === "assistant.send")[1][1]).toEqual(sent);
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(button("Send").disabled).toBe(true);
  expect(revoke).toHaveBeenCalledWith("blob:assistant-preview");
});

it.each([false, true])("selects multiple photos through the attachment button, removes a preview and accepts dropped images (%s)", async mobile => {
  const { rpc } = await mount(mobile);
  const input = node.querySelector<HTMLInputElement>('input[type="file"]')!;
  const click = vi.spyOn(input, "click");
  act(() => button("Attach files").click());
  expect(click).toHaveBeenCalledOnce();
  Object.defineProperty(input, "files", { value: [photo(), photo()] });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  await flush();
  expect(node.querySelectorAll(".attachment-chip-thumbnail")).toHaveLength(2);
  act(() => button("Remove photo.png").click());
  expect(node.querySelectorAll(".attachment-chip-thumbnail")).toHaveLength(1);
  expect(revoke).toHaveBeenCalledOnce();
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: { files: [photo()] } });
  act(() => node.querySelector("form")!.dispatchEvent(drop));
  expect(drop.defaultPrevented).toBe(true);
  await flush();
  expect(node.querySelectorAll(".attachment-chip-thumbnail")).toHaveLength(2);
  expect(rpc.mock.calls.filter(([method]) => method === "attachments.upload")).toHaveLength(3);
});

it("reads native desktop screenshot bytes when the webview clipboard is empty", async () => {
  await mount(false);
  native.enabled = true;
  native.read.mockResolvedValue(new Uint8Array([137, 80, 78, 71]).buffer);
  paste([]);
  await flush();
  expect(native.read).toHaveBeenCalledWith("clipboard_image");
  expect(node.querySelector('button[aria-label="Open clipboard-image.png full screen"]')).not.toBeNull();
});

it("blocks concurrent uploads and shows errors without leaving send enabled", async () => {
  const { rpc } = await mount(false);
  paste([new File([new Uint8Array(21 * 1024 * 1024)], "large.png", { type: "image/png" })]);
  paste([photo()]);
  await flush();
  expect(node.textContent).toContain("Attachments must be at most 20 MB");
  expect(rpc.mock.calls.some(([method]) => method === "attachments.upload")).toBe(false);
  expect(button("Send").disabled).toBe(true);
  expect(button("Attach files").disabled).toBe(false);
});
