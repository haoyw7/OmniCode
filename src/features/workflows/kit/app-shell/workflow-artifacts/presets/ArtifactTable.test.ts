// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArtifactTable } from "./ArtifactTable";
import type { ArtifactItem } from "./apply";
import { setUiLanguage } from "../../../../../../shared/i18n/language";

let root: Root;
let container: HTMLDivElement;
const spec = {
  title: "Scores",
  key: "id",
  columns: [
    { field: "name", label: "Name" },
    { field: "score", label: "Score" },
  ],
};
const labels = {
  empty: "Empty",
  otherColumn: "Other",
  itemsCount: (count: number) => `${count} items`,
};
const item = (ordinal: number, id: string, score: number): ArtifactItem => ({
  sequence: ordinal,
  siteId: "test",
  ordinal,
  item: { id, name: id, score },
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = (items: ArtifactItem[], compact = false) =>
  act(async () =>
    root.render(createElement(ArtifactTable, { spec, items, labels, compact })),
  );

it("sorts decimal and negative values numerically and re-sorts an upsert without duplicating its row", async () => {
  const items = [
    item(0, "first", 2.1),
    item(1, "second", -3),
    item(2, "third", 2.05),
  ];
  await render(items);
  await act(async () =>
    container.querySelectorAll<HTMLButtonElement>("th button")[1].click(),
  );
  const names = () =>
    Array.from(
      container.querySelectorAll("tbody tr"),
      (row) => row.querySelector("td")!.textContent,
    );
  expect(names()).toEqual(["second", "third", "first"]);
  await render([...items, item(3, "first", -4)]);
  expect(names()).toEqual(["first", "second", "third"]);
  expect(
    container.querySelector('[data-testid="artifact-table-count"]')
      ?.textContent,
  ).toBe("3 items");
});

it("keeps the compact preview at three rows and reports the full count", async () => {
  await render(
    Array.from({ length: 10 }, (_, index) =>
      item(index, `row-${index}`, index),
    ),
    true,
  );
  expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
  expect(
    container.querySelector('[data-testid="artifact-table-count"]')
      ?.textContent,
  ).toBe("10 items");
  expect(container.querySelector("th button")).toBeNull();
});
