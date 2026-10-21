import { memo, useMemo } from "react";
import { createColumnHelper, sortFn_alphanumeric } from "@tanstack/react-table";
import {
  DataTable,
  dataTableFeatures,
} from "../../../../../../shared/ui/primitives/DataTable";
import { applyArtifactItems, type ArtifactItem } from "./apply.js";
import {
  fieldHeading,
  PresetEmpty,
  PresetHeading,
  type PresetLabels,
} from "./parts.js";
import type { TableSpec } from "./spec.js";
import { cn } from "../../../../../../shared/lib/cn";

const COMPACT_ROWS = 3;
const columnHelper = createColumnHelper<
  typeof dataTableFeatures,
  { id: string; cells: string[] }
>();

export const ArtifactTable = memo(function ArtifactTable({
  spec,
  items,
  compact = false,
  labels,
  className,
}: {
  spec: TableSpec;
  items: readonly ArtifactItem[];
  compact?: boolean;
  labels: PresetLabels;
  className?: string;
}) {
  const model = useMemo(
    () => applyArtifactItems("table", spec, items),
    [spec, items],
  );
  const data = useMemo(
    () => (compact ? model.rows.slice(0, COMPACT_ROWS) : model.rows),
    [compact, model.rows],
  );
  const columns = useMemo(
    () =>
      model.columns.map((column, index) =>
        columnHelper.accessor((row) => row.cells[index], {
          id: column.field,
          header: fieldHeading(column.label, column.unit),
          enableSorting: !compact,
          sortFn: (left, right, id) => {
            const a = left.getValue<string>(id);
            const b = right.getValue<string>(id);
            const numeric =
              a?.trim() &&
              b?.trim() &&
              Number.isFinite(Number(a)) &&
              Number.isFinite(Number(b));
            return numeric
              ? Number(a) - Number(b)
              : sortFn_alphanumeric(left, right, id);
          },
          cell: (info) => (
            <span title={info.getValue()}>{info.getValue()}</span>
          ),
        }),
      ),
    [model.columns, compact],
  );

  if (model.rows.length === 0) {
    return (
      <div className={className}>
        {compact ? null : (
          <PresetHeading
            className="mb-3"
            description={spec.description}
            title={spec.title}
          />
        )}
        <PresetEmpty compact={compact} label={labels.empty} />
      </div>
    );
  }

  const count = (
    <span
      className="shrink-0 font-mono text-ui-xs text-foreground-subtlest tabular-nums"
      data-testid="artifact-table-count"
    >
      {labels.itemsCount(model.rows.length)}
    </span>
  );

  return (
    <div className={cn("min-w-0", className)} data-testid="artifact-table">
      {compact ? (
        <div className="mb-1.5 flex justify-end">{count}</div>
      ) : (
        <PresetHeading
          className="mb-3"
          description={spec.description}
          title={spec.title}
          trailing={count}
        />
      )}
      <DataTable
        label={spec.title ?? labels.itemsCount(model.rows.length)}
        data={data}
        columns={columns}
        getRowId={(row) => row.id}
        animateRows
        estimateRowHeight={25}
        containerClassName={cn(
          "min-w-0 overflow-auto rounded-lg border border-border",
          !compact && "max-h-128",
        )}
        className="w-full border-collapse text-left"
        headClassName="h-auto whitespace-nowrap border-b border-border px-2 py-1.5 text-ui-xs font-medium text-foreground-subtle"
        rowClassName="border-border/60 hover:bg-hover"
        cellClassName="max-w-56 truncate px-2 py-1 font-mono text-ui-xs text-foreground"
        rowProps={() => ({ "data-testid": "artifact-table-row" })}
      />
    </div>
  );
});
