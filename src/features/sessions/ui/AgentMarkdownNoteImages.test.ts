// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import { TranscriptPlatformContext } from "./TranscriptPlatform";
import { mobileTranscriptPlatform } from "../../../mobile/transcriptPlatform";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));

it("renders note assets through the mobile resolver and drops stale results when Hosts change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const asset = "/note-assets/n1/1-flow.png";
  let resolveOld!: (url: string) => void;
  const old = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        resolveOld = resolve;
      }),
  );
  const next = vi.fn(async () => "data:image/png;base64,Yg==");
  const render = (resolveNoteImage?: (asset: string) => Promise<string>) =>
    act(async () =>
      root.render(
        createElement(TranscriptPlatformContext.Provider, {
          value: { ...mobileTranscriptPlatform, resolveNoteImage },
          children: createElement(AgentMarkdown, { text: `![Flow](${asset})` }),
        }),
      ),
    );
  try {
    await render(old);
    expect(old).toHaveBeenCalledWith(asset);
    await render(next);
    await act(async () => resolveOld("data:image/png;base64,YQ=="));
    expect(node.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,Yg==",
    );
    expect(invoke).not.toHaveBeenCalled();
    await render();
    expect(node.querySelector("img")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});
