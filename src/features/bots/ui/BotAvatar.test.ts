import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BotAvatar } from "./BotAvatar";
import { botAvatarAppearance, encodeBotAvatar, decodeBotAvatar, avatarShapes, avatarExpressions, avatarVariants, avatarTones } from "./botAvatarAppearance";
it("uses the shared Omi artwork for default avatars at every supported size", () => {
  for (const size of [24, 40, 72, 96] as const) {
    const markup = renderToStaticMarkup(createElement(BotAvatar, { bot: { id: "研究员-α" }, size }));
    expect(markup).toContain('data-ui="omi"');
    expect(markup).toContain(`width="${size}"`);
    expect(markup).toContain(`height="${size}"`);
    expect(markup).toContain(`data-expression="${botAvatarAppearance("研究员-α").expression}"`);
    expect(markup).toContain('data-animated="true"');
  }
});
it("assigns varied Omi expressions and colors consistently from the Bot identity", () => {
  const identities = Array.from({ length: 128 }, (_, index) => `bot-${index}`);
  const appearances = identities.map(botAvatarAppearance);
  expect(identities.map(botAvatarAppearance)).toEqual(appearances);
  expect(new Set(appearances.map(value => value.expression)).size).toBe(8);
  expect(new Set(appearances.map(value => value.tone)).size).toBe(6);
  expect(new Set(appearances.map(value => value.shape)).size).toBe(4);
  expect(new Set(appearances.map(value => value.variant)).size).toBe(2);
  expect(new Set(appearances.map(value => JSON.stringify(value))).size).toBeGreaterThan(24);
  const adjacentShapes = Array.from({ length: 16 }, (_, index) => botAvatarAppearance(`demo-${index}`).shape);
  expect(new Set(adjacentShapes).size).toBe(4);
});
it("preserves the configured emoji or text instead of generating a replacement", () => {
  const markup = renderToStaticMarkup(createElement(BotAvatar, { bot: { id: "a", avatar: "🦉" } }));
  expect(markup).toContain("🦉"); expect(markup).not.toContain("<svg");
});
it("round-trips all Omi combinations within the existing Host avatar limit", () => {
  for (const shape of avatarShapes) for (const expression of avatarExpressions) for (const variant of avatarVariants) for (const tone of avatarTones) {
    const appearance = { shape, expression, variant, tone };
    const encoded = encodeBotAvatar(appearance);
    expect(encoded.length).toBe(8);
    expect(decodeBotAvatar(encoded)).toEqual(appearance);
  }
  for (const text of [undefined, "", "omi:9999", "omi:0000x", "hello", "🦉"]) expect(decodeBotAvatar(text)).toBeUndefined();
});
it("renders saved Omi selections independently of the Bot identity", () => {
  const markup = renderToStaticMarkup(createElement(BotAvatar, { bot: { id: "another-bot", avatar: "omi:3311" } }));
  expect(markup).toContain('data-shape="square"');
  expect(markup).toContain('data-expression="joyful"');
  expect(markup).toContain('data-variant="filled"');
  expect(markup).toContain('--color-omi-blue');
  expect(markup).not.toContain('omi:3311');
});
