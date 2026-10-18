// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({ readBinaryFile: mocks.read }));
import { GeneratedImage } from "./GeneratedImage";
import { TranscriptPlatformContext } from "./TranscriptPlatform";

it("uses the client platform reader for existing generated images", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const read = vi.fn().mockResolvedValue(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:host-image");
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(TranscriptPlatformContext.Provider, {
          value: {
            copyMessage: vi.fn(),
            copyText: vi.fn(),
            openExternal: vi.fn(),
            readBinaryFile: read,
            localFiles: false,
          },
        }, createElement(GeneratedImage, {
          image: { path: "/host/image.png", name: "saved.png", mimeType: "image/png", size: 8 },
        })),
      ),
    );
    expect(read).toHaveBeenCalledWith("/host/image.png");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:host-image");
    expect(mocks.read).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(revokeUrl).toHaveBeenCalledWith("blob:host-image");
  } finally {
    act(() => root.unmount());
    createUrl.mockRestore();
    revokeUrl.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("renders remote preview bytes without reading a private Host path", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        createElement(GeneratedImage, {
          image: {
            path: "/private/host/image",
            name: "saved.png",
            mimeType: "image/png",
            size: 5,
          },
          attachment: {
            id: "asset",
            name: "saved.png",
            mimeType: "image/png",
            kind: "image",
            size: 5,
            data: "aW1hZ2U=",
          },
        }),
      ),
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,aW1hZ2U=",
    );
    expect(mocks.read).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
