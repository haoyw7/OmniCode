// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../shared/lib/queryClient";
import { SurfaceVisibilityContext } from "../../../shared/ui/SurfaceVisibility";
import { BotMessageImage } from "./BotMessageImage";
import { BotAttachmentCard } from "./BotAttachmentCard";
import type { RemoteAttachment } from "../../connections/model/protocol";

vi.mock("../../sessions/ui/AttachmentChip", () => ({ AttachmentChip: ({ attachment }: { attachment: { name: string; data?: string } }) => createElement("output", null, attachment.data ?? attachment.name) }));
vi.mock("../../connections/files/ui/FileTypeIcon", () => ({ FileTypeIcon: () => null }));
const file: RemoteAttachment = { id: "file", name: "image.png", mimeType: "image/png", size: 3, kind: "image" };
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  queryClient.clear(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("shares visible image reads, pauses hidden views and isolates Host readers", async () => {
  let finish!: (value: string) => void;
  const first = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const second = vi.fn().mockResolvedValue("new-host");
  const render = (visible: boolean, read: typeof second) => act(async () => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible },
    ...["a", "b"].map(key => createElement(BotMessageImage, { key, messageId: "message", file, readImage: read })),
  )));
  await render(false, first);
  expect(first).not.toHaveBeenCalled();
  await render(true, first);
  expect(first).toHaveBeenCalledTimes(1);
  await render(true, second);
  await act(async () => finish("old-host"));
  expect(second).toHaveBeenCalledTimes(1);
  expect([...container.querySelectorAll("output")].map(el => el.textContent)).toEqual(["new-host", "new-host"]);
});

it("keeps the filename after an image failure and retries when shown again", async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("image");
  const render = (visible: boolean) => act(async () => root.render(createElement(SurfaceVisibilityContext.Provider, { value: visible }, createElement(BotMessageImage, { messageId: "message", file, readImage: read }))));
  await render(true);
  expect(container.textContent).toBe("image.png");
  await render(false);
  await render(true);
  expect(container.textContent).toBe("image");
});

it("retries download failures and releases the exported bytes", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("YWJj");
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await act(async () => root.render(createElement(BotAttachmentCard, { file, read })));
  const download = container.querySelector<HTMLButtonElement>('[aria-label="Download image.png"]')!;
  await act(async () => download.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("offline");
  await act(async () => download.click());
  expect(click).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:download");
});
