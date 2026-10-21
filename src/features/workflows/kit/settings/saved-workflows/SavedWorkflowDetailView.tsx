import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, invalidateAfterChange } from "../../../../../shared/lib/queryClient";
import { workflowQueryScope } from "../../../model/workflowQueryKeys";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Copy } from "../../../../../shared/ui/icons";
import {
  TID_WORKFLOW_DETAIL,
  TID_WORKFLOW_DETAIL_SCRIPT,
  TID_WORKFLOW_DETAIL_TAB,
  type OmniCodeSavedWorkflowEntry,
  type OmniCodeSavedWorkflowMeta,
  type OmniCodeSavedWorkflowRun,
  type OmniCodeWorkflowsGetResult,
} from "../../_shims/shared.js";
import type { IOmniCodeAgentService, OmniCodeAgentSavedWorkflowTarget } from "../../_shims/services.js";
import { CodeBlock } from "../../components/ai-elements/code-block.js";
import { Button } from "../../../../../shared/ui/forms/Button";
import { Spinner } from "../../../../../shared/ui/primitives/Spinner.js";
import { toast } from "sonner";
import { cn } from "../../../../../shared/lib/cn";
import { useWorkflowIntl } from "../../i18n/IntlProvider.js";
import { SettingsBreadcrumbReporter } from "../SettingsHeaderBreadcrumb.js";
import { SETTINGS_FRAME_CONTENT_CLASSNAME } from "../SettingsPageParts.js";
import { SettingsSegmentedTabs } from "../SettingsSegmentedTabs.js";
import {
  argsDeclarationToRows,
  rowsToArgsDeclaration,
  type SavedWorkflowArgRow,
  type SavedWorkflowArgRowError,
} from "./savedWorkflowArgsForm.js";
import { SavedWorkflowArtifactChips } from "./SavedWorkflowArtifactChips.js";
import { SavedWorkflowDetailHeader } from "./SavedWorkflowDetailHeader.js";
import {
  SavedWorkflowMetaForm,
  type SavedWorkflowMetaDraft,
} from "./SavedWorkflowMetaForm.js";
import {
  SavedWorkflowRunHistory,
  type SavedWorkflowRunProject,
} from "./SavedWorkflowRunHistoryPanel.js";

type DetailTab = "definition" | "history";

type DetailLoad =
  | { status: "loading" }
  | { status: "ready"; detail: Extract<OmniCodeWorkflowsGetResult, { ok: true }> }
  | { status: "failed"; reason: string };

type MetaDraft = SavedWorkflowMetaDraft;

function draftFromMeta(meta: OmniCodeSavedWorkflowMeta): MetaDraft {
  return {
    description: meta.description,
    whenToUse: meta.whenToUse ?? "",
    rows: argsDeclarationToRows(meta.args),
  };
}

let rowKeySeq = 0;

interface SavedWorkflowDetailViewProps {
  /** 项目档传 workspace target；全局档传 `{ scope: "global" }`（get/updateMeta 直接透传）。 */
  target: OmniCodeAgentSavedWorkflowTarget;
  agentService: IOmniCodeAgentService;
  name: string;
  /** 面包屑「自动化 › <项目名> › <工作流名>」里的项目一级。 */
  projectLabel: string;
  entry: OmniCodeSavedWorkflowEntry | undefined;
  runs: readonly OmniCodeSavedWorkflowRun[];
  now: number;
  busy: boolean;
  canOpenRun: boolean;
  onBack: () => void;
  onRun: () => void;
  onRevise: () => void;
  onCopyPath: () => void;
  /** 作用域动作：项目档「提升为全局」（AI 概括）/ 全局档「移到项目…」；仅在传入时出现。 */
  onMove?: () => void;
  onDelete: () => void;
  onOpenRun: (run: OmniCodeSavedWorkflowRun) => void;
  /** 产物 chip → `workflow-artifact` tab；缺席即 chips 只读。 */
  onOpenArtifact?: (run: OmniCodeSavedWorkflowRun, artifactId: string) => void;
  onMetaSaved: () => void;
  /** 传入即在运行历史每行渲染项目列（全局工作流跨项目历史）。 */
  resolveRunProject?: (run: OmniCodeSavedWorkflowRun) => SavedWorkflowRunProject | null;
  /** 实参窗由列表层持有（同一份状态），详情页只负责挂到树上。 */
  launchDialog: ReactNode;
}

/**
 * 工作流详情页：与定时任务编辑页同构——
 * 面包屑、标题、右上动作、分段标签。「定义」= 元数据行内编辑 + 只读脚本；「运行历史」= journal 行。
 */
export function SavedWorkflowDetailView(props: SavedWorkflowDetailViewProps) {
  const identity = JSON.stringify([...workflowQueryScope(props.agentService), props.target, props.name]);
  return <SavedWorkflowDetails key={identity} {...props} />;
}

function SavedWorkflowDetails({
  target,
  agentService,
  name,
  projectLabel,
  entry,
  runs,
  now,
  busy,
  canOpenRun,
  onBack,
  onRun,
  onRevise,
  onCopyPath,
  onMove,
  onDelete,
  onOpenRun,
  onOpenArtifact,
  onMetaSaved,
  resolveRunProject,
  launchDialog,
}: SavedWorkflowDetailViewProps) {
  const { intl } = useWorkflowIntl();
  const [tab, setTab] = useState<DetailTab>("definition");
  const queryKey = [...workflowQueryScope(agentService), "savedDetail", target, name];
  const read = useQuery({ queryKey, queryFn: () => agentService.getSavedWorkflow({ ...target, name }) }, queryClient);
  const loadState: DetailLoad = read.isError ? { status: "failed", reason: String(read.error instanceof Error ? read.error.message : read.error) }
    : !read.data ? { status: "loading" } : read.data.ok ? { status: "ready", detail: read.data } : { status: "failed", reason: read.data.reason };
  const form = useForm({
    resolver: zodResolver(z.object({ draft: z.custom<MetaDraft>().superRefine((draft, ctx) => {
      if (!draft.description.trim()) ctx.addIssue({ code: "custom", path: ["description"], message: intl.formatMessage({ id: "workflows.hub.detail.meta.descriptionRequired" }) });
      const collected = rowsToArgsDeclaration(draft.rows);
      if (!collected.ok) draft.rows.forEach((row, index) => {
        const message = collected.errors[row.key];
        if (message) ctx.addIssue({ code: "custom", path: ["rows", index], message });
      });
    }).nullable() })),
    defaultValues: { draft: null as MetaDraft | null },
  });
  const editedDraft = useWatch({ control: form.control, name: "draft" });
  const { getValues, setValue, clearErrors } = form;
  const setDraft = useCallback((next: MetaDraft | null | ((current: MetaDraft | null) => MetaDraft | null)) =>
    setValue("draft", typeof next === "function" ? next(getValues("draft")) : next, { shouldDirty: true }), [getValues, setValue]);
  const descriptionError = !!form.formState.errors.draft?.description;
  const rowErrors: Record<string, SavedWorkflowArgRowError> = {};
  editedDraft?.rows.forEach((row, index) => {
    const message = form.formState.errors.draft?.rows?.[index]?.message;
    if (message) rowErrors[row.key] = message as SavedWorkflowArgRowError;
  });
  const mutation = useMutation({ mutationFn: (meta: OmniCodeSavedWorkflowMeta) => agentService.updateSavedWorkflowMeta({ ...target, name, meta }) }, queryClient);
  const saving = mutation.isPending;

  const detail = loadState.status === "ready" ? loadState.detail : null;
  const baseline = useMemo(() => (detail ? draftFromMeta(detail.meta) : null), [detail]);
  const draft = editedDraft ?? baseline;
  const dirty = useMemo(() => {
    if (!draft || !baseline) return false;
    return JSON.stringify(draft) !== JSON.stringify(baseline);
  }, [baseline, draft]);

  const updateDraft = useCallback((patch: Partial<MetaDraft>) => {
    setDraft((current) => { const value = current ?? baseline; return value ? { ...value, ...patch } : null; });
  }, [baseline]);
  const updateRow = useCallback((key: string, patch: Partial<SavedWorkflowArgRow>) => {
    setDraft((edited) => {
      const current = edited ?? baseline;
      return current
        ? {
            ...current,
            rows: current.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
          }
        : current;
    });
    clearErrors("draft.rows");
  }, [baseline]);
  const addRow = useCallback(() => {
    rowKeySeq += 1;
    setDraft((edited) => {
      const current = edited ?? baseline;
      return current
        ? {
            ...current,
            rows: [
              ...current.rows,
              {
                key: `new:${rowKeySeq}`,
                name: "",
                type: "string",
                required: false,
                defaultText: "",
                description: "",
              },
            ],
          }
        : current;
    });
  }, [baseline]);
  const removeRow = useCallback((key: string) => {
    setDraft((edited) => {
      const current = edited ?? baseline;
      return current ? { ...current, rows: current.rows.filter((row) => row.key !== key) } : current;
    });
  }, [baseline]);
  const discard = useCallback(() => {
    setDraft(null);
    clearErrors();
  }, [baseline]);

  const save = form.handleSubmit(async ({ draft }) => {
    if (!draft || saving || busy) return;
    const description = draft.description.trim();
    const collected = rowsToArgsDeclaration(draft.rows);
    if (!collected.ok) return;
    const whenToUse = draft.whenToUse.trim();
    const meta: OmniCodeSavedWorkflowMeta = {
      description,
      ...(whenToUse.length === 0 ? {} : { whenToUse }),
      ...(collected.args === undefined ? {} : { args: collected.args }),
    };
    try {
      const result = await mutation.mutateAsync(meta);
      if (!result.ok) {
        toast(
          intl.formatMessage(
            { id: "workflows.hub.detail.meta.saveFailed" },
            { reason: intl.formatMessage({ id: `workflows.hub.reason.${result.reason}` }) },
          ),
        );
        return;
      }
      toast(intl.formatMessage({ id: "workflows.hub.detail.meta.saved" }));
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<OmniCodeWorkflowsGetResult>(queryKey, current => current?.ok ? { ...current, meta } : current);
      setDraft(null);
      await invalidateAfterChange(queryKey);
      onMetaSaved();
    } catch (error) {
      toast(
        intl.formatMessage(
          { id: "workflows.hub.detail.meta.saveFailed" },
          { reason: error instanceof Error ? error.message : String(error) },
        ),
      );
    }
  });

  const copyScript = useCallback(() => {
    if (!detail) return;
    void navigator.clipboard?.writeText(detail.script).catch(() => undefined);
  }, [detail]);

  // 「最近产物」条：**最近一次 completed run** 的
  // 产物。刻意不取「最近一次 run」——一次刚失败的运行往往什么都没交付，用它会让这条已经存在的
  // 交付物凭空消失一阵子。runs 已按 updatedAt 倒序（服务端 time_updated desc），取首个即可。
  const latestArtifactRun = useMemo(
    () => runs.find((run) => run.status === "completed" && (run.artifacts?.length ?? 0) > 0),
    [runs],
  );

  const path = detail?.path ?? entry?.path ?? "";
  const description = detail?.meta.description ?? entry?.description ?? "";

  return (
    <div
      data-testid={TID_WORKFLOW_DETAIL}
      className={cn(SETTINGS_FRAME_CONTENT_CLASSNAME, "flex flex-col gap-6")}
    >
      <SettingsBreadcrumbReporter
        items={[{ label: projectLabel }, { label: name }]}
        onSectionSelect={onBack}
      />

      <SavedWorkflowDetailHeader
        name={name}
        description={description}
        entry={entry}
        busy={busy}
        onRun={onRun}
        onRevise={onRevise}
        onCopyPath={onCopyPath}
        onMove={onMove}
        onDelete={onDelete}
      />

      {/* ⚠ 术语：这里的「产物」是脚本经 `artifact.*` 交付给用户的产出，不是脚本的顶层返回值。 */}
      {latestArtifactRun?.artifacts === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2" data-testid="workflow-detail-artifacts">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "workflows.hub.artifacts.latest" })}
          </span>
          <SavedWorkflowArtifactChips
            artifacts={latestArtifactRun.artifacts}
            size="md"
            {...(onOpenArtifact === undefined || !latestArtifactRun.parentSessionId
              ? {}
              : {
                  onOpenArtifact: (artifactId: string) =>
                    onOpenArtifact(latestArtifactRun, artifactId),
                })}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div data-testid={TID_WORKFLOW_DETAIL_TAB}>
          <SettingsSegmentedTabs
            value={tab}
            items={[
              {
                value: "definition",
                label: intl.formatMessage({ id: "workflows.hub.detail.tab.definition" }),
              },
              {
                value: "history",
                label:
                  `${intl.formatMessage({ id: "workflows.hub.detail.tab.history" })} ${runs.length > 0 ? runs.length : ""}`.trim(),
              },
            ]}
            onValueChange={setTab}
          />
        </div>
        {path ? (
          <div className="flex min-w-0 items-center gap-1 text-foreground-subtle">
            <span className="min-w-0 truncate font-mono text-ui-sm" title={path}>
              {path}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={intl.formatMessage({ id: "workflows.hub.detail.copyPath" })}
              onClick={onCopyPath}
            >
              <Copy className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>

      {tab === "history" ? (
        <SavedWorkflowRunHistory
          runs={runs}
          now={now}
          canOpenRun={canOpenRun}
          onOpenRun={onOpenRun}
          onOpenArtifact={onOpenArtifact}
          resolveRunProject={resolveRunProject}
        />
      ) : loadState.status === "loading" ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="size-5" />
        </div>
      ) : loadState.status === "failed" ? (
        <p className="text-ui-base text-destructive">
          {loadState.reason === "not_found"
            ? intl.formatMessage({ id: "workflows.hub.detail.notFound" })
            : intl.formatMessage(
                { id: "workflows.hub.detail.loadError" },
                {
                  reason:
                    loadState.reason === "invalid_name" ||
                    loadState.reason === "parse_error" ||
                    loadState.reason === "read_error"
                      ? intl.formatMessage({ id: `workflows.hub.reason.${loadState.reason}` })
                      : loadState.reason,
                },
              )}
        </p>
      ) : detail && draft ? (
        <>
          <SavedWorkflowMetaForm
            draft={draft}
            rowErrors={rowErrors}
            descriptionError={descriptionError}
            dirty={dirty}
            saving={saving}
            onDescriptionChange={(value) => {
              clearErrors("draft.description");
              updateDraft({ description: value });
            }}
            onWhenToUseChange={(value) => updateDraft({ whenToUse: value })}
            onRowChange={updateRow}
            onRowAdd={addRow}
            onRowRemove={removeRow}
            onDiscard={discard}
            onSave={() => void save()}
          />

          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="desktop-pane-heading text-ui-base font-medium leading-5 text-foreground-subtle">
                {intl.formatMessage({ id: "workflows.hub.detail.script" })}
              </h2>
              <p className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "workflows.hub.detail.script.note" })}
              </p>
            </div>
            <div
              data-testid={TID_WORKFLOW_DETAIL_SCRIPT}
              className="overflow-hidden rounded-lg border border-border bg-surface"
            >
              <div className="flex h-8 items-center justify-between border-b border-border px-3">
                <span className="font-mono text-ui-sm text-foreground-subtle">
                  {`${name}.dwf.ts · TypeScript`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={intl.formatMessage({ id: "workflows.hub.detail.script.copy" })}
                  onClick={copyScript}
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
              <div className="max-h-[480px] overflow-auto">
                <CodeBlock code={detail.script} language="typescript" />
              </div>
            </div>
          </section>
        </>
      ) : null}
      {launchDialog}
    </div>
  );
}
