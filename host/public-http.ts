import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const denied = new BlockList();
for (const [address, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["127.0.0.0", 8], ["100.64.0.0", 10],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const)
  denied.addSubnet(address, bits, "ipv4");
for (const [address, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10],
  ["fec0::", 10], ["ff00::", 8], ["2001:db8::", 32]] as const) denied.addSubnet(address, bits, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return !!family && !denied.check(address, family === 4 ? "ipv4" : "ipv6");
}

type Address = { address: string; family: number };
type Response = { status: number; location?: string; contentType?: string; bytes: Buffer };
type RequestOptions = { headers: Record<string, string>; addresses: Address[]; maxBytes: number; signal: AbortSignal };
type Transport = (url: URL, options: RequestOptions) => Promise<Response>;

const request: Transport = (url, options) => new Promise((resolve, reject) => {
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const req = send(url, {
    headers: options.headers, signal: options.signal,
    // Pin the addresses already checked below; a second DNS lookup could rebind to a private address.
    lookup: (_hostname, settings, done) => {
      const addresses = options.addresses;
      if (settings.all) done(null, addresses);
      else done(null, addresses[0].address, addresses[0].family);
    },
  }, response => {
    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status)) {
      response.destroy();
      resolve({ status, location: response.headers.location, bytes: Buffer.alloc(0) });
      return;
    }
    const length = Number(response.headers["content-length"]);
    if (Number.isFinite(length) && length > options.maxBytes) {
      response.destroy(); reject(new Error("Response is too large")); return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxBytes) { response.destroy(); reject(new Error("Response is too large")); }
      else chunks.push(chunk);
    });
    response.on("error", () => reject(new Error("Could not read response")));
    response.on("end", () => resolve({ status, contentType: response.headers["content-type"], bytes: Buffer.concat(chunks) }));
  });
  req.on("error", () => reject(new Error("Could not load remote resource")));
  req.end();
});

export type ResourceOptions = {
  timeoutMs: number;
  maxBytes: number;
  accept: string;
  userAgent: string;
  validate?: (url: URL) => void;
  headers?: (url: URL) => Record<string, string>;
};

/** No credentials, private addresses, unbounded bodies, or unchecked redirect hops. */
export function createPublicFetcher(ports: {
  resolve?: (host: string) => Promise<Address[]>;
  request?: Transport;
} = {}) {
  return async (raw: string, options: ResourceOptions) => {
    if (!raw.trim() || raw.length > 8192 || /[\u0000-\u0020\\]/.test(raw.trim())) throw new Error("URL is invalid");
    let url: URL;
    try { url = new URL(raw.trim()); } catch { throw new Error("URL is invalid"); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Remote resource request timed out")), { once: true }));
    const resolve = ports.resolve ?? ((host: string) => lookup(host, { all: true }));
    const run = async () => {
      for (let hop = 0; hop <= 5; hop++) {
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("URL target is invalid");
        const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
        if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Local addresses cannot be previewed");
        options.validate?.(url);
        const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
        if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) throw new Error("Private addresses cannot be previewed");
        if (controller.signal.aborted) throw new Error("Remote resource request timed out");
        const response = await (ports.request ?? request)(url, {
          addresses, maxBytes: options.maxBytes, signal: controller.signal,
          headers: { Accept: options.accept, "User-Agent": options.userAgent, ...(options.headers?.(url) ?? {}) },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (!response.location || response.location.length > 8192) throw new Error("Redirect destination is invalid");
          url = new URL(response.location, url);
          continue;
        }
        if (response.status < 200 || response.status >= 300) throw new Error(`Remote resource request failed (${response.status})`);
        if (response.bytes.length > options.maxBytes) throw new Error("Response is too large");
        return { url, ...response };
      }
      throw new Error("Too many redirects");
    };
    try { return await Promise.race([run(), aborted]); }
    finally { clearTimeout(timer); }
  };
}

export const fetchPublicResource = createPublicFetcher();
