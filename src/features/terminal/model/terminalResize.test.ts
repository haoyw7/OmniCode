import { expect, it, vi } from "vitest";
import { createTerminalResize } from "./terminalResize";

it("sends the latest size without stacking in-flight requests", async () => {
  let finish!: () => void;
  const send = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const resize = createTerminalResize(send);
  resize.request(80, 24);
  resize.request(90, 28);
  resize.request(100, 30);
  expect(send).toHaveBeenCalledExactlyOnceWith(80, 24);
  finish();
  await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith(100, 30);
  resize.request(100, 30);
  finish();
  await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(2);
  resize.request(80, 24);
  expect(send).toHaveBeenLastCalledWith(80, 24);
  resize.dispose();
  finish();
});

it("retries a failed size when requested again", async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const resize = createTerminalResize(send);
  resize.request(80, 24);
  await Promise.resolve();
  resize.request(80, 24);
  await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(2);
  resize.request(80, 24);
  expect(send).toHaveBeenCalledTimes(2);
  resize.dispose();
});

it("discards pending sizes when the terminal closes", async () => {
  let finish!: () => void;
  const send = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const resize = createTerminalResize(send);
  resize.request(80, 24);
  resize.request(100, 30);
  resize.dispose();
  finish();
  await Promise.resolve();
  resize.request(120, 40);
  expect(send).toHaveBeenCalledExactlyOnceWith(80, 24);
});
