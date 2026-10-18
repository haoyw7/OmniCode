import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BotAvatar, botAvatarSeed } from "./BotAvatar";
it("keeps generated avatar geometry stable across renders and sizes", () => {
  const first = botAvatarSeed("研究员-α");
  expect(botAvatarSeed("研究员-α")).toEqual(first);
  expect(new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(botAvatarSeed(`bot-${i}`)))).size).toBeGreaterThan(10);
  for (const size of [24, 40, 72, 96] as const) {
    const markup = renderToStaticMarkup(createElement(BotAvatar, { bot: { id: "研究员-α" }, size }));
    expect(markup).toContain(first.shape); expect(markup).toContain(first.color);
    expect(markup.match(/<circle/g)).toHaveLength(2);
  }
});
it("preserves the configured emoji or text instead of generating a replacement", () => {
  const markup = renderToStaticMarkup(createElement(BotAvatar, { bot: { id: "a", avatar: "🦉" } }));
  expect(markup).toContain("🦉"); expect(markup).not.toContain("<svg");
});
