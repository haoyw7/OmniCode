// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../../shared/lib/queryClient";
import { GitlabSettings } from "./InboxIntegrationSettings";
import { gitlabConnected, saveGitlabConfig } from "../../../inbox/model/gitlab";
import { setUiLanguage } from "../../../../shared/i18n/language";

vi.mock("../../../inbox/model/gitlab", async original => ({
  ...await original<object>(), gitlabConnected: vi.fn(), saveGitlabConfig: vi.fn(),
}));
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  queryClient.clear(); vi.clearAllMocks(); setUiLanguage("en");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount()); queryClient.clear(); node.remove(); vi.unstubAllGlobals();
});
const input = async (index: number, value: string) => act(async () => {
  const element = node.querySelectorAll("input")[index];
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
});
it("preserves an edited server URL when the initial status arrives late", async () => {
  let finish!: (value: Awaited<ReturnType<typeof gitlabConnected>>) => void;
  vi.mocked(gitlabConnected).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(createElement(GitlabSettings)));
  await input(0, "https://my-gitlab.example");
  await act(async () => finish({ connected: false, url: "https://gitlab.com" }));
  expect(node.querySelector("input")?.value).toBe("https://my-gitlab.example");
});
it("shows a native string failure and permits retry without clearing the token", async () => {
  vi.mocked(gitlabConnected).mockResolvedValue({ connected: false, url: "https://gitlab.com" });
  vi.mocked(saveGitlabConfig).mockRejectedValueOnce("native authentication failed")
    .mockResolvedValueOnce({ connected: true, url: "https://gitlab.com" });
  await act(async () => root.render(createElement(GitlabSettings)));
  await input(1, "token");
  const connect = () => [...node.querySelectorAll("button")].find(button => button.textContent === "Connect")!;
  await act(async () => connect().click());
  expect(node.textContent).toContain("native authentication failed");
  expect(node.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("token");
  await act(async () => connect().click());
  expect(node.textContent).toContain("Disconnect");
  expect(node.textContent).not.toContain("native authentication failed");
});
