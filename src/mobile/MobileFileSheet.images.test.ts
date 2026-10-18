// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../features/sessions/model/session";
import { MobileFileSheet } from "./MobileFileSheet";
import { MobileTranscript } from "./MobileTranscript";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

const png = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=",
), character => character.charCodeAt(0));

describe("mobile image files in the bottom sheet", () => {
  let root: Root;
  let app: HTMLDivElement;
  let blobs: Blob[];
  let revoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    app = document.createElement("div");
    app.className = "mobile-app";
    document.body.append(app);
    root = createRoot(app);
    blobs = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(blob => {
      blobs.push(blob as Blob);
      return `blob:image-${blobs.length}`;
    });
    revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    app.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderFile(path: string, readBinaryFile: (path: string) => Promise<Uint8Array>) {
    await act(async () => root.render(createElement(MobileFileSheet, {
      path,
      cwd: "/repo",
      readBinaryFile,
      onClose: () => {},
    })));
  }

  it("opens a Read tool's /tmp image chip directly in the bottom sheet", async () => {
    const path = "/tmp/monocode-image-preview/sheet.png";
    const session = newSession("claude", "/repo");
    session.blocks = [
      { id: "user", role: "user", text: "Show the image" },
      { id: "read", role: "tool", text: `Read ${path}`, tool: {
        kind: "read", status: "completed",
        preview: { kind: "read", path, fileName: "sheet.png" },
      } },
    ];
    const read = vi.fn(async () => png);
    await act(async () => root.render(createElement(MobileTranscript, {
      snapshot: { session, projectId: "project", revision: 1, status: "idle", updatedAt: 1 },
      disabled: false,
      onCommand: () => {},
      readBinaryFile: read,
    })));
    const chip = [...app.querySelectorAll("button")].find(button =>
      button.textContent?.includes("sheet.png"),
    );
    expect(chip).toBeDefined();
    await act(async () => chip!.click());
    expect(read).toHaveBeenCalledWith(path);
    const image = app.querySelector<HTMLImageElement>(".mobile-file-image");
    expect(image?.getAttribute("src")).toBe("blob:image-1");
    expect(image?.alt).toBe("sheet.png");
    expect(image?.closest('[role="dialog"]')?.getAttribute("aria-label")).toBe("File preview");
    expect(app.querySelector(".mobile-sheet-backdrop")?.getAttribute("data-placement")).toBe("bottom");
    expect(app.querySelector('[role="log"]')?.textContent).toContain("Show the image");
    expect(blobs[0].type).toBe("image/png");
    expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(png);
  });

  it.each([
    ["photo.JPG", new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"],
    ["animation.gif", new TextEncoder().encode("GIF89a"), "image/gif"],
    ["picture.webp", new TextEncoder().encode("RIFF0000WEBP"), "image/webp"],
    ["picture.avif", new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypavif")]), "image/avif"],
    ["picture.bmp", new Uint8Array([0x42, 0x4d]), "image/bmp"],
    ["favicon.ico", new Uint8Array([0, 0, 1, 0]), "image/x-icon"],
    ["attachment-without-extension", png, "image/png"],
    ["incorrect-extension.jpg", png, "image/png"],
    ["vector.svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml"],
  ])("previews %s with the correct MIME", async (name, bytes, mime) => {
    await renderFile(`/tmp/${name}`, async () => bytes);
    expect(app.querySelector(".mobile-file-image")).not.toBeNull();
    expect(blobs[0]?.type).toBe(mime);
  });

  it("previews images up to the Host's 10 MiB limit without applying the text limit", async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024);
    bytes.set(png);
    await renderFile("/tmp/large.png", async () => bytes);
    expect(app.querySelector(".mobile-file-image")).not.toBeNull();
    expect(blobs[0]?.size).toBe(bytes.length);
  });

  it("reports oversized images without allocating a blob URL", async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
    bytes.set(png);
    await renderFile("/tmp/too-large.png", async () => bytes);
    expect(app.querySelector(".mobile-file-sheet")?.textContent).toContain("File is too large to preview");
    expect(blobs).toHaveLength(0);
  });

  it("shows text for a mislabeled image instead of producing a broken image", async () => {
    await renderFile("/tmp/not-an-image.png", async () => new TextEncoder().encode("plain text"));
    expect(app.querySelector(".mobile-file-image")).toBeNull();
    expect(app.querySelector(".mobile-file-sheet")?.textContent).toContain("plain text");
    expect(blobs).toHaveLength(0);
  });

  it("reports an image the browser cannot decode", async () => {
    await renderFile("/tmp/corrupt.png", async () => png.subarray(0, 8));
    await act(async () => app.querySelector(".mobile-file-image")!.dispatchEvent(new Event("error")));
    expect(app.querySelector('[role="alert"]')?.textContent).toBe("Could not display this image.");
    expect(app.querySelector(".mobile-file-image")).toBeNull();
  });

  it("releases images when switching files and closing the sheet", async () => {
    const read = async () => png;
    await renderFile("/tmp/first.png", read);
    await renderFile("/tmp/second.png", read);
    expect(revoke).toHaveBeenCalledWith("blob:image-1");
    expect(app.querySelector(".mobile-file-image")?.getAttribute("src")).toBe("blob:image-2");
    await act(async () => root.render(null));
    expect(revoke).toHaveBeenCalledWith("blob:image-2");
  });

  it("ignores a late image read after another file has opened", async () => {
    let finish!: (bytes: Uint8Array) => void;
    const read = (path: string) => path.endsWith("first.png")
      ? new Promise<Uint8Array>(resolve => { finish = resolve; })
      : Promise.resolve(png);
    await renderFile("/tmp/first.png", read);
    await renderFile("/tmp/second.png", read);
    await act(async () => finish(png));
    expect(blobs).toHaveLength(1);
    expect(app.querySelector<HTMLImageElement>(".mobile-file-image")?.alt).toBe("second.png");
  });
});
