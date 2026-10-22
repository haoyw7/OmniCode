import { cn } from "../../../shared/lib/cn";
import { Input } from "../../../shared/ui/forms/Input";
import { Button } from "../../../shared/ui/forms/Button";
import { errorMessage } from "../../../shared/lib/errorMessage";
import { useMutation, useQuery } from "@tanstack/react-query";
import { invalidateAfterChange, queryClient } from "../../../shared/lib/queryClient";
import { skillsQuery } from "../model/skillQueries";
import { skillDocumentQuery } from "../model/skills";
import { motion as motionElement } from "motion/react";
import { panelTransition, immediateTransition } from "../../../shared/motion/tokens";
import { Switch } from "../../../shared/ui/forms/Switch";
import { reducedMotionQuery as motionPreferenceQuery } from "../../../shared/lib/reducedMotion";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { withToast } from "../../../shared/ui/primitives/Sonner";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AnimatedCollapse,
  useCollapseMotion,
} from "../../../shared/ui/AnimatedCollapse";
import {
  SurfaceVisibilityContext,
  useSurfaceVisibility,
} from "../../../shared/ui/SurfaceVisibility";
import "./SkillsPage.css";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Copy,
  Eye,
  FolderOpen,
  RefreshCw,
  Search,
  X,
} from "../../../shared/ui/icons";
import { CreateSkillForm } from "./SkillPicker";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  MarkdownModeToggle,
  useMarkdownMode,
} from "../../sessions/ui/MarkdownModeToggle";
import { MarkdownSource } from "../../sessions/ui/AgentMarkdown";
import { SkillDocumentPreview } from "./SkillDocumentPreview";
import { HarnessIcon } from "../../../shared/ui/branding/HarnessIcon";
import { HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  type DiscoveredSkill,
} from "../../../platform/tauri/fs";
import {
  createBlankSkill,
  invalidateSkills,
  loadDisabledSkillPaths,
  saveDisabledSkillPaths,
  SKILLS_CHANGE_EVENT,
} from "../model/skills";

type SkillSource = DiscoveredSkill["source"];

export type AgentPickerProps = {
  value: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  onChange: (value: string) => void;
};

const ALL_AGENTS = "all";

// Listing order for the agent filter; mirrors the scan order in skills.rs.
const SOURCE_ORDER: SkillSource[] = [
  "agents",
  "claude",
  "cursor",
  "codex",
  "opencode",
  "pi",
  "omp",
  "fx",
  "grok",
  "hermes",
  "antigravity",
  "omnicode",
];

function isHarnessSource(source: SkillSource): source is Extract<SkillSource, HarnessId> {
  return source in HARNESS_TITLE;
}

/** Inspect and manage file skills without modifying provider-owned catalogs. */
export function SkillsPage({
  cwd,
  header,
  agentPicker,
}: {
  cwd: string;
  header?: ReactNode;
  /** Renders the agent filter with the host's dropdown control. */
  agentPicker?: (props: AgentPickerProps) => ReactNode;
}): ReactNode {
  const { t: uiT } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const previewId = useId();
  const previewOpener = useRef<string | null>(null);
  const previewButtons = useRef(new Map<string, HTMLButtonElement>());
  const filterInput = useRef<HTMLInputElement>(null);
  const closePreview = useRef<HTMLButtonElement>(null);
  const addSkillButton = useRef<HTMLButtonElement>(null);
  const listQuery = useQuery(skillsQuery(cwd), queryClient);
  const skills = listQuery.data ?? null;
  const error = errorMessage(listQuery.error) ?? null;
  const [query, setQuery] = useState("");
  const [agent, setAgent] = useState<string>(ALL_AGENTS);
  const [adding, setAdding] = useState(false);
  const [disabledPaths, setDisabledPaths] = useState<string[]>(() =>
    loadDisabledSkillPaths(),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<DiscoveredSkill | null>(
    null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewQuery = useQuery({
    ...skillDocumentQuery(previewSkill?.path ?? ""),
    enabled: previewOpen && !!previewSkill,
  }, queryClient);
  const previewText = previewQuery.data ?? null;
  const previewError = previewQuery.error ? uiT("Could not read SKILL.md. {error}", {
    error: previewQuery.error instanceof Error ? previewQuery.error.message : String(previewQuery.error),
  }) : null;
  const createMutation = useMutation({
    mutationFn: ({ name, scope }: { name: string; scope: "project" | "user" }) => withToast(
      () => createBlankSkill({ cwd, name, scope }),
      { loading: uiT("Creating skill…"), success: uiT("Created skill {name}", { name }) },
    ),
    onSuccess: () => {
      window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
      setAdding(false);
    },
  }, queryClient);
  const busy = createMutation.isPending;
  const createError = errorMessage(createMutation.error) ?? null;
  const [previewMode, setPreviewMode] = useMarkdownMode(
    `skill:${previewSkill?.path ?? ""}`,
  );
  const visible = useSurfaceVisibility();
  const previewVisible = visible && previewOpen;
  const { foldState, finish } = useCollapseMotion(previewVisible);

  const onPreview = (
    skill: DiscoveredSkill,
    trigger: "name" | "icon",
  ): void => {
    previewOpener.current = `${trigger}:${skill.path}`;
    if (previewOpen && previewSkill?.path === skill.path) {
      setPreviewOpen(false);
      return;
    }
    setPreviewSkill(skill);
    setPreviewOpen(true);
  };

  const registerPreviewButton =
    (key: string) =>
    (button: HTMLButtonElement | null): void => {
      if (button) previewButtons.current.set(key, button);
      else previewButtons.current.delete(key);
    };

  useEffect(() => {
    if (!previewVisible) return;
    closePreview.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setPreviewOpen(false);
    };
    // Handle body focus after controls, before Settings' window listener.
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // A rescan replaces row elements, so restore by skill and trigger identity.
      const opener = previewButtons.current.get(previewOpener.current ?? "");
      const target = opener ?? filterInput.current;
      if (target?.isConnected) target.focus();
    };
  }, [previewVisible]);

  useEffect(() => {
    const onChange = (): void => {
      setDisabledPaths(loadDisabledSkillPaths());
      void invalidateAfterChange(["skills", "list"]);
    };
    window.addEventListener(SKILLS_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(SKILLS_CHANGE_EVENT, onChange);
  }, []);

  const agentOptions = useMemo(() => {
    const present = new Set((skills ?? []).map((skill) => skill.source));
    const options: AgentPickerProps["options"] = [
      { value: ALL_AGENTS, label: uiT("All agents") },
    ];
    for (const source of SOURCE_ORDER) {
      if (!present.has(source)) continue;
      options.push(
        isHarnessSource(source)
          ? {
              value: source,
              label: HARNESS_TITLE[source],
              icon: <HarnessIcon harness={source} className="size-3.5" />,
            }
          : {
              value: source,
              label:
                source === "agents" ? uiT("Shared (.agents)") : "OmniCode",
            },
      );
    }
    return options;
  }, [skills, uiT]);
  // A rescan can drop the selected agent's last skill; fall back to all.
  const activeAgent = agentOptions.some((option) => option.value === agent)
    ? agent
    : ALL_AGENTS;

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (skills ?? []).filter(
        (skill) =>
          (activeAgent === ALL_AGENTS || skill.source === activeAgent) &&
          (!needle ||
          skill.name.toLowerCase().includes(needle) ||
          skill.description.toLowerCase().includes(needle) ||
          skill.source.toLowerCase().includes(needle) ||
          skill.path.toLowerCase().includes(needle)),
      ),
    [activeAgent, needle, skills],
  );

  const onToggle = (path: string, enabled: boolean): void => {
    const next = enabled
      ? disabledPaths.filter((item) => item !== path)
      : [...disabledPaths, path];
    try {
      saveDisabledSkillPaths(next);
      setActionError(null);
    } catch {
      setActionError("Could not save the skill preference. Try again.");
    }
  };

  const onReveal = (path: string): void => {
    setActionError(null);
    void revealItemInDir(path).catch((err: unknown) => {
      setActionError(
        `Could not open the folder: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const onCopyPath = (path: string): void => {
    setActionError(null);
    void copyText(path).catch(() => {
      setActionError("Could not copy the path to the clipboard.");
    });
  };

  const onCreate = (name: string, scope: "project" | "user"): void => createMutation.mutate({ name, scope });

  return (
    <div className="@container/skills flex min-h-0 min-w-0 flex-1">
      <motionElement.div
      initial={false} animate={{ "--skills-preview-track": previewVisible ? "1fr" : "0fr" }} transition={motionPreferenceQuery().matches ? immediateTransition : panelTransition} onAnimationComplete={finish}
        className="skills-page-layout animated-collapse-size grid min-h-0 min-w-0 flex-1 overflow-hidden"
        data-fold-state={foldState}

      >
        <div
          ref={lockOverscroll}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
        >
          <div
            className={cn("mx-auto w-full max-w-5xl py-8", previewOpen ? "px-4" : "px-8")}
          >
            {header}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {agentPicker?.({
                  value: activeAgent,
                  options: agentOptions,
                  onChange: setAgent,
                })}
                <span className="shrink-0 text-[12px] text-content/40 tabular-nums">
                  {skills == null
                    ? "…"
                    : `${filtered.length} ${filtered.length === 1 ? "skill" : "skills"}`}
                </span>
                <label className="flex h-7 w-52 min-w-0 flex-1 items-center gap-2 rounded-md border border-content/10 px-2 text-content/45">
                  <Search className="size-3.5 shrink-0" />
                  <Input variant="inline"
                    ref={filterInput}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={uiT("Filter")}
                    aria-label={uiT("Filter skills")}
                    spellCheck={false}
                    autoComplete="off"
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
                  />
                </label>
                <Button variant="ghost" size="icon-sm"
                  type="button"
                  aria-label={uiT("Refresh skills")}
                  title={uiT("Rescan skill folders")}
                  disabled={skills === null && !error}
                  onClick={() => {
                    invalidateSkills();
                    window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
                  }}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" size="sm"
                  type="button"
                  aria-label={
                    adding ? uiT("Close skill form") : uiT("Add skill")
                  }
                  ref={addSkillButton}
                  disabled={busy}
                  onClick={() => {
                    setAdding((value) => !value);
                    createMutation.reset();
                  }}
                  title={uiT("Create a starter SKILL.md you can edit")}
                >
                  {adding ? uiT("Close") : uiT("Add skill")}
                </Button>
              </div>
            </div>

            <AnimatedCollapse expanded={adding}>
              <div className="mb-4 overflow-hidden rounded-lg border border-content/10 bg-content/[0.03]">
                <CreateSkillForm
                  key={cwd}
                  query={query}
                  cwd={cwd}
                  monospace={false}
                  error={createError}
                  busy={busy}
                  onCancel={() => {
                    setAdding(false);
                    createMutation.reset();
                    addSkillButton.current?.focus();
                  }}
                  onCreate={onCreate}
                />
              </div>
            </AnimatedCollapse>

            {actionError ? (
              <p role="alert" className="pb-3 text-[12px] text-danger">
                {actionError}
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="text-[12px] text-danger">
                {error}
              </p>
            ) : skills == null ? (
              <p className="text-[12px] text-content/45">
                {uiT("Loading skills…")}
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-content/10">
                {filtered.length === 0 ? (
                  <p className="px-3 py-3 text-[12px] text-content/45">
                    {skills.length === 0
                      ? uiT(
                          "No skills yet. Add skill creates a starter SKILL.md.",
                        )
                      : uiT("No matching skills")}
                  </p>
                ) : (
                  filtered.map((skill) => {
                    const disabled = disabledPaths.includes(skill.path);
                    return (
                      <div
                        key={skill.path}
                        className={cn("border-b border-content/5 px-3 py-2 last:border-b-0", previewOpen && previewSkill?.path === skill.path ? "bg-content/5" : "", disabled ? "opacity-50" : "")}
                      >
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="content"
                            type="button"
                            className="mr-auto block min-w-0 shrink truncate rounded text-left font-sans text-[12px] text-content hover:underline"
                            title={uiT("Preview {value0}", {
                              value0: String(skill.name),
                            })}
                            ref={registerPreviewButton(`name:${skill.path}`)}
                            aria-controls={previewOpen ? previewId : undefined}
                            aria-expanded={previewOpen && previewSkill?.path === skill.path}
                            onClick={() => onPreview(skill, "name")}
                          >
                            {skill.name}
                          </Button>
                          <span className="shrink-0 rounded-full bg-content/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-content/60">
                            {skill.scope === "user"
                              ? uiT("Personal")
                              : skill.scope === "builtin"
                                ? "OmniCode"
                                : uiT("Project")}
                          </span>
                          <span className="w-20 shrink-0 truncate text-right font-sans text-[11px] text-content/40">
                            {skill.source}
                          </span>
                          <Switch
                            aria-label={uiT(
                              "Include {value0} in OmniCode catalog",
                              { value0: String(skill.name) },
                            )}
                            checked={!disabled}
                            onCheckedChange={(checked) => onToggle(skill.path, checked)}
                          />
                        </div>
                        {skill.description ? (
                          <p
                            className="mt-0.5 truncate text-[12px] text-content/55"
                            title={skill.description}
                          >
                            {skill.description}
                          </p>
                        ) : null}
                        <div className="mt-0.5 flex items-center gap-1">
                          <p
                            className="min-w-0 flex-1 truncate font-sans text-[11px] text-content/35"
                            title={skill.path}
                          >
                            {skill.path}
                          </p>
                          <Button variant="ghost" size="icon-xs"
                            type="button"
                            aria-label={uiT("Preview skill {value0}", {
                              value0: String(skill.name),
                            })}
                            title={uiT("Preview skill")}
                            ref={registerPreviewButton(`icon:${skill.path}`)}
                            aria-controls={previewOpen ? previewId : undefined}
                            aria-expanded={previewOpen && previewSkill?.path === skill.path}
                            onClick={() => onPreview(skill, "icon")}
                          >
                            <Eye
                              className="size-3"
                              aria-hidden="true"
                            />
                          </Button>
                          <Button variant="ghost" size="icon-xs"
                            type="button"
                            aria-label={uiT("Copy path of {value0}", {
                              value0: String(skill.name),
                            })}
                            title={uiT("Copy path")}
                            onClick={() => onCopyPath(skill.path)}
                          >
                            <Copy className="size-3" />
                          </Button>
                          <Button variant="ghost" size="icon-xs"
                            type="button"
                            aria-label={uiT(
                              "Reveal {value0} in file explorer",
                              { value0: String(skill.name) },
                            )}
                            title={uiT("Reveal in file manager")}
                            onClick={() => onReveal(skill.path)}
                          >
                            <FolderOpen className="size-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <p className="pt-3 text-[12px] text-content/40">
              {uiT(
                "Hidden skills stay on disk and are excluded from OmniCode's file-skill catalog. Provider-managed skills and native commands are unaffected. Skills live in",
              )}{" "}
              <span className="font-sans">.agents/skills</span>{" "}
              {uiT("for this project and ")}
              <span className="font-sans">~/.agents/skills</span>{" "}
              {uiT("for you personally; harness folders are also picked up.")}
            </p>
          </div>
        </div>
        {previewSkill && (previewVisible || foldState !== "closed") ? (
          <aside
            id={previewId}
            aria-label={uiT("Skill preview")}
            aria-hidden={!previewVisible || undefined}
            inert={!previewVisible}
            className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden border-t border-stroke @3xl/skills:max-w-[720px] @3xl/skills:border-t-0 @3xl/skills:border-l"
          >
            <SurfaceVisibilityContext.Provider value={previewVisible}>
              <header className="flex shrink-0 items-start gap-2 px-4 pt-4 pb-2">
                <h2 className="desktop-pane-heading min-w-0 flex-1 break-words text-[16px] font-semibold text-content">
                  {previewSkill.name}
                </h2>
                <Button variant="ghost" size="icon-sm"
                  ref={closePreview}
                  type="button"
                  aria-label={uiT("Close skill preview")}
                  title={uiT("Close preview (Escape)")}
                  onClick={() => setPreviewOpen(false)}
                >
                  <X className="size-3.5" />
                </Button>
              </header>
              <div className="shrink-0 space-y-3 border-b border-stroke px-4 pt-1 pb-3">
                <p className="select-text break-all text-[11px] text-content/50">
                  {previewSkill.path}
                </p>
                <div className="flex justify-end">
                  <MarkdownModeToggle
                    mode={previewMode}
                    onChange={setPreviewMode}
                  />
                </div>
              </div>
              <div
                key={previewSkill.path}
                className="min-h-0 min-w-0 flex-1 select-text"
              >
                {previewError ? (
                  <p
                    role="alert"
                    className="break-words px-4 py-5 text-[12px] text-danger"
                  >
                    {previewError}
                  </p>
                ) : previewText === null ? (
                  <p
                    role="status"
                    className="px-4 py-5 text-[12px] text-content/50"
                  >
                    {uiT("Loading skill…")}
                  </p>
                ) : previewMode === "preview" ? (
                  <SkillDocumentPreview text={previewText} />
                ) : (
                  <MarkdownSource text={previewText} />
                )}
              </div>
            </SurfaceVisibilityContext.Provider>
          </aside>
        ) : null}
      </motionElement.div>
    </div>
  );
}
