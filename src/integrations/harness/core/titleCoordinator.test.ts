import { afterEach, describe, expect, it, vi } from "vitest";
import {
  newSession,
  type Session,
} from "../../../features/sessions/model/session";
import { manualSessionTitle } from "../../../features/sessions/model/titlePolicy";
import { SessionTitleCoordinator } from "./titleCoordinator";

afterEach(() => vi.useRealTimers());
function setup() {
  let session: Session = {
    ...newSession("codex"),
    providerSessionId: "native",
  };
  const generate = vi.fn(async () => ({
    title: "Fallback title",
    workItem: null,
  }));
  const read = vi.fn(async () => null as string | null);
  const options: ConstructorParameters<typeof SessionTitleCoordinator>[0] = {
    get: () => session,
    update: (_id, change) => {
      session = change(session);
    },
    read,
    generate,
  };
  const coordinator = new SessionTitleCoordinator(options);
  return {
    coordinator,
    recreate: () => new SessionTitleCoordinator(options),
    generate,
    read,
    get: () => session,
    set: (s: Session) => {
      session = s;
    },
  };
}
describe("native-first title coordination", () => {
  it("drops a generated result after the provider session changes", async () => {
    vi.useFakeTimers();
    const s = setup();
    let finish: (value: { title: string; workItem: null }) => void = () => {};
    s.generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    s.coordinator.begin(s.get().id, "First prompt");
    s.coordinator.settled(s.get().id);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.generate).toHaveBeenCalledTimes(1);
    s.set({ ...s.get(), providerSessionId: "replacement" });
    finish({ title: "Retired result", workItem: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.get().title).not.toContain("Retired result");
    s.coordinator.close();
  });

  it("keeps immediate Pi generation valid when the first native binding arrives", async () => {
    const s = setup();
    s.set({ ...newSession("pi"), providerSessionId: undefined });
    let finish: (value: { title: string; workItem: null }) => void = () => {};
    s.generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    s.coordinator.begin(s.get().id, "First Pi prompt");
    await vi.waitFor(() => expect(s.generate).toHaveBeenCalledTimes(1));
    s.set({ ...s.get(), providerSessionId: "bound" });
    finish({ title: "Pi title", workItem: null });
    await vi.waitFor(() => expect(s.get().title).toBe("pi · Pi title"));
  });
  it("rejects an in-flight fallback after a manual rename", async () => {
    vi.useFakeTimers();
    const s = setup();
    let finish: (value: { title: string; workItem: null }) => void = () => {};
    s.generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    s.coordinator.begin(s.get().id, "First prompt");
    s.coordinator.settled(s.get().id);
    await vi.advanceTimersByTimeAsync(15_000);
    s.set(manualSessionTitle(s.get(), "My title"));
    finish({ title: "Late fallback", workItem: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.get().title).toBe("My title");
    s.coordinator.close();
  });
  it("does not generate when native metadata arrives after turn settlement", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.coordinator.begin(s.get().id, "First message");
    s.coordinator.settled(s.get().id);
    s.coordinator.native(s.get().id, "native", "Native title");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.generate).not.toHaveBeenCalled();
    expect(s.get().title).toBe("codex · Native title");
  });
  it("falls back once and preserves the attempt across coordinator recreation", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.coordinator.begin(s.get().id, "First message");
    s.coordinator.settled(s.get().id);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.generate).toHaveBeenCalledTimes(1);
    expect(s.get().titleState!.fallbackAttempted).toBe(true);
    s.coordinator.close();
    const restored = s.recreate();
    restored.begin(s.get().id, "First message");
    restored.settled(s.get().id);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.generate).toHaveBeenCalledTimes(1);
  });
  it("does not launch fallback after cancellation or a manual rename", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.coordinator.begin(s.get().id, "First message");
    s.coordinator.settled(s.get().id, true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.generate).not.toHaveBeenCalled();
    s.coordinator.begin(s.get().id, "First message");
    s.coordinator.settled(s.get().id);
    s.set(manualSessionTitle(s.get(), "My title"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.generate).not.toHaveBeenCalled();
  });
});
