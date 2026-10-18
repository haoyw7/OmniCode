import { expect, it, vi } from "vitest";
import { resolveBotTarget } from "./botNavigation";
const ref = {
  environmentId: "host-a",
  projectId: "project-a",
  sessionId: "session-a",
};
it("resolves exact Host, project and session IDs without guessing from names", async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce([
      { id: "project-b", name: "same" },
      { id: "project-a", name: "same" },
    ])
    .mockResolvedValueOnce({
      projectId: "project-a",
      session: { id: "session-a" },
    });
  expect((await resolveBotTarget("host-a", ref, rpc)).project.id).toBe(
    "project-a",
  );
  expect(rpc.mock.calls[1][1]).toEqual({ sessionId: "session-a" });
});
it("refuses a disconnected Host and unavailable or replaced target", async () => {
  const rpc = vi.fn();
  await expect(resolveBotTarget("host-b", ref, rpc)).rejects.toThrow(
    /another Host/,
  );
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValueOnce([{ id: "project-a" }]).mockResolvedValueOnce({
    projectId: "project-b",
    session: { id: "session-a" },
  });
  await expect(resolveBotTarget("host-a", ref, rpc)).rejects.toThrow(
    /unavailable/,
  );
});
