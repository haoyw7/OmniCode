import { beforeEach, expect, it, vi } from "vitest";
import { notesHostRequest, resolveHostNoteImage } from "./notesHost";

const state = vi.hoisted(() => ({ id: "local", rpc: vi.fn(), descriptor: vi.fn() }));
vi.mock("../connections/model/connections", () => ({ remoteRequest: state.rpc }));
vi.mock("../connections/model/remoteProjects", () => ({ sharedHostMachineId: () => state.id, sharedHostEnvironment: () => state.id }));
vi.mock("../connections/model/remoteHostMetadata", () => ({ loadRemoteHostDescriptor: state.descriptor }));

beforeEach(() => {
  state.id = "local";
  state.rpc.mockReset();
  state.descriptor.mockReset().mockResolvedValue({ capabilities: ["notes.v1"] });
});

it("sends notes mutations to the local Host and fails closed without its capability", async () => {
  state.rpc.mockResolvedValue({ id: "note" });
  await notesHostRequest("notes.upsert", { note: { id: "note" } });
  expect(state.rpc).toHaveBeenCalledWith("local", "notes.upsert", { note: { id: "note" } });
  state.rpc.mockClear();
  state.descriptor.mockResolvedValue({ capabilities: [] });
  await expect(notesHostRequest("notes.delete", { id: "note" })).rejects.toThrow(/Host/);
  expect(state.rpc).not.toHaveBeenCalled();
  state.id = "";
  await expect(notesHostRequest("notes.list")).rejects.toThrow(/not connected/);
});

it("scopes resolved assets by Host rather than a desktop filesystem path", async () => {
  state.rpc.mockResolvedValueOnce({ mime: "image/png", data: "YQ==" }).mockResolvedValueOnce({ mime: "image/png", data: "Yg==" });
  const path = "/note-assets/n/image.png";
  expect(await resolveHostNoteImage(path)).toBe("data:image/png;base64,YQ==");
  expect(await resolveHostNoteImage(path)).toBe("data:image/png;base64,YQ==");
  state.id = "second";
  expect(await resolveHostNoteImage(path)).toBe("data:image/png;base64,Yg==");
  expect(state.rpc).toHaveBeenCalledTimes(2);
});
