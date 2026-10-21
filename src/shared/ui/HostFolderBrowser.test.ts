// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../lib/queryClient";
import { HostFolderBrowser, type HostFolderListing } from "./HostFolderBrowser";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  container.remove();
  vi.unstubAllGlobals();
});

const listing = (path: string): HostFolderListing => ({
  path,
  parent: null,
  entries: [],
});
async function enter(path: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, path);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

it("keeps the latest directory when navigation responses arrive out of order", async () => {
  const pending = new Map<string, (value: HostFolderListing) => void>();
  const browse = vi.fn((path?: string) =>
    path
      ? new Promise<HostFolderListing>((resolve) => pending.set(path, resolve))
      : Promise.resolve(listing("/home")),
  );
  await act(async () =>
    root.render(
      createElement(HostFolderBrowser, {
        browse,
        disabled: false,
        pickLabel: "Pick",
        onPick: vi.fn(),
        onCancel: vi.fn(),
      }),
    ),
  );
  await enter("/slow");
  await enter("/fast");
  await act(async () => pending.get("/fast")!(listing("/fast/canonical")));
  await act(async () => pending.get("/slow")!(listing("/slow/canonical")));
  expect(container.querySelector("input")!.value).toBe("/fast/canonical");
});

it("does not carry directory data between Hosts and ignores a previous Host's response", async () => {
  let finish!: (value: HostFolderListing) => void;
  const first = () =>
    new Promise<HostFolderListing>((resolve) => {
      finish = resolve;
    });
  const props = {
    disabled: false,
    pickLabel: "Pick",
    onPick: vi.fn(),
    onCancel: vi.fn(),
  };
  await act(async () =>
    root.render(
      createElement(HostFolderBrowser, {
        key: "first",
        browse: first,
        ...props,
      }),
    ),
  );
  await act(async () =>
    root.render(
      createElement(HostFolderBrowser, {
        key: "second",
        browse: async () => listing("/second"),
        ...props,
      }),
    ),
  );
  await act(async () => finish(listing("/first")));
  expect(container.querySelector("input")!.value).toBe("/second");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Pick")!
      .click(),
  );
  expect(props.onPick).toHaveBeenCalledWith("/second");
});
