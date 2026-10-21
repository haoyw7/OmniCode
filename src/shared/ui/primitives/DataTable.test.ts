// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createColumnHelper } from "@tanstack/react-table";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DataTable, dataTableFeatures } from "./DataTable";
import { setUiLanguage } from "../../i18n/language";

type RecordRow = { id: string; name: string; count: number };
const column = createColumnHelper<typeof dataTableFeatures, RecordRow>();
const columns = column.columns([
  column.accessor("name", { header: "Name" }),
  column.accessor("count", { header: "Count" }),
  column.display({ id: "open", header: "Actions" }),
]);
let root: Root;
let container: HTMLDivElement;
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

it("sorts numeric values, exposes sort state, and keeps actions attached to stable row IDs after refresh", async () => {
  const onOpen = vi.fn();
  const data = [
    { id: "ten", name: "Ten", count: 10 },
    { id: "two", name: "Two", count: 2 },
  ];
  const render = (records: RecordRow[]) =>
    act(async () =>
      root.render(
        createElement(DataTable<RecordRow>, {
          label: "Records",
          data: records,
          columns,
          getRowId: (row) => row.id,
          renderCell: (cell) =>
            cell.column.id === "open"
              ? createElement(
                  "button",
                  { onClick: () => onOpen(cell.row.original.id) },
                  "Open",
                )
              : String(cell.getValue()),
        }),
      ),
    );
  await render(data);
  const header = container.querySelectorAll("th")[1];
  await act(async () => header.querySelector("button")!.click());
  expect(header.getAttribute("aria-sort")).toBe("ascending");
  expect(container.querySelector("tbody tr")?.getAttribute("data-row-id")).toBe(
    "two",
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>("tbody button")!.click(),
  );
  expect(onOpen).toHaveBeenLastCalledWith("two");
  await render([{ ...data[0], count: 1 }, data[1]]);
  expect(container.querySelector("tbody tr")?.getAttribute("data-row-id")).toBe(
    "ten",
  );
  await act(async () => header.querySelector("button")!.click());
  expect(header.getAttribute("aria-sort")).toBe("descending");
  expect(container.querySelector("tbody tr")?.getAttribute("data-row-id")).toBe(
    "two",
  );
  await act(async () => header.querySelector("button")!.click());
  expect(header.getAttribute("aria-sort")).toBe("none");
  expect(container.querySelector("tbody tr")?.getAttribute("data-row-id")).toBe(
    "ten",
  );
});
