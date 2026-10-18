import { describe, expect, it } from "vitest";
import { chatFolderRelativePath, isChatFolder } from "./chatFolderPath";
import { collectRailProjects } from "./recents";

describe("projectless chat folders", () => {
  it("names a dated folder from local time and a six-character suffix", () => {
    const path = chatFolderRelativePath(new Date(2026, 9, 11, 14, 30, 52), () => 0.5);
    expect(path).toBe("2026-10-11/chat-143052-ssssss");
    expect(isChatFolder(`/home/me/Documents/ohmymonocode/${path}`)).toBe(true);
    expect(isChatFolder(`C:\\Users\\me\\Documents\\ohmymonocode\\${path.replace("/", "\\")}\\`)).toBe(true);
  });

  it("does not treat other folders as chats", () => {
    expect(isChatFolder("/home/me/Documents/ohmymonocode/2026-10-11")).toBe(false);
    expect(isChatFolder("/home/me/Documents/ohmymonocode/2026-10-11/project")).toBe(false);
    expect(isChatFolder("/workspace/chat-143052-abcdef")).toBe(false);
  });

  it("keeps chat folders off the project rail", () => {
    const chat = "/home/me/Documents/ohmymonocode/2026-10-11/chat-143052-abcdef";
    const rail = collectRailProjects([{ path: chat, openedAt: 1 }], chat);
    expect([...rail.values()]).toEqual([]);
  });
});
