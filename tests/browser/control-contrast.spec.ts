import { expect, test, type Locator } from "@playwright/test";

const lightSkins = ["daylight", "atelier", "lagoon", "linen", "meadow"];
const darkSkins = ["ripple", "midnight", "foundry", "graphite", "dusk", "black"];

// Read rendered colors, including inherited control tokens and translucent
// surfaces. Checking palette hex values alone missed light text on light inputs.
async function textContrast(locator: Locator, placeholder = false) {
  return locator.evaluate((element, usePlaceholder) => {
    const context = document.createElement("canvas").getContext("2d")!;
    function rgba(value: string) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).map((v, i) => i === 3 ? v / 255 : v);
    }
    function over(foreground: number[], background: number[]) {
      return foreground.slice(0, 3).map((v, i) => v * foreground[3] + background[i] * (1 - foreground[3]));
    }
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors) background = over(rgba(getComputedStyle(node).backgroundColor), background);
    const style = getComputedStyle(element, usePlaceholder ? "::placeholder" : null);
    const ink = rgba(style.color);
    ink[3] *= Number(style.opacity);
    const foreground = over(ink, background);
    function luminance(color: number[]) {
      const channels = color.map(value => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }
    const a = luminance(foreground), b = luminance(background);
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), color: style.color, background };
  }, placeholder);
}

for (const skin of [...lightSkins, ...darkSkins]) {
  test(`${skin}: control text remains legible`, async ({ page }) => {
    await page.goto("/tests/browser/desktop-visual.html?theme=light", { waitUntil: "domcontentloaded" });
    const input = page.getByRole("textbox", { name: "Long text", exact: true });
    await expect(input).toBeVisible();
    await page.evaluate(({ skin, light }) => {
      const root = document.documentElement;
      root.dataset.skin = skin;
      root.classList.toggle("theme-light", light);
      root.classList.toggle("theme-dark", !light);
      root.classList.remove("has-user-accent");
      root.dataset.reducedMotion = "on";
    }, { skin, light: lightSkins.includes(skin) });

    const controls = [
      input,
      page.getByRole("textbox", { name: "Text area", exact: true }),
      page.getByRole("button", { name: "Primary", exact: true }),
      page.getByRole("button", { name: "Secondary", exact: true }),
      page.getByRole("button", { name: "Ghost", exact: true }),
      page.getByRole("button", { name: "Danger", exact: true }),
      page.getByRole("combobox", { name: "Workflow select", exact: true }),
    ];
    for (const control of controls) {
      await expect.poll(async () => (await textContrast(control)).ratio).toBeGreaterThanOrEqual(4.5);
    }
    await expect.poll(async () => (await textContrast(page.getByRole("textbox", { name: "Large input", exact: true }), true)).ratio).toBeGreaterThanOrEqual(4.5);

    await page.getByRole("button", { name: "Workflow menu", exact: true }).click();
    const option = page.getByRole("menuitem", { name: "Run workflow", exact: true });
    await expect(option).toBeVisible();
    await expect.poll(async () => (await textContrast(option)).ratio).toBeGreaterThanOrEqual(4.5);
  });
}
