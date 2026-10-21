import { useId, useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import {
  DataTable,
  dataTableFeatures,
} from "../../../../../shared/ui/primitives/DataTable";
import { FieldError } from "../../../../../shared/ui/primitives/Field";
import { Plus, X } from "../../../../../shared/ui/icons";
import type { OmniCodeSavedWorkflowArgType } from "../../_shims/shared.js";
import { Button } from "../../../../../shared/ui/forms/Button";
import { Input } from "../../../../../shared/ui/forms/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../../shared/ui/forms/Select.js";
import { Switch } from "../../../../../shared/ui/forms/Switch";
import { cn } from "../../../../../shared/lib/cn";
import { useWorkflowIntl } from "../../i18n/IntlProvider.js";
import type {
  SavedWorkflowArgRow,
  SavedWorkflowArgRowError,
} from "./savedWorkflowArgsForm.js";

const ARG_TYPES: readonly OmniCodeSavedWorkflowArgType[] = [
  "string",
  "number",
  "boolean",
  "json",
];

const columnHelper = createColumnHelper<
  typeof dataTableFeatures,
  SavedWorkflowArgRow
>();
const COLUMN_IDS = [
  "name",
  "type",
  "required",
  "default",
  "description",
  "remove",
] as const;

/** 参数声明始终按用户编辑顺序显示，避免输入时行位置变化。 */
export function SavedWorkflowArgsTable({
  rows,
  errors,
  onChange,
  onAdd,
  onRemove,
}: {
  rows: readonly SavedWorkflowArgRow[];
  errors: Record<string, SavedWorkflowArgRowError>;
  onChange: (key: string, patch: Partial<SavedWorkflowArgRow>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  const { intl } = useWorkflowIntl();
  const errorId = useId();
  const label = (id: string) =>
    intl.formatMessage({ id: `workflows.hub.detail.args.${id}` });
  const columns = useMemo(
    () =>
      COLUMN_IDS.map((id) =>
        columnHelper.display({
          id,
          header: intl.formatMessage({ id: `workflows.hub.detail.args.${id}` }),
          meta: {
            headerClassName: id === "remove" ? "text-transparent" : undefined,
            style: {
              width:
                id === "type"
                  ? 124
                  : id === "required"
                    ? 76
                    : id === "remove"
                      ? 46
                      : id === "name"
                        ? "calc((100% - 288px) * 0.35 + 18px)"
                        : id === "default"
                          ? "calc((100% - 288px) * 0.25 + 12px)"
                          : undefined,
            },
          },
        }),
      ),
    [intl],
  );
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <DataTable
        label={intl.formatMessage({ id: "workflows.hub.detail.args" })}
        data={rows}
        columns={columns}
        getRowId={(row) => row.key}
        animateRows
        virtualize={false}
        className="min-w-172 table-fixed"
        estimateRowHeight={45}
        headClassName="h-auto bg-surface px-1.5 py-1.5 text-ui-sm font-normal text-foreground-subtle first:pl-3 last:pr-3"
        cellClassName="px-1.5 py-2 whitespace-normal first:pl-3 last:pr-3"
        rowClassName="hover:bg-transparent"
        rowProps={({ original: row }) => ({
          "data-workflow-arg-row": row.name,
        })}
        renderCell={(cell) => {
          const row = cell.row.original;
          const error = errors[row.key];
          const nameError =
            error === "empty_name" || error === "duplicate_name";
          const messageId = `${errorId}-${row.key}`;
          const errorMessage = error ? (
            <FieldError id={messageId} className="mt-1">
              {intl.formatMessage({
                id: `workflows.hub.detail.args.error.${error}`,
              })}
            </FieldError>
          ) : null;
          switch (cell.column.id) {
            case "name":
              return (
                <>
                  <Input
                    aria-label={label("name")}
                    className={cn(
                      "h-7 font-mono",
                      nameError && "border-destructive",
                    )}
                    aria-invalid={nameError}
                    aria-describedby={nameError ? messageId : undefined}
                    value={row.name}
                    onChange={(event) =>
                      onChange(row.key, { name: event.target.value })
                    }
                  />
                  {nameError && errorMessage}
                </>
              );
            case "type":
              return (
                <Select
                  value={row.type}
                  onValueChange={(value) =>
                    onChange(row.key, {
                      type: value as OmniCodeSavedWorkflowArgType,
                    })
                  }
                >
                  <SelectTrigger
                    aria-label={label("type")}
                    size="sm"
                    className="h-7 w-full font-mono"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ARG_TYPES.map((type) => (
                      <SelectItem key={type} value={type} className="font-mono">
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            case "required":
              return (
                <Switch
                  aria-label={label("required")}
                  checked={row.required}
                  onCheckedChange={(required) =>
                    onChange(row.key, { required })
                  }
                />
              );
            case "default":
              return (
                <>
                  {row.type === "boolean" ? (
                    <Select
                      value={row.defaultText === "" ? "none" : row.defaultText}
                      onValueChange={(value) =>
                        onChange(row.key, {
                          defaultText: value === "none" ? "" : value,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={label("default")}
                        size="sm"
                        className="h-7 w-full font-mono"
                        aria-invalid={error === "invalid_default"}
                        aria-describedby={
                          error === "invalid_default" ? messageId : undefined
                        }
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        <SelectItem value="true" className="font-mono">
                          true
                        </SelectItem>
                        <SelectItem value="false" className="font-mono">
                          false
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      aria-label={label("default")}
                      className={cn(
                        "h-7 font-mono",
                        error === "invalid_default" && "border-destructive",
                      )}
                      aria-invalid={error === "invalid_default"}
                      aria-describedby={
                        error === "invalid_default" ? messageId : undefined
                      }
                      value={row.defaultText}
                      onChange={(event) =>
                        onChange(row.key, { defaultText: event.target.value })
                      }
                    />
                  )}
                  {error === "invalid_default" && errorMessage}
                </>
              );
            case "description":
              return (
                <Input
                  aria-label={label("description")}
                  className="h-7"
                  value={row.description}
                  onChange={(event) =>
                    onChange(row.key, { description: event.target.value })
                  }
                />
              );
            case "remove":
              return (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label("remove")}
                  onClick={() => onRemove(row.key)}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              );
            default:
              return null;
          }
        }}
      />
      <div className="border-t border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-icon="inline-start"
          className="text-foreground-subtle"
          onClick={onAdd}
        >
          <Plus className="size-3" aria-hidden="true" />
          {label("add")}
        </Button>
      </div>
    </div>
  );
}
