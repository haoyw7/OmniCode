import { describe, expect, it, vi } from "vitest";
import { takeBackQueuedMessage } from "./queuedDraft";
import type { QueuedMessage } from "../features/sessions/model/session";

const queued: QueuedMessage = {
  id: "queue",
  text: "Keep this image",
  intent: "plan",
  attachments: [
    {
      id: "image",
      name: "photo.png",
      mimeType: "image/png",
      kind: "image",
      size: 5,
      path: "/host/image",
    },
  ],
};
function fixture() {
  const read = vi.fn(async (_id: string, offset: number) =>
    offset === 0
      ? { data: "YWJj", offset: 3, size: 5 }
      : { data: "ZGU=", offset: 5, size: 5 },
  );
  return {
    read,
    remove: vi.fn(async () => {}),
    pendingRemoval: vi.fn(async () => false),
    current: () => true,
    restore: vi.fn(),
  };
}
describe("take a queued message back to the mobile composer", () => {
  it("fetches complete image bytes before removing the message and preserves all attachment metadata", async () => {
    const actions = fixture();
    actions.remove.mockImplementation(async () =>
      expect(actions.read).toHaveBeenCalledTimes(2),
    );
    await takeBackQueuedMessage(queued, actions);
    expect(actions.remove).toHaveBeenCalledWith("queue");
    expect(actions.restore).toHaveBeenCalledWith([
      { ...queued.attachments[0], data: "YWJjZGU=" },
    ]);
    expect(queued.attachments[0].data).toBeUndefined();
  });
  it("retains the queued message and current composer if downloading the image fails", async () => {
    const actions = fixture();
    actions.read.mockRejectedValueOnce(new Error("Image unavailable"));
    await expect(takeBackQueuedMessage(queued, actions)).rejects.toThrow(
      "Image unavailable",
    );
    expect(actions.remove).not.toHaveBeenCalled();
    expect(actions.restore).not.toHaveBeenCalled();
  });
  it("rejects incomplete image chunks without removing the message", async () => {
    const actions = fixture();
    actions.read.mockResolvedValueOnce({ data: "YWJj", offset: 4, size: 5 });
    await expect(takeBackQueuedMessage(queued, actions)).rejects.toThrow(
      "Invalid image transfer",
    );
    expect(actions.remove).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "preserves a prepared draft on a lost removal receipt only when the journal has a pending removal (%s)",
    async (pending) => {
      const actions = fixture();
      actions.remove.mockRejectedValueOnce(new Error("Removal failed"));
      actions.pendingRemoval.mockResolvedValue(pending);
      await expect(takeBackQueuedMessage(queued, actions)).rejects.toThrow(
        "Removal failed",
      );
      expect(actions.restore).toHaveBeenCalledTimes(pending ? 1 : 0);
    },
  );
  it("leaves the queue alone when the user leaves during an image download", async () => {
    const actions = fixture();
    await takeBackQueuedMessage(queued, { ...actions, current: () => false });
    expect(actions.remove).not.toHaveBeenCalled();
    expect(actions.restore).not.toHaveBeenCalled();
  });
});
