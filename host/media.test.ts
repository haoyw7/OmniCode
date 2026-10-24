import { expect, it, vi } from "vitest";
import { createPublicFetcher, isPublicAddress } from "./public-http";
import { HostMedia, parseLinkMetadata } from "./media";
import { BinaryTransfers } from "./binary-transfers";

const publicDns = async () => [{ address: "8.8.8.8", family: 4 }];
const options = { timeoutMs: 1000, maxBytes: 32, accept: "*/*", userAgent: "test" };

it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "::ffff:a00:1", "fc00::1", "fe80::1", "2001:db8::1"])("rejects private, local and mapped addresses: %s", address => {
  expect(isPublicAddress(address)).toBe(false);
});

it("pins checked DNS results and validates redirects before fetching a private destination", async () => {
  const request = vi.fn(async (_url, params) => {
    expect(params.addresses).toEqual([{ address: "8.8.8.8", family: 4 }]);
    return { status: 302, location: "http://127.0.0.1/private", bytes: Buffer.alloc(0) };
  });
  const fetch = createPublicFetcher({ resolve: publicDns, request });
  await expect(fetch("https://public.example/page", options)).rejects.toThrow("Private addresses");
  expect(request).toHaveBeenCalledOnce();
});

it("rejects credentialed URLs, local domains, mixed DNS and over-limit responses", async () => {
  const request = vi.fn(async () => ({ status: 200, bytes: Buffer.alloc(33) }));
  const fetch = createPublicFetcher({ resolve: publicDns, request });
  await expect(fetch("https://user:secret@example.com", options)).rejects.toThrow("invalid");
  await expect(fetch("https://machine.local/page", options)).rejects.toThrow("Local addresses");
  expect(request).not.toHaveBeenCalled();
  const mixed = createPublicFetcher({ resolve: async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }], request });
  await expect(mixed("https://example.com", options)).rejects.toThrow("Private addresses");
  expect(request).not.toHaveBeenCalled();
  await expect(fetch("https://example.com", options)).rejects.toThrow("too large");
});

it("bounds redirects and total request time, including DNS lookup", async () => {
  const request = vi.fn(async () => ({ status: 302, location: "/again", bytes: Buffer.alloc(0) }));
  await expect(createPublicFetcher({ resolve: publicDns, request })("https://example.com", options)).rejects.toThrow("Too many redirects");
  expect(request).toHaveBeenCalledTimes(6);
  vi.useFakeTimers();
  try {
    const pending = createPublicFetcher({ resolve: () => new Promise(() => {}), request })("https://example.com", options);
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  } finally { vi.useRealTimers(); }
});

it("keeps GitHub credentials on the GitHub attachment hop and transfers immutable chunks only to the owner", async () => {
  const request = vi.fn(async (url, params) => {
    if (url.hostname === "github.com") {
      expect(params.headers.Authorization).toBe("Bearer local-secret");
      return { status: 302, location: "https://private-user-images.githubusercontent.com/image?jwt=signed", bytes: Buffer.alloc(0) };
    }
    expect(params.headers).not.toHaveProperty("Authorization");
    return { status: 200, contentType: "image/png", bytes: Buffer.from("image") };
  });
  const media = new HostMedia({ fetch: createPublicFetcher({ resolve: publicDns, request }), token: async () => "local-secret" });
  const transfer = await media.inbox("https://github.com/user-attachments/assets/1", "device-a");
  expect(transfer.size).toBe(5);
  expect(() => media.chunk("device-b", { ...transfer, offset: 0 })).toThrow("expired");
  const chunk = media.chunk("device-a", { ...transfer, offset: 0 });
  expect(chunk).toEqual({ data: "aW1hZ2U=", offset: 5, size: 5 });
  expect(media.chunk("device-a", { ...transfer, offset: 0 })).toEqual(chunk);
  expect(request).toHaveBeenCalledTimes(2);
});

it("rejects non-media hosts, insecure or cross-host redirects, traversal and HTML bodies", async () => {
  const request = vi.fn(async () => ({ status: 302, location: "https://evil.example/pixel", bytes: Buffer.alloc(0) }));
  const token = vi.fn(async () => "secret");
  const media = new HostMedia({ fetch: createPublicFetcher({ resolve: publicDns, request }), token });
  for (const url of ["https://evil.example/x", "http://github.com/user-attachments/x", "https://github.com/user-attachments/../login"])
    await expect(media.inbox(url, "device")).rejects.toThrow();
  expect(token).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  await expect(media.inbox("https://uploads.linear.app/x", "device")).rejects.toThrow("not allowed");
  expect(request).toHaveBeenCalledOnce();
  const html = new HostMedia({ fetch: createPublicFetcher({ resolve: publicDns, request: async () => ({ status: 200, contentType: "text/html", bytes: Buffer.from("<html>") }) }) });
  await expect(html.inbox("https://uploads.linear.app/x", "device")).rejects.toThrow("not image or video");
});

it("preserves title metadata and ignores an unsafe favicon without contacting private services", async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const request = vi.fn(async (url) => url.pathname === "/favicon.ico"
    ? { status: 200, contentType: "image/png", bytes: png }
    : { status: 200, contentType: "text/html", bytes: Buffer.from('<meta property="og:title" content="A &amp; B"><title>Fallback</title><link rel="icon" href="http://127.0.0.1/private">') });
  const media = new HostMedia({ fetch: createPublicFetcher({ resolve: publicDns, request }) });
  expect(await media.preview("https://example.com/page")).toEqual({ title: "A & B", faviconDataUrl: `data:image/png;base64,${png.toString("base64")}` });
  expect(request.mock.calls.map(call => call[0].hostname)).toEqual(["example.com", "example.com"]);
  expect(parseLinkMetadata('<META name="twitter:title" content="A > B &#x1F600;"><title>fallback</title>')).toEqual({ title: "A > B 😀" });
});

it("expires byte transfers and keeps each retry below the RPC limit", () => {
  vi.useFakeTimers();
  try {
    const transfers = new BinaryTransfers();
    const bytes = Buffer.alloc(1024 * 1024 + 1, 17);
    const descriptor = transfers.create("owner", bytes);
    const first = transfers.read("owner", descriptor.transfer, 0);
    expect(Buffer.from(first.data, "base64").length).toBeLessThan(512 * 1024);
    expect(first.offset % 3).toBe(0);
    expect(transfers.read("owner", descriptor.transfer, 0)).toEqual(first);
    vi.advanceTimersByTime(120_001);
    expect(() => transfers.read("owner", descriptor.transfer, 0)).toThrow("expired");
  } finally { vi.useRealTimers(); }
});
