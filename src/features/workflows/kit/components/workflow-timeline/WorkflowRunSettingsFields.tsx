// Run settings form fields. The concurrency stepper is ZCode's (Apache-2.0);
// Monocode's per-agent runtime rows live in WorkflowRunSettingsPopover.
import { Minus as MinusIcon, Plus as PlusIcon } from "../../../../../shared/ui/icons";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../../../../../shared/ui/forms/InputGroup.js";
import { useWorkflowIntl } from "../../i18n/IntlProvider.js";
import { clampWorkflowRunSettingsBound } from "./workflowRunSettings.js";

export function FieldLabel({ children }: { children: string }) {
  return <span className="text-ui-sm font-medium text-foreground-subtle">{children}</span>;
}

/**
 * 「同时运行上限」步进器：减、等宽数字、加，从 1 到本机天花板。天花板本身即「本 run 没有自己的界」，
 * 提示改写成「= 本机上限」。天花板未知（老 CLI）时没有上限、没有提示，数字可以直接敲。
 */
export function WorkflowRunSettingsBoundField({
  bound,
  ceiling,
  disabled,
  onChange,
}: {
  bound: number | null;
  ceiling: number | undefined;
  disabled: boolean;
  onChange: (bound: number) => void;
}) {
  const { intl } = useWorkflowIntl();
  const hint =
    ceiling === undefined
      ? undefined
      : bound !== null && bound >= ceiling
        ? intl.formatMessage({ id: "chat.toolCall.workflow.run.settings.limit.atCeiling" })
        : intl.formatMessage(
            { id: "chat.toolCall.workflow.run.settings.limit.ceiling" },
            { n: ceiling },
          );
  return (
    <div className="flex flex-col gap-1" data-testid="workflow-run-settings-bound">
      <FieldLabel>
        {intl.formatMessage({ id: "chat.toolCall.workflow.run.settings.limit" })}
      </FieldLabel>
      <div className="flex items-center gap-2">
        <InputGroup className="w-auto shrink-0">
          <InputGroupAddon align="inline-start">
            <InputGroupButton
              aria-label={intl.formatMessage({
                id: "chat.toolCall.workflow.run.settings.limit.decrease",
              })}
              data-testid="workflow-run-settings-bound-decrease"
              disabled={disabled || bound === null || bound <= 1}
              onClick={() =>
                bound !== null && onChange(clampWorkflowRunSettingsBound(bound - 1, ceiling))
              }
              size="icon-xs"
            >
              <MinusIcon className="size-3.5" />
            </InputGroupButton>
          </InputGroupAddon>
          <InputGroupInput
            aria-label={intl.formatMessage({ id: "chat.toolCall.workflow.run.settings.limit" })}
            className="h-7 w-9 px-0 text-center font-mono tabular-nums"
            data-testid="workflow-run-settings-bound-value"
            disabled={disabled}
            inputMode="numeric"
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(parsed)) onChange(clampWorkflowRunSettingsBound(parsed, ceiling));
            }}
            placeholder="—"
            value={bound === null ? "" : String(bound)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={intl.formatMessage({
                id: "chat.toolCall.workflow.run.settings.limit.increase",
              })}
              data-testid="workflow-run-settings-bound-increase"
              disabled={disabled || bound === null || (ceiling !== undefined && bound >= ceiling)}
              onClick={() =>
                bound !== null && onChange(clampWorkflowRunSettingsBound(bound + 1, ceiling))
              }
              size="icon-xs"
            >
              <PlusIcon className="size-3.5" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {hint === undefined ? null : (
          <span className="min-w-0 truncate text-ui-sm text-foreground-subtle">{hint}</span>
        )}
      </div>
    </div>
  );
}
