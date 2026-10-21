// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { useActiveDragPayload, useDropTarget } from "../../shared/ui/primitives/Sortable";
import { useSidebarPinDrop } from "./sidebarPinDrop";

vi.mock("../../shared/ui/primitives/Sortable", () => ({ useActiveDragPayload: vi.fn(), useDropTarget: vi.fn() }));
const ref = vi.fn();
beforeEach(() => {
  vi.mocked(useActiveDragPayload).mockReturnValue(null);
  vi.mocked(useDropTarget).mockReset().mockReturnValue({ ref, isOver: false });
  ref.mockClear();
});
it("accepts unpinned sessions and projects and commits only the drop callback", () => {
  const pin = vi.fn();
  useSidebarPinDrop(true);
  const options = vi.mocked(useDropTarget).mock.calls[0][0];
  for (const type of ["sidebar-session", "sidebar-project"]) {
    const payload = { type, pinned: false, onPin: pin };
    expect(options.accepts(payload)).toBe(true);
    expect(options.accepts({ ...payload, pinned: true })).toBe(false);
  }
  expect(options.accepts({ type: "explorer-file", onPin: pin })).toBe(false);
  expect(pin).not.toHaveBeenCalled();
  options.onDrop({ type: "sidebar-session", onPin: pin });
  expect(pin).toHaveBeenCalledOnce();
});
it("uses only the header for a conversation inside a pinned project", () => {
  const section = document.createElement("div"), header = document.createElement("div");
  header.dataset.sidebarSectionHeader = "";
  section.append(header);
  vi.mocked(useActiveDragPayload).mockReturnValue({ type: "sidebar-session", insidePins: true });
  useSidebarPinDrop(true).ref(section);
  expect(ref).toHaveBeenLastCalledWith(header);
  vi.mocked(useActiveDragPayload).mockReturnValue({ type: "sidebar-session" });
  useSidebarPinDrop(true).ref(section);
  expect(ref).toHaveBeenLastCalledWith(section);
  useSidebarPinDrop(false);
  expect(vi.mocked(useDropTarget).mock.lastCall?.[0].disabled).toBe(true);
});
