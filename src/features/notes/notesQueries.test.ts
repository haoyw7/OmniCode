import { QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { queryClient } from "../../shared/lib/queryClient";
import { deleteNote, loadNotes, notesQuery, peekNotes, upsertNote, type Note } from "./notes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const note: Note = { id: "n", slug: "plan", title: "Plan", body: "draft", tags: [], slugPending: false, createdAt: 1, updatedAt: 1 };
const call = vi.mocked(invoke);
beforeEach(() => { queryClient.clear(); call.mockReset(); });
afterEach(() => queryClient.clear());

it("shares an initial read between prompt enrichment and a mounted editor", async () => {
  let finish!: (notes: Note[]) => void;
  call.mockReturnValueOnce(new Promise<Note[]>((resolve) => { finish = resolve; }));
  const prompt = loadNotes();
  const observer = new QueryObserver(queryClient, notesQuery());
  const stop = observer.subscribe(() => {});
  expect(call).toHaveBeenCalledExactlyOnceWith("notes_list");
  finish([note]);
  expect(await prompt).toEqual([note]);
  expect(observer.getCurrentResult().data).toEqual([note]);
  stop();
});

it.each(["save", "delete"])("ignores a pre-write listing after %s and refreshes observers", async (operation) => {
  let old!: (notes: Note[]) => void;
  const saved = { ...note, body: "saved", updatedAt: 2 };
  const current = operation === "save" ? [saved] : [];
  call.mockReturnValueOnce(new Promise<Note[]>((resolve) => { old = resolve; }))
    .mockResolvedValueOnce(operation === "save" ? saved : undefined)
    .mockResolvedValueOnce(current);
  const observer = new QueryObserver(queryClient, notesQuery());
  const stop = observer.subscribe(() => {});
  if (operation === "save") await upsertNote(saved);
  else await deleteNote(note.id);
  expect(observer.getCurrentResult().data).toEqual(current);
  old([note]);
  await Promise.resolve();
  expect(peekNotes()).toEqual(current);
  stop();
});

it("exposes list errors without replacing cached notes with an empty success", async () => {
  call.mockResolvedValueOnce([note]).mockRejectedValueOnce(new Error("unavailable"));
  await loadNotes();
  const observer = new QueryObserver(queryClient, notesQuery());
  const stop = observer.subscribe(() => {});
  await observer.refetch({ cancelRefetch: false });
  expect(observer.getCurrentResult().error?.message).toBe("unavailable");
  expect(peekNotes()).toEqual([note]);
  stop();
});
