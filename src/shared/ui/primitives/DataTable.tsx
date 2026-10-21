import {
  Fragment,
  useCallback,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type Cell,
  type ColumnDef,
  type Row,
  type RowData,
} from "@tanstack/react-table";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import { msgTransition, immediateTransition } from "../../motion/tokens";
import { isPaneResizing } from "../../lib/paneResize";
import { cn } from "../../lib/cn";
import { useTranslation } from "../../i18n/useTranslation";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "../icons";
import { Button } from "../forms/Button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./Table";

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
  columnMeta: {} as {
    className?: string;
    headerClassName?: string;
    style?: CSSProperties;
  },
});

export type DataTableCell<T extends RowData> = Cell<
  typeof dataTableFeatures,
  T
>;
export type DataTableRow<T extends RowData> = Row<typeof dataTableFeatures, T>;
type RowProps = Omit<
  ComponentProps<"tr">,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

const MotionTableRow = motion.create(TableRow);
function AnimatedRow({
  layoutKey,
  ...props
}: ComponentProps<typeof MotionTableRow> & { layoutKey: string }) {
  const reduced = useReducedMotion();
  const present = useIsPresent();
  return (
    <MotionTableRow
      {...props}
      layout={!reduced && !isPaneResizing() ? "position" : false}
      layoutDependency={layoutKey}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reduced ? immediateTransition : msgTransition}
      inert={!present ? true : undefined}
    />
  );
}

export function DataTable<T extends RowData>({
  data,
  columns,
  getRowId,
  label,
  className,
  containerClassName,
  headerClassName,
  rowClassName,
  cellClassName,
  headClassName,
  rowProps,
  renderCell,
  children,
  estimateRowHeight = 36,
  virtualize = true,
  hideHeader = false,
  onScroll,
  style,
  animateRows = false,
}: {
  data: readonly T[];
  columns: ColumnDef<typeof dataTableFeatures, T, any>[];
  getRowId: (row: T) => string;
  label: string;
  className?: string;
  containerClassName?: string;
  headerClassName?: string;
  rowClassName?: string;
  cellClassName?: string;
  headClassName?: string;
  style?: CSSProperties;
  rowProps?: (row: DataTableRow<T>) => RowProps;
  renderCell?: (cell: DataTableCell<T>) => ReactNode;
  children?: ReactNode;
  estimateRowHeight?: number;
  virtualize?: boolean;
  hideHeader?: boolean;
  animateRows?: boolean;
  onScroll?: ComponentProps<"div">["onScroll"];
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    getRowId,
    defaultColumn: { sortFn: "alphanumeric", sortDescFirst: false },
  });
  const rows = table.getRowModel().rows;
  const enabled = virtualize && rows.length > 80;
  const focusedIndex =
    focusedId === null ? -1 : rows.findIndex((row) => row.id === focusedId);
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexes = defaultRangeExtractor(range);
      if (focusedIndex >= 0) {
        for (
          let i = Math.max(0, focusedIndex - 1);
          i <= Math.min(range.count - 1, focusedIndex + 1);
          i++
        )
          indexes.push(i);
      }
      return [...new Set(indexes)].sort((a, b) => a - b);
    },
    [focusedIndex],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    enabled,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    getItemKey: (index) => rows[index]!.id,
    overscan: 6,
    rangeExtractor,
    scrollMargin: bodyRef.current?.offsetTop ?? 0,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const layoutKey =
    animateRows && !enabled ? rows.map((row) => row.id).join("|") : "";
  const items = enabled
    ? virtualRows.map((item) => ({ row: rows[item.index]!, item }))
    : rows.map((row) => ({ row, item: undefined }));
  const spacer = (height: number, key: string) =>
    height > 0 ? (
      <TableRow
        key={key}
        aria-hidden="true"
        className="border-0 hover:bg-transparent"
      >
        <TableCell
          colSpan={columns.length}
          className="border-0 p-0"
          style={{ height }}
        />
      </TableRow>
    ) : null;

  const renderedRows = items.map(({ row, item }, index) => {
    const props = rowProps?.(row);
    const previousEnd = index
      ? (virtualRows[index - 1]?.end ?? 0)
      : virtualizer.options.scrollMargin;
    const cells = row.getAllCells().map((cell) => (
      <TableCell
        key={cell.id}
        className={cn(cellClassName, cell.column.columnDef.meta?.className)}
      >
        {renderCell ? renderCell(cell) : <table.FlexRender cell={cell} />}
      </TableCell>
    ));
    if (animateRows && !enabled)
      return (
        <AnimatedRow
          {...props}
          key={row.id}
          layoutKey={layoutKey}
          data-row-id={row.id}
          aria-rowindex={index + 2}
          className={cn(rowClassName, props?.className)}
          onFocus={(event) => {
            setFocusedId(row.id);
            props?.onFocus?.(event);
          }}
        >
          {cells}
        </AnimatedRow>
      );
    return (
      <Fragment key={row.id}>
        {item && spacer(item.start - previousEnd, `before-${row.id}`)}
        <TableRow
          {...props}
          data-row-id={row.id}
          data-index={item?.index}
          aria-rowindex={(item?.index ?? index) + 2}
          ref={item ? virtualizer.measureElement : undefined}
          className={cn(rowClassName, props?.className)}
          onFocus={(event) => {
            setFocusedId(row.id);
            props?.onFocus?.(event);
          }}
        >
          {cells}
        </TableRow>
      </Fragment>
    );
  });

  return (
    <Table
      aria-label={label}
      aria-rowcount={rows.length + 1}
      className={className}
      style={style}
      containerProps={{
        ref: scrollRef,
        className: cn(enabled && "max-h-128 overflow-auto", containerClassName),
        style: enabled ? { overflowAnchor: "none" } : undefined,
        onScroll,
        onBlur: (event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocusedId(null);
        },
      }}
    >
      {children}
      <TableHeader
        className={cn(
          hideHeader ? "sr-only" : "sticky top-0 z-10 bg-background",
          headerClassName,
        )}
      >
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              const sortable = !hideHeader && header.column.getCanSort();
              const Icon =
                sorted === "asc"
                  ? ChevronUp
                  : sorted === "desc"
                    ? ChevronDown
                    : ChevronsUpDown;
              return (
                <TableHead
                  key={header.id}
                  style={header.column.columnDef.meta?.style}
                  className={cn(
                    headClassName,
                    header.column.columnDef.meta?.headerClassName,
                  )}
                  aria-sort={
                    sortable
                      ? sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                >
                  {sortable ? (
                    <Button
                      variant="ghost"
                      size="content"
                      className="max-w-full justify-start gap-1 text-inherit"
                      style={{ font: "inherit" }}
                      title={t("Sort by {column}", {
                        column: String(
                          header.column.columnDef.header ?? header.id,
                        ),
                      })}
                      onClick={(event) => {
                        header.column.getToggleSortingHandler()?.(event);
                        scrollRef.current?.scrollTo({ top: 0 });
                      }}
                    >
                      <table.FlexRender header={header} />
                      <Icon className="size-3 shrink-0" aria-hidden />
                    </Button>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody ref={bodyRef}>
        {animateRows && !enabled ? (
          <AnimatePresence initial={false}>{renderedRows}</AnimatePresence>
        ) : (
          renderedRows
        )}
        {enabled &&
          spacer(
            virtualizer.getTotalSize() -
              ((virtualRows.at(-1)?.end ?? virtualizer.options.scrollMargin) -
                virtualizer.options.scrollMargin),
            "after",
          )}
      </TableBody>
    </Table>
  );
}
