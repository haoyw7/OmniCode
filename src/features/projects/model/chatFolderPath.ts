/** Projectless chats each get a dated folder under `~/<CHAT_ROOT>`. */
export const CHAT_ROOT = "Documents/ohmymonocode";

const CHAT_FOLDER =
  /(^|\/)Documents\/ohmymonocode\/\d{4}-\d{2}-\d{2}\/chat-\d{6}-[a-z0-9]{6}$/;

const pad = (value: number) => String(value).padStart(2, "0");

/** `yyyy-mm-dd/chat-HHmmss-xxxxxx`, relative to `~/<CHAT_ROOT>`, in local time. */
export function chatFolderRelativePath(
  now = new Date(),
  random: () => number = Math.random,
): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let suffix = "";
  for (let i = 0; i < 6; i++)
    suffix += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)];
  return `${date}/chat-${time}-${suffix}`;
}

/** A projectless chat folder, recognized by path on desktop, Host and mobile. */
export function isChatFolder(path: string): boolean {
  return CHAT_FOLDER.test(path.replace(/\\/g, "/").replace(/\/+$/, ""));
}
