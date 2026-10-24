import { beforeEach, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ request: vi.fn(), descriptor: vi.fn() }));
vi.mock("./connections", () => ({ remoteRequest: ports.request }));
vi.mock("./remoteHostMetadata", () => ({ loadRemoteHostDescriptor: ports.descriptor }));
vi.mock("./remoteProjects", () => ({ sharedHostMachineId: () => "desktop-host", sharedHostEnvironment: () => "environment" }));
import { fetchHostInboxMedia, fetchHostLinkPreview } from "./hostMedia";

beforeEach(() => {
  ports.request.mockReset();
  ports.descriptor.mockReset().mockResolvedValue({ capabilities: ["media.inbox.v1", "links.preview.v1"] });
});

it("uses the verified local Host and assembles bounded media chunks", async () => {
  ports.request.mockImplementation(async (machine, method, params) => {
    expect(machine).toBe("desktop-host");
    if (method === "media.inbox") return { transfer: "media", size: 5 };
    if (method === "media.chunk") return params.offset === 0 ? { data: "YWJj", offset: 3, size: 5 } : { data: "ZGU=", offset: 5, size: 5 };
    return { title: "Title", faviconDataUrl: null };
  });
  expect(new TextDecoder().decode(await fetchHostInboxMedia("https://uploads.linear.app/x"))).toBe("abcde");
  expect(ports.descriptor).toHaveBeenCalledExactlyOnceWith("desktop-host", "environment");
  expect(await fetchHostLinkPreview("https://example.com")).toEqual({ title: "Title", faviconDataUrl: null });
});

it("refuses missing capabilities and corrupted transfers without retrying commands", async () => {
  ports.descriptor.mockResolvedValueOnce({ capabilities: [] });
  await expect(fetchHostInboxMedia("https://uploads.linear.app/x")).rejects.toThrow("Update Host");
  expect(ports.request).not.toHaveBeenCalled();
  ports.request.mockResolvedValueOnce({ transfer: "media", size: 5 }).mockResolvedValueOnce({ data: "YQ==", offset: 5, size: 5 });
  await expect(fetchHostInboxMedia("https://uploads.linear.app/x")).rejects.toThrow("Invalid media transfer");
  expect(ports.request).toHaveBeenCalledTimes(2);
});
