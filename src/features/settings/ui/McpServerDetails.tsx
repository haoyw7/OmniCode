import { Button } from "../../../shared/ui/forms/Button";
import { cn } from "../../../shared/lib/cn";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { DisclosureChevron } from "../../../shared/ui/DisclosureChevron";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import {
  FileText,
  MessageSquare,
  RefreshCw,
  Wrench,
} from "../../../shared/ui/icons";
import type { McpConnection } from "../model/mcp";
import {
  mcpInspectionQuery,
  schemaParameters,
  type McpPrompt,
  type McpResource,
  type McpTool,
} from "../model/mcpInspect";
import { Spinner } from "../../../shared/ui/primitives/Spinner";

type Tab = "tools" | "resources" | "prompts";

/** Lists a configured server's tools, resources and prompts on demand. */
export function McpServerDetails({
  cwd,
  server,
}: {
  cwd: string;
  server: McpConnection;
}) {
  const { t: uiT } = useTranslation();
  const read = useQuery(mcpInspectionQuery(cwd, server), queryClient);
  const state = read.isPending ? { kind: "loading" as const } : read.isError ? { kind: "error" as const, error: String(read.error) } : { kind: "ready" as const, inspection: read.data };
  const [tab, setTab] = useState<Tab>("tools");
  useEffect(() => {
    const inspection = read.data;
    if (inspection) setTab(selected => selected === "tools" && !inspection.tools ? inspection.resources ? "resources" : inspection.prompts ? "prompts" : selected : selected);
  }, [read.data]);

  const reload = (
    <Button variant="ghost" size="content"
      type="button"
      onClick={() => void read.refetch()}
      disabled={state.kind === "loading"}
      className="flex items-center gap-1.5 rounded-md border border-stroke px-2 py-1 text-xs hover:bg-content/3 disabled:opacity-50"
    >
      <RefreshCw className="size-3" />
      {uiT("Reload")}
    </Button>
  );

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 px-4 pb-4 pl-14 text-xs text-content/55">
        <Spinner className="size-3.5" />
        {uiT("Connecting to server…")}
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="flex flex-wrap items-start gap-2 px-4 pb-4 pl-14">
        <p
          role="alert"
          className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger"
        >
          {state.error}
        </p>
        {reload}
      </div>
    );
  }

  const { inspection } = state;
  const resources = [
    ...(inspection.resources ?? []),
    ...(inspection.resourceTemplates ?? []),
  ];
  const tabs: {
    id: Tab;
    label: string;
    unsupported: string;
    count: number | null;
  }[] = [
    {
      id: "tools",
      label: uiT("Tools"),
      unsupported: uiT("This server does not provide tools."),
      count: inspection.tools?.length ?? null,
    },
    {
      id: "resources",
      label: uiT("Resources"),
      unsupported: uiT("This server does not provide resources."),
      count:
        inspection.resources || inspection.resourceTemplates
          ? resources.length
          : null,
    },
    {
      id: "prompts",
      label: uiT("Prompts"),
      unsupported: uiT("This server does not provide prompts."),
      count: inspection.prompts?.length ?? null,
    },
  ];
  const selected = tabs.find((entry) => entry.id === tab)!;

  return (
    <div className="space-y-3 px-4 pb-4 pl-14">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={uiT("MCP server capabilities")}
          className="inline-flex gap-0.5 rounded-md border border-content/10 p-0.5 text-[12px]"
        >
          {tabs.map((entry) => (
            <Button variant="ghost" size="content"
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn("rounded-[5px] px-2.5 py-1", tab === entry.id ? "bg-selection text-content" : "text-content/50 hover:text-content")}
            >
              {entry.label}{" "}
              <span className="opacity-60">{entry.count ?? "–"}</span>
            </Button>
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate text-[11px] text-content/40">
          {[
            inspection.serverName,
            inspection.serverVersion,
            inspection.protocolVersion
              ? `MCP ${inspection.protocolVersion}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {reload}
      </div>
      {inspection.errors.length > 0 ? (
        <p className="whitespace-pre-wrap text-xs text-danger">
          {inspection.errors.join("\n")}
        </p>
      ) : null}
      {selected.count === null ? (
        <p className="text-xs text-content/50">{selected.unsupported}</p>
      ) : selected.count === 0 ? (
        <p className="text-xs text-content/50">{uiT("None listed.")}</p>
      ) : (
        <div
          role="tabpanel"
          className="max-h-[420px] overflow-y-auto overscroll-contain rounded-lg border border-content/10 bg-background-base/40"
        >
          {tab === "tools"
            ? inspection.tools!.map((tool) => (
                <ToolItem key={tool.name} tool={tool} />
              ))
            : tab === "resources"
              ? resources.map((resource) => (
                  <ResourceItem
                    key={resource.uri ?? resource.uriTemplate ?? resource.name}
                    resource={resource}
                  />
                ))
              : inspection.prompts!.map((prompt) => (
                  <PromptItem key={prompt.name} prompt={prompt} />
                ))}
        </div>
      )}
    </div>
  );
}

function ItemShell({
  icon,
  title,
  subtitle,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  description?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(children) || (description?.length ?? 0) > 120;
  return (
    <div className="border-b border-content/5 last:border-b-0">
      <Button variant="ghost" size="content"
        type="button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left enabled:hover:bg-content/[0.03] justify-start"
      >
        <span className="mt-0.5 text-content/45">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-mono text-[12px] text-content">
              {title}
            </span>
            {subtitle ? (
              <span className="truncate text-[11px] text-content/40">
                {subtitle}
              </span>
            ) : null}
          </span>
          {description && !open ? (
            <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-relaxed text-content/55">
              {description}
            </span>
          ) : null}
        </span>
        {expandable ? (
          <DisclosureChevron expanded={open}
            className="mt-0.5 size-3.5 shrink-0 text-content/40"
          />
        ) : null}
      </Button>
      {expandable ? (
        <AnimatedCollapse expanded={open} motion="height">
          {() => (
            <div className="space-y-2 px-3 pb-3 pl-8">
              {description ? (
                <p className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-content/60">
                  {description}
                </p>
              ) : null}
              {children}
            </div>
          )}
        </AnimatedCollapse>
      ) : null}
    </div>
  );
}

function ParameterList({
  parameters,
}: {
  parameters: {
    name: string;
    type?: string;
    description?: string;
    required?: boolean;
  }[];
}) {
  const { t: uiT } = useTranslation();
  if (parameters.length === 0) {
    return (
      <p className="text-[11px] text-content/40">{uiT("No parameters")}</p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {parameters.map((parameter) => (
        <li key={parameter.name} className="text-[11.5px] leading-relaxed">
          <span className="font-mono text-content/85">{parameter.name}</span>
          {parameter.type ? (
            <span className="ml-1.5 font-mono text-content/40">
              {parameter.type}
            </span>
          ) : null}
          {parameter.required ? (
            <span className="ml-1.5 text-[10.5px] text-accent">
              {uiT("required")}
            </span>
          ) : null}
          {parameter.description ? (
            <span className="block break-words text-content/50">
              {parameter.description}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ToolItem({ tool }: { tool: McpTool }) {
  const parameters = schemaParameters(tool.inputSchema);
  const title = tool.title ?? tool.annotations?.title;
  return (
    <ItemShell
      icon={<Wrench className="size-3.5" />}
      title={tool.name}
      subtitle={title && title !== tool.name ? title : undefined}
      description={tool.description}
    >
      <ParameterList parameters={parameters} />
    </ItemShell>
  );
}

function ResourceItem({ resource }: { resource: McpResource }) {
  return (
    <ItemShell
      icon={<FileText className="size-3.5" />}
      title={resource.title ?? resource.name}
      subtitle={[resource.uri ?? resource.uriTemplate, resource.mimeType]
        .filter(Boolean)
        .join(" · ")}
      description={resource.description}
    />
  );
}

function PromptItem({ prompt }: { prompt: McpPrompt }) {
  return (
    <ItemShell
      icon={<MessageSquare className="size-3.5" />}
      title={prompt.name}
      subtitle={
        prompt.title && prompt.title !== prompt.name ? prompt.title : undefined
      }
      description={prompt.description}
    >
      {prompt.arguments?.length ? (
        <ParameterList parameters={prompt.arguments} />
      ) : undefined}
    </ItemShell>
  );
}
