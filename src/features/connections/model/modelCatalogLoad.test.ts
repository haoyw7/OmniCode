import { afterEach, expect, it, vi } from "vitest";
import { ModelCatalogLoad } from "../../../client/modelCatalogLoad";
import type { HostModelCatalog } from "../../../contracts/protocol";

afterEach(() => vi.useRealTimers());

const codex = { id: "codex:fast", harness: "codex" as const, name: "Fast" };
const pi = { id: "pi:slow", harness: "pi" as const, name: "Slow" };

it("publishes fast models and shares them with late observers before slow discovery finishes", async () => {
  vi.useFakeTimers();
  const partial: HostModelCatalog = { models: { codex: [codex] }, errors: {}, pending: ["pi"] };
  const read = vi.fn()
    .mockResolvedValueOnce(partial)
    .mockResolvedValueOnce({ models: {}, errors: {}, pending: ["pi"] })
    .mockResolvedValueOnce({ models: { pi: [pi] }, errors: {}, pending: [] });
  const publish = vi.fn();
  const load = new ModelCatalogLoad(read, publish);
  const first = vi.fn();
  const result = load.observe(first);
  await vi.advanceTimersByTimeAsync(0);
  expect(first).toHaveBeenCalledWith(partial);
  const late = vi.fn();
  const second = load.observe(late);
  expect(late).toHaveBeenCalledWith(partial);
  await vi.advanceTimersByTimeAsync(500);
  expect(first).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenLastCalledWith({ progressive: true, providers: ["pi"] });
  await vi.advanceTimersByTimeAsync(500);
  expect(await result).toEqual({ models: { codex: [codex], pi: [pi] }, errors: {}, pending: [] });
  expect(await second).toBe(await result);
  expect(publish).toHaveBeenCalledTimes(2);
});

it("preserves completed models when another provider fails, and accepts older Hosts", async () => {
  vi.useFakeTimers();
  const read = vi.fn()
    .mockResolvedValueOnce({ models: { codex: [codex] }, errors: {}, pending: ["pi"] })
    .mockResolvedValueOnce({ models: {}, errors: { pi: "Login required" }, pending: [] });
  const load = new ModelCatalogLoad(read);
  await vi.advanceTimersByTimeAsync(500);
  expect(await load.promise).toEqual({ models: { codex: [codex] }, errors: { pi: "Login required" }, pending: [] });
  const oldCatalog = { models: { codex: [codex] }, errors: {} };
  const oldRead = vi.fn().mockResolvedValue(oldCatalog);
  expect(await new ModelCatalogLoad(oldRead).promise).toBe(oldCatalog);
  expect(oldRead).toHaveBeenCalledOnce();
});

it("bounds polling when a provider never finishes", async () => {
  vi.useFakeTimers();
  const load = new ModelCatalogLoad(vi.fn().mockResolvedValue({ models: {}, errors: {}, pending: ["pi"] }));
  const result = expect(load.promise).rejects.toThrow("Model discovery timed out");
  await vi.advanceTimersByTimeAsync(90_000);
  await result;
  expect(vi.getTimerCount()).toBe(0);
});
