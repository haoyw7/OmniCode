// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { mobileLifecycle } from "./lifecycle";

const native = vi.hoisted(() => ({ callback: undefined as undefined | ((state: { isActive: boolean }) => void), remove: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/app", () => ({ App: { addListener: async (_event: string, callback: typeof native.callback) => {
  native.callback = callback;
  return { remove: native.remove };
} } }));

it("combines native foreground and document visibility, and removes listeners on disposal", async () => {
  const listener = vi.fn();
  const unsubscribe = mobileLifecycle.subscribe(listener);
  native.callback!({ isActive: false });
  expect(listener).toHaveBeenLastCalledWith(false);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(listener).toHaveBeenLastCalledWith(false);
  native.callback!({ isActive: true });
  expect(listener).toHaveBeenLastCalledWith(true);
  unsubscribe();
  await Promise.resolve();
  expect(native.remove).toHaveBeenCalledTimes(1);
  listener.mockClear();
  document.dispatchEvent(new Event("visibilitychange"));
  native.callback!({ isActive: false });
  expect(listener).not.toHaveBeenCalled();
});
