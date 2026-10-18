// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileNotes, type MobileNotesHandle } from "./MobileNotes";
import { setUiLanguage } from "../shared/i18n/language";
import { SurfaceVisibilityContext } from "../shared/ui/SurfaceVisibility";
import type { Note } from "../features/notes/notesText";
import type { MobileClient } from "./client";

let root: Root, node: HTMLDivElement, stored: Note;
let upsert: ReturnType<typeof vi.fn>,
  remove: ReturnType<typeof vi.fn>,
  upload: ReturnType<typeof vi.fn>,
  close: ReturnType<typeof vi.fn>,
  add: ReturnType<typeof vi.fn>;
let client: MobileClient;
const handle = createRef<MobileNotesHandle>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  setUiLanguage("en");
  stored = {
    id: crypto.randomUUID(),
    slug: "plan-slug",
    title: "Plan",
    body: "Draft body",
    tags: ["ideas"],
    sourceCwd: "/work/project",
    createdAt: 1,
    updatedAt: 1,
  };
  upsert = vi.fn();
  remove = vi.fn();
  upload = vi.fn();
  close = vi.fn();
  add = vi.fn(async () => {});
  client = {
    connection: { environmentId: "host", endpoint: "http://host" },
    rpc: vi.fn(async () => null),
    listNotes: vi.fn(async () => [{ ...stored }]),
    getNote: vi.fn(async () => ({ ...stored })),
    noteImage: vi.fn(async () => ({ mime: "image/png", data: "YQ==" })),
    upsertNote: upsert,
    deleteNote: remove,
    saveNoteImage: upload,
  } as unknown as MobileClient;
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Reading, navigation, backgrounding and unmounting must never write notes.
  expect(upsert).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
});
async function render(visible = true) {
  await act(async () =>
    root.render(
      createElement(SurfaceVisibilityContext.Provider, {
        value: visible,
        children: createElement(MobileNotes, {
          ref: handle,
          client,
          hostKey: "http://host",
          projects: [{ id: "project", cwd: "/work/project", name: "Project" }],
          onClose: close,
          onAddToChat: add,
        }),
      }),
    ),
  );
}
function active() {
  return node.querySelector<HTMLElement>('[data-page-active="true"]')!;
}
function button(label: string) {
  return [...active().querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.getAttribute("aria-label") === label ||
      button.textContent === label,
  )!;
}
function type(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
async function open() {
  await render();
  await act(async () =>
    active().querySelector<HTMLButtonElement>(".mobile-note-card")!.click(),
  );
}

it("filters title, body, slug, tags and project name and retries load failures", async () => {
  await render();
  const filter = active().querySelector<HTMLInputElement>(
    '[aria-label="Filter notes"]',
  )!;
  for (const query of [
    "Plan",
    "draft body",
    "plan-slug",
    "#ideas",
    "project",
  ]) {
    act(() => type(filter, query));
    expect(active().querySelectorAll(".mobile-note-card")).toHaveLength(1);
  }
  act(() => type(filter, "missing"));
  expect(active().textContent).toContain("No matching notes");
  vi.mocked(client.listNotes).mockRejectedValueOnce(new Error("Offline"));
  await act(async () => button("Refresh notes").click());
  expect(active().querySelector('[role="alert"]')?.textContent).toContain(
    "Offline",
  );
  await act(async () => button("Retry").click());
  expect(active().querySelector('[role="alert"]')).toBeNull();
  act(() => type(filter, ""));
  expect(active().querySelectorAll(".mobile-note-card")).toHaveLength(1);
});

it("opens assistant topics from Notes, refreshes their Markdown and returns to the list", async () => {
  let text = "## Deployment\n\n**Use staging**";
  vi.mocked(client.rpc).mockImplementation(async (method) =>
    method === "assistant.memory"
      ? { revision: 1, facts: [], topics: ["deploys"] }
      : { name: "deploys", text, revision: 1 } as any,
  );
  await render();
  expect(client.rpc).not.toHaveBeenCalledWith("assistant.memoryTopic", expect.anything());
  await act(async () => active().querySelector<HTMLButtonElement>("[data-assistant-topic]")!.click());
  expect(client.rpc).toHaveBeenCalledWith("assistant.memoryTopic", { topic: "deploys" });
  expect(active().querySelector('[data-streamdown="strong"]')?.textContent).toBe("Use staging");
  expect(active().textContent).toContain("Read only");
  text = "New deployment procedure";
  await act(async () => button("Refresh notes").click());
  expect(active().textContent).toContain(text);
  expect(active().querySelector("input, textarea")).toBeNull();
  await act(async () => handle.current!.back());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(active().querySelectorAll("[data-assistant-topic]")).toHaveLength(1);
  expect(close).not.toHaveBeenCalled();
});

it("retries a failed topic read and reports a removed topic without opening an ordinary note", async () => {
  vi.mocked(client.rpc).mockImplementation(async (method) => {
    if (method === "assistant.memory") return { topics: ["deploys"] } as any;
    throw new Error("Disconnected");
  });
  await render();
  await act(async () => active().querySelector<HTMLButtonElement>("[data-assistant-topic]")!.click());
  expect(active().querySelector('[role="alert"]')?.textContent).toContain("Disconnected");
  vi.mocked(client.rpc).mockResolvedValueOnce(null);
  await act(async () => button("Retry").click());
  expect(active().textContent).toContain("Note was not found.");
  expect(client.getNote).not.toHaveBeenCalled();
});

it("reads the latest note with Markdown and images without editing controls", async () => {
  await render();
  expect(button("New note")).toBeUndefined();
  const asset = `/note-assets/${stored.id}/1-flow.png`;
  stored = {
    ...stored,
    body: `### Updated plan\n\n**Read this**\n\n![Flow](${asset})`,
  };
  await act(async () =>
    active().querySelector<HTMLButtonElement>(".mobile-note-card")!.click(),
  );
  expect(client.getNote).toHaveBeenCalledWith(stored.id);
  expect(active().querySelector("h2")?.textContent).toBe("Plan");
  expect(active().querySelector("h3")?.textContent).toBe("Updated plan");
  expect(
    active().querySelector(".mobile-note-markdown")?.textContent,
  ).toContain("Read this");
  expect(active().querySelector(".mobile-note-meta")?.textContent).toBe(
    "plan-slugProject",
  );
  expect(active().querySelector(".mobile-note-tags")?.textContent).toBe(
    "#ideas",
  );
  expect(client.noteImage).toHaveBeenCalledWith(asset);
  expect(active().querySelector("img")?.getAttribute("src")).toBe(
    "data:image/png;base64,YQ==",
  );
  expect(
    active().querySelector('input, textarea, select, [contenteditable="true"]'),
  ).toBeNull();
  for (const label of [
    "Delete note",
    "Insert images",
    "Add tags",
    "Remove tag ideas",
    "Project",
    "Source",
  ]) {
    expect(button(label)).toBeUndefined();
  }
});

it("keeps unfinished blank notes unchanged when hidden, returned from and unmounted", async () => {
  stored = {
    ...stored,
    title: "Untitled",
    slug: "untitled",
    body: "",
    tags: [],
    slugPending: true,
  };
  const original = { ...stored };
  await open();
  expect(active().textContent).toContain("No description");
  expect(button("Add to chat").disabled).toBe(true);
  expect(active().querySelector("input, textarea")).toBeNull();
  await render(false);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(1000);
  });
  await render(true);
  await act(async () => handle.current!.back());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(active().querySelectorAll(".mobile-note-card")).toHaveLength(1);
  expect(close).not.toHaveBeenCalled();
  expect(client.listNotes).toHaveBeenCalledTimes(2);
  await act(async () => handle.current!.back());
  expect(close).toHaveBeenCalledOnce();
  expect(stored).toEqual(original);
});

it("adds the saved note to chat and allows retry after a failed action", async () => {
  await open();
  add.mockRejectedValueOnce(new Error("No project"));
  await act(async () => button("Add to chat").click());
  expect(add).toHaveBeenCalledWith(stored);
  expect(active().querySelector('[role="alert"]')?.textContent).toContain(
    "No project",
  );
  await act(async () => button("Add to chat").click());
  expect(add).toHaveBeenCalledTimes(2);
  expect(active().querySelector('[role="alert"]')).toBeNull();
});

it("keeps missing notes in the list until it is refreshed", async () => {
  client.getNote = vi.fn(async () => null);
  await open();
  expect(active().querySelector('[role="alert"]')?.textContent).toContain(
    "Note was not found.",
  );
  expect(active().querySelectorAll(".mobile-note-card")).toHaveLength(1);
  client.listNotes = vi.fn(async () => []);
  await act(async () => button("Retry").click());
  expect(active().querySelectorAll(".mobile-note-card")).toHaveLength(0);
  expect(active().querySelector('[role="alert"]')).toBeNull();
});

it("does not request a note from another Host after a connection switch", async () => {
  await render();
  client.connection = {
    environmentId: "other",
    endpoint: "http://other",
    token: "token",
    name: "Other",
  };
  await act(async () =>
    active().querySelector<HTMLButtonElement>(".mobile-note-card")!.click(),
  );
  expect(client.getNote).not.toHaveBeenCalled();
  expect(active().querySelector('[role="alert"]')?.textContent).toContain(
    "Host connection changed",
  );
});

it("explains desktop creation in the empty state in both languages", async () => {
  client.listNotes = vi.fn(async () => []);
  await render();
  expect(active().textContent).toContain(
    "No notes yet. Create notes on desktop to view them here.",
  );
  expect(button("New note")).toBeUndefined();
  await act(async () => setUiLanguage("zh-CN"));
  expect(active().textContent).toContain(
    "暂无笔记。在桌面端创建笔记后，即可在这里查看。",
  );
  expect(button("新建笔记")).toBeUndefined();
});
