// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SshTargetInput } from "./SshTargetInput";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
let picked = "";
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke).mockResolvedValue([
    { alias: "vps", hostName: "47.122.127.145", user: "root" },
    { alias: "wy-win", hostName: "100.69.154.36" },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Field() {
  const [value, setValue] = useState("");
  picked = value;
  return createElement(SshTargetInput, { value, onChange: setValue, className: "" });
}
const options = () => [...document.querySelectorAll('[role="option"]')].map((item) => item.textContent);

it("suggests configured SSH hosts, filters them as you type and picks with Enter", async () => {
  await act(async () => root.render(createElement(Field)));
  const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  await act(async () => input.focus());
  expect(options()).toEqual(["vpsroot@47.122.127.145", "wy-win100.69.154.36"]);

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "win");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(options()).toEqual(["wy-win100.69.154.36"]);

  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(picked).toBe("wy-win");
});
