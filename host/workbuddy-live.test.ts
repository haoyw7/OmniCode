import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { HostChildBackend } from "./child-backend";
import { workBuddyAccounts } from "./workbuddy";
import { configureChildBackend, startHarnessBridge } from "../src/integrations/harness/core/child";
import { workbuddyAdapter } from "../src/integrations/harness/providers/workbuddy/workbuddyAdapter";
import type { HarnessEvent, SendTurnInput } from "../src/integrations/harness/core/types";

// Explicit opt-in: these tests use the installed desktop login and real model requests.
const enabled = process.env.OMNICODE_WORKBUDDY_LIVE === "1" && ["win32", "darwin"].includes(process.platform);
let root: string;
let backend: HostChildBackend;
let release: (() => void) | undefined;
beforeAll(() => {
  if (!enabled) return;
  root = mkdtempSync(join(tmpdir(), "omnicode-wb-live-"));
  backend = new HostChildBackend({}, undefined, undefined, join(root, "config"));
  configureChildBackend(backend);
  release = startHarnessBridge();
});
afterAll(async () => {
  if (!enabled) return;
  release?.();
  await backend.close();
  const resolved = realpathSync(root);
  if (!resolved.startsWith(realpathSync(tmpdir()) + sep)) throw new Error("Unsafe temporary cleanup");
  await rm(resolved, { recursive: true, force: true, maxRetries: 15, retryDelay: 250 });
}, 60000);

it.skipIf(!enabled)("discovers both regional model catalogs from the installed engines", async () => {
  const catalog = await backend.invoke<import("../src/integrations/harness/core/catalog").WorkBuddyCatalog>("harness_workbuddy_catalog");
  expect(catalog.errors).toEqual([]);
  expect(catalog.accounts.map(account => account.edition).sort()).toEqual(["cn", "global"]);
  expect(catalog.models.some(model => model.id.startsWith("workbuddy:cn:"))).toBe(true);
  expect(catalog.models.some(model => model.id.startsWith("workbuddy:global:"))).toBe(true);
  expect(JSON.stringify(catalog)).not.toMatch(/"(?:accessToken|refreshToken|token)":/);
}, 70000);

it.skipIf(!enabled).each(["cn", "global"] as const)("runs %s questions, warm turns, native resume and cancellation through the actual Host backend", async edition => {
  const account = workBuddyAccounts().find(a => a.edition === edition);
  expect(account).toBeDefined();
  const data = process.platform === "darwin" ? join(homedir(), "Library/Application Support") : process.env.LOCALAPPDATA!;
  const auth = join(data, "CodeBuddyExtension/Data/Public/auth", edition === "cn" ? "workbuddy-desktop.info" : "workbuddy-desktop-ai.info");
  const hash = () => createHash("sha256").update(readFileSync(auth)).digest("hex");
  const before = hash();
  const id = "wb-live-" + randomUUID();
  const events: HarnessEvent[] = [];
  let cancelAtQuestion = false;
  const input: SendTurnInput = {
    sessionId: id, cwd: root, model: edition === "cn" ? "workbuddy:cn:auto" : "workbuddy:global:fast-model",
    providerAccountId: account!.id, runtimeMode: "supervised", text: "",
    onEvent(event) {
      events.push(event);
      if (event.type !== "question.asked") return;
      if (cancelAtQuestion) { void workbuddyAdapter.cancelTurn(id); return; }
      const answers: Record<string, string[]> = {}, custom: Record<string, string> = {};
      for (const question of event.questions) {
        if (/code|custom/i.test(question.prompt)) { answers[question.id] = ["__custom__"]; custom[question.id] = "WB_CUSTOM_CODE"; }
        else answers[question.id] = question.options.slice(0, question.multiSelect ? 2 : 1).map(option => option.id);
      }
      workbuddyAdapter.respondQuestion!(id, event.requestId, { kind: "answered", answers, custom });
    },
  };
  const turn = async (text: string) => {
    const offset = events.length;
    await workbuddyAdapter.sendTurn({ ...input, text });
    return events.slice(offset).filter((event): event is Extract<HarnessEvent, { type: "message.delta" }> => event.type === "message.delta").map(event => event.text).join("");
  };
  try {
    const answered = await turn("Integration test. Use AskUserQuestion to ask these three questions together: Pick one letter (A or B); Pick several colors (Red, Blue or Green, multiSelect true); Enter a custom code (Preset or Other, free text allowed). Wait for the answers, then briefly repeat all answers. Do not use any other tools.");
    expect(events.some(event => event.type === "question.asked")).toBe(true);
    expect(events.some(event => event.type === "question.resolved" && event.decision === "answered")).toBe(true);
    expect(answered).toContain("WB_CUSTOM_CODE");
    expect(events.find(event => event.type === "session.providerBound")).toMatchObject({ providerAccountId: account!.id });
    const marker = "WB_MEMORY_" + edition.toUpperCase();
    await turn(`Remember this exact marker: ${marker}. Reply only STORED.`);
    await workbuddyAdapter.stopSession(id);
    const resumed = await turn("What is the exact marker I asked you to remember? Reply with the marker only, use no tools.");
    expect(resumed).toContain(marker);
    expect(resumed).not.toContain("STORED");
    cancelAtQuestion = true;
    await turn("Use AskUserQuestion to ask Wait or Continue, and wait for its answer. Do not answer it yourself.");
    expect(events.some(event => event.type === "question.resolved" && event.decision === "cancelled")).toBe(true);
    cancelAtQuestion = false;
    expect(await turn("Reply only AFTER_CANCEL. Use no tools.")).toContain("AFTER_CANCEL");
    expect(JSON.stringify(events)).not.toMatch(/"(?:accessToken|refreshToken|token)":/);
    expect(hash()).toBe(before);
  } finally { await workbuddyAdapter.forgetSession(id); }
}, 180000);

const imagegen = enabled && process.env.OMNICODE_WORKBUDDY_IMAGEGEN === "1";
it.skipIf(!imagegen)("receives and persists an actual generated image from WorkBuddy China", async () => {
  const { saveGeneratedImageAttachment } = await import("./attachments");
  const { HostStore } = await import("./store");
  const store = new HostStore(join(root, "images.db"));
  const account = workBuddyAccounts().find(a => a.edition === "cn")!;
  const id = "wb-imagegen-" + randomUUID();
  const events: HarnessEvent[] = [];
  try {
    await workbuddyAdapter.sendTurn({ sessionId: id, cwd: root, model: "workbuddy:cn:auto", providerAccountId: account.id,
      runtimeMode: "supervised", text: "Use the built-in ImageGen tool (discover it if needed) to generate one simple red circle on a white background. Save the output in the current working directory. Do not use shell commands or write scripts. Generate exactly one image, then finish.",
      onEvent(event) {
        events.push(event);
        if (event.type === "approval.requested") workbuddyAdapter.respondApproval(id, event.requestId, "allow");
      } });
    const image = events.find(e => e.type === "image.generated");
    expect(image).toBeDefined();
    if (image?.type !== "image.generated" || !("data" in image)) throw new Error("Missing generated image bytes");
    const attachment = saveGeneratedImageAttachment(store, image.data, image.name, image.mimeType);
    expect(existsSync(attachment.path!)).toBe(true);
    expect(attachment.size).toBeGreaterThan(100);
  } finally { await workbuddyAdapter.forgetSession(id); store.close(); }
}, 180000);

it.skipIf(!enabled).each(["cn", "global"] as const)("runs %s file permissions and image input through the actual Host backend", async edition => {
  const account = workBuddyAccounts().find(a => a.edition === edition)!;
  const cwd = join(root, edition); mkdirSync(cwd);
  const id = "wb-tools-" + randomUUID();
  const approved = join(cwd, "approved.txt"), denied = join(cwd, "denied.txt"), source = join(cwd, "read.txt");
  writeFileSync(source, "WB_READ_" + edition + "\n");
  const events: HarnessEvent[] = [];
  const input: SendTurnInput = { sessionId: id, cwd, model: edition === "cn" ? "workbuddy:cn:auto" : "workbuddy:global:fast-model",
    providerAccountId: account.id, runtimeMode: "supervised", text: "",
    onEvent(event) {
      events.push(event);
      if (event.type === "approval.requested") {
        const preview = JSON.stringify(event.preview);
        adapterReply(event.requestId, !preview.includes("denied.txt"));
      }
    },
  };
  const adapterReply = (requestId: number, allowed: boolean) => workbuddyAdapter.respondApproval(id, requestId, allowed ? "allow" : "deny");
  const turn = async (stage: string, options: Pick<SendTurnInput, "text" | "attachments">) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        workbuddyAdapter.sendTurn({ ...input, ...options }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`WorkBuddy ${edition} ${stage} timed out`)), 75000);
        }),
      ]);
    } finally { clearTimeout(timer); }
  };
  try {
    await turn("read/write", { text: `Use Read on ${JSON.stringify(source)} and repeat its full content. Then use Write to create ${JSON.stringify(approved)} with content WB_ALLOWED. Use only Read and Write.` });
    expect(events.filter(e => e.type === "tool.updated").map(e => e.detail ?? "").join("\n")).toContain("WB_READ_" + edition);
    expect(readFileSync(approved, "utf8")).toContain("WB_ALLOWED");
    // Native WorkBuddy may cancel the entire parallel batch when one tool is denied.
    // Separate turns verify each decision without depending on model scheduling.
    await turn("denial", { text: `Use Write to create ${JSON.stringify(denied)} with content WB_DENIED. If denied, stop immediately; do not retry or use another tool.` });
    expect(existsSync(denied)).toBe(false);
    expect(events.some(e => e.type === "approval.resolved" && e.decision === "allow")).toBe(true);
    expect(events.some(e => e.type === "approval.resolved" && e.decision === "deny")).toBe(true);
    const data = readFileSync(new URL("../tests/fixtures/generated-red.jpg.b64", import.meta.url), "utf8").trim();
    const offset = events.length;
    await turn("vision", { text: "What is the dominant color in the attached image? Reply with one English color word. Use no tools.",
      attachments: [{ id: "vision", kind: "image", name: "color.jpg", mimeType: "image/jpeg", data, size: Buffer.from(data, "base64").length }] });
    expect(events.slice(offset).filter(e => e.type === "message.delta").map(e => e.text).join("")).toMatch(/red/i);
  } catch (error) {
    console.error(JSON.stringify(events.filter(e => e.type === "tool.started" || e.type === "tool.updated" || e.type === "approval.resolved")));
    throw error;
  } finally { await workbuddyAdapter.forgetSession(id); }
}, 180000);
