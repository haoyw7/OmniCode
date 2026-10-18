import { expect, it, vi } from "vitest";
import { supportsProjectTerminal } from "./terminalAvailability";

const platform = vi.hoisted(() => ({ IS_WIN: true }));
vi.mock("../../../platform/tauri/platform", () => platform);

it("offers Windows and WSL terminals without enabling remote Host terminals", () => {
  expect(supportsProjectTerminal("C:/code/app")).toBe(true);
  expect(supportsProjectTerminal("wsl://Ubuntu-26.04/home/wy/app")).toBe(true);
  expect(supportsProjectTerminal("remote://host/home/wy/app")).toBe(false);
  expect(supportsProjectTerminal("wsl://bad%2Fname/home")).toBe(false);
  expect(supportsProjectTerminal("~")).toBe(false);
});

it("does not offer WSL terminals on another desktop platform", () => {
  platform.IS_WIN = false;
  try {
    expect(supportsProjectTerminal("wsl://Ubuntu/home/wy/app")).toBe(false);
    expect(supportsProjectTerminal("/home/wy/app")).toBe(true);
  } finally { platform.IS_WIN = true; }
});
