// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { useComposerEnvironment } from "./useComposerEnvironment";
import { clearComposerDraft } from "../model/draftCache";
import { showStatusToast } from "../../../shared/ui/StatusToast";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../../shared/ui/StatusToast", () => ({ showStatusToast: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
let environment: ReturnType<typeof useComposerEnvironment>;
const onCwdChange = vi.fn();
function Harness({ cwd = "C:/code/app", sessionId = "draft" }: { cwd?: string; sessionId?: string }) {
  environment = useComposerEnvironment(sessionId, cwd, onCwdChange);
  return null;
}
const render = (props = {}) => act(async () => root.render(createElement(StrictMode, null, createElement(Harness, props))));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearComposerDraft("draft"); clearComposerDraft("other");
  vi.mocked(open).mockReset().mockResolvedValue("\\\\wsl.localhost\\Debian\\home\\dev");
  vi.mocked(showStatusToast).mockReset(); onCwdChange.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

it("chooses only the environment, and opens its folder picker separately", async () => {
  await render();
  await act(async () => environment.select("Debian"));
  expect(environment.distribution).toBe("Debian");
  expect(environment.needsProject).toBe(true);
  expect(open).not.toHaveBeenCalled();
  expect(onCwdChange).not.toHaveBeenCalled();
  await act(async () => environment.pickFolder());
  expect(open).toHaveBeenCalledExactlyOnceWith({ directory: true, multiple: false,
    defaultPath: "\\\\wsl.localhost\\Debian\\", title: "Open a WSL project" });
  expect(onCwdChange).toHaveBeenCalledWith("wsl://Debian/home/dev");
  await render({ cwd: "wsl://Debian/home/dev" });
  expect(environment.needsProject).toBe(false);
  expect(environment.distribution).toBe("Debian");
});

it("keeps the draft environment across remounts without affecting another session", async () => {
  await render();
  await act(async () => environment.select("Debian"));
  await act(async () => root.render(null));
  await render();
  expect(environment.distribution).toBe("Debian");
  await render({ sessionId: "other" });
  expect(environment.distribution).toBeNull();
  await render();
  expect(environment.distribution).toBe("Debian");
  await act(async () => environment.select(null));
  expect(environment.needsProject).toBe(false);
  expect(onCwdChange).not.toHaveBeenCalled();
});

it("keeps the selected environment when folder selection is cancelled and permits retry", async () => {
  await render();
  await act(async () => environment.select("Debian"));
  vi.mocked(open).mockResolvedValueOnce(null);
  await act(async () => environment.pickFolder());
  expect(environment.needsProject).toBe(true);
  expect(onCwdChange).not.toHaveBeenCalled();
  await act(async () => environment.pickFolder());
  expect(onCwdChange).toHaveBeenCalledOnce();
});

it("rejects folders outside the selected distribution", async () => {
  await render();
  await act(async () => environment.select("Debian"));
  vi.mocked(open).mockResolvedValueOnce("C:/code/app");
  await act(async () => environment.pickFolder());
  expect(onCwdChange).not.toHaveBeenCalled();
  expect(showStatusToast).toHaveBeenCalledWith("Choose a folder inside the selected WSL distribution.", "error");
});

it.each(["unmount", "environment", "session"])("ignores a late folder result after changing %s", async (change) => {
  await render();
  await act(async () => environment.select("Debian"));
  let complete!: (value: string) => void;
  vi.mocked(open).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = environment.pickFolder(); void environment.pickFolder(); });
  if (change === "unmount") await act(async () => root.render(null));
  else if (change === "session") await render({ sessionId: "other" });
  else await act(async () => environment.select("Ubuntu"));
  await act(async () => { complete("\\\\wsl.localhost\\Debian\\home\\dev"); await pending; });
  expect(open).toHaveBeenCalledOnce();
  expect(onCwdChange).not.toHaveBeenCalled();
});
