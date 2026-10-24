import { homedir } from "node:os";
import { localMachineIO } from "./machine-io";
import { BinaryTransfers } from "./binary-transfers";
import { fetchPublicResource, type ResourceOptions } from "./public-http";
import { sniffImageMime } from "../src/domain/imageBytes";
import type { LinkPreviewMetadata } from "../src/contracts/hostMedia";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const githubSite = (host: string) => host === "github.com" || host === "www.github.com";

export function validateInboxMediaUrl(url: URL): void {
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  const path = url.pathname.toLowerCase();
  const attachment = githubSite(host) && (path.startsWith("/user-attachments/") || /^\/[^/]+\/[^/]+\/assets\/\d+(?:\/|$)/.test(path));
  const cdn = host === "githubusercontent.com" || host.endsWith(".githubusercontent.com");
  const linear = host === "uploads.linear.app" || host.endsWith(".uploads.linear.app");
  const s3 = (host.endsWith(".s3.amazonaws.com") || (host.includes(".s3.") && host.endsWith(".amazonaws.com"))) &&
    (host.startsWith("github-production-user-asset-") || host.startsWith("github-production-media.") || host.startsWith("github-production-media-"));
  if (url.protocol !== "https:" || url.username || url.password || !(attachment || cdn || linear || s3)) throw new Error("That media host is not allowed");
}

async function githubToken(): Promise<string | undefined> {
  try {
    const { stdout } = await localMachineIO.exec("gh", ["auth", "token"], {
      cwd: homedir(), timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PAGER: "cat" },
    });
    return stdout.trim() || undefined;
  } catch { return undefined; }
}

function inputUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 8192) throw new Error("URL is invalid");
  return value.trim();
}

function entities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, name: string) => {
    const simple: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    if (!name.startsWith("#")) return simple[name.toLowerCase()] ?? whole;
    const value = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : whole;
  });
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
    result[match[1].toLowerCase()] ??= entities(match[2] ?? match[3] ?? match[4]);
  return result;
}

export function parseLinkMetadata(html: string): { title: string | null; icon?: string } {
  const tags = [...html.matchAll(/<(?:meta|link)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)].map(match => ({ kind: /^<meta/i.test(match[0]) ? "meta" : "link", attrs: attributes(match[0]) }));
  const clean = (value: string | undefined): string | null => value ? Array.from(entities(value.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim()).slice(0, 240).join("") || null : null;
  const title = ["og:title", "twitter:title"].flatMap(key => tags.filter(tag => tag.kind === "meta" && (tag.attrs.property ?? tag.attrs.name)?.toLowerCase() === key).map(tag => clean(tag.attrs.content))).find(Boolean)
    ?? clean(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1]);
  const icon = tags.find(tag => tag.kind === "link" && tag.attrs.rel?.toLowerCase().split(/\s+/).includes("icon") && tag.attrs.href?.trim())?.attrs.href;
  return { title, ...(icon ? { icon } : {}) };
}

/** All network IO and optional GitHub credentials remain on the owning Host. */
export class HostMedia {
  private readonly transfers = new BinaryTransfers();
  constructor(private readonly ports: { fetch?: typeof fetchPublicResource; token?: typeof githubToken } = {}) {}

  async inbox(value: unknown, scope: string) {
    const raw = inputUrl(value);
    // Reject traversal before URL normalization can remove it.
    if (/(?:\/|%2f)(?:\.|%2e){2}(?:\/|%2f|[?#]|$)/i.test(raw)) throw new Error("Media URL is invalid");
    const url = new URL(raw);
    validateInboxMediaUrl(url);
    const token = githubSite(url.hostname.toLowerCase()) ? await (this.ports.token ?? githubToken)() : undefined;
    const response = await (this.ports.fetch ?? fetchPublicResource)(raw, {
      timeoutMs: 20_000, maxBytes: MAX_MEDIA_BYTES, accept: "image/*,video/*,*/*;q=0.1", userAgent: "OmniCode",
      validate: validateInboxMediaUrl,
      // Signed CDN URLs reject Authorization; cross-origin redirects never inherit it.
      headers: (current): Record<string, string> => token && githubSite(current.hostname.toLowerCase()) ? { Authorization: `Bearer ${token}` } : {},
    });
    const mime = response.contentType?.split(";")[0].trim().toLowerCase();
    if (mime && ["text/html", "text/javascript", "application/javascript", "application/xhtml+xml"].includes(mime)) throw new Error("That URL is not image or video media");
    if (!response.bytes.length) throw new Error("Media response was empty");
    return this.transfers.create(scope, response.bytes);
  }

  chunk(scope: string, params: Record<string, unknown>) { return this.transfers.read(scope, params.transfer, params.offset); }

  async preview(value: unknown): Promise<LinkPreviewMetadata> {
    const options: ResourceOptions = { timeoutMs: 7000, maxBytes: 512 * 1024, accept: "text/html,application/xhtml+xml;q=0.9", userAgent: "Mozilla/5.0 (compatible; OmniCode-LinkPreview/1.0)" };
    const fetch = this.ports.fetch ?? fetchPublicResource;
    const page = await fetch(inputUrl(value), options);
    if (page.contentType && !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(page.contentType)) return { title: null, faviconDataUrl: null };
    const metadata = parseLinkMetadata(page.bytes.toString("utf8"));
    const icons = [...new Set([metadata.icon, "/favicon.ico"].filter((value): value is string => !!value))];
    for (const icon of icons) {
      try {
        const response = await fetch(new URL(icon, page.url).href, { ...options, maxBytes: 256 * 1024, accept: "image/*,*/*;q=0.1" });
        const sniffed = sniffImageMime(response.bytes);
        const mime = sniffed && ["image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon"].includes(sniffed) ? sniffed :
          response.bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])) ? "image/x-icon" : undefined;
        if (mime) return { title: metadata.title, faviconDataUrl: `data:${mime};base64,${response.bytes.toString("base64")}` };
      } catch { /* An inaccessible or unsafe favicon must not discard the page title. */ }
    }
    return { title: metadata.title, faviconDataUrl: null };
  }
}
