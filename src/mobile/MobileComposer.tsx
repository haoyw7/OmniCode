import { IconButton } from "../shared/ui/forms/IconButton";
import { MobileSpinner } from "./MobileSpinner";
import { useMobileComposerDock } from "./useMobileComposerDock";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import {
  ArrowUp,
  AiIdea,
  Camera,
  Check,
  ChevronsUpDown,
  File,
  Folder,
  FolderTree,
  Images,
  Plus,
  Shapes,
  Square,
  X,
} from "../shared/ui/icons";
import { useTranslation } from "../shared/i18n/useTranslation";
import { AnimatedCollapse, useCollapseMotion } from "../shared/ui/AnimatedCollapse";
import { HarnessIcon } from "../features/sessions/ui/HarnessIcon";
import { AttachmentList } from "../features/sessions/ui/AttachmentList";
import { AnimatePresence, motion, usePresence } from "motion/react";
import { immediateTransition, panelTransition, popTransition } from "../shared/motion/tokens";
import { useMotionPreference } from "../shared/motion/useMotionPreference";
import { RuntimeModeIcon } from "../features/sessions/ui/RuntimeModeIcon";
import { MODE_COMMAND_STYLES } from "../features/sessions/ui/modeCommands";
import { PLAN_COMMAND } from "../features/sessions/model/plan";
import { COMPACT_COMMAND } from "../features/sessions/model/compact";
import { rankSkills, slashTokenAt, type SlashToken } from "../features/skills/model/slashCommands";
import type { Skill } from "../features/skills/model/skillTypes";
import { insertMobileSkill } from "./skillCommands";
import { useMobileSkills, type MobileSkillsLoader } from "./useMobileSkills";
import { MobileSkillList } from "./MobileSkillList";
import {
  RUNTIME_MODES,
  RUNTIME_MODE_LABEL,
  type Attachment,
} from "../features/sessions/model/session";
import type {
  HostModelCatalog,
  HostProject,
} from "../features/connections/model/protocol";
import {
  MobileModelControls,
  configurationLabels,
  type MobileConfiguration,
} from "./MobileModelControls";
import { MobileSheet, SHEET_WIDTH } from "./MobileSheet";
import {
  MobileWorkspaceControls,
  workspaceLabel,
  type MobileWorkspace,
} from "./MobileWorkspaceControls";
import type { MobileBranches, MobileWorktrees } from "./client";
import { preserveInputFocus, usePreserveInputFocusOnTouch } from "./inputFocus";
import { useMobileTextareaAutosize } from "./useMobileTextareaAutosize";
import { lightImpact } from "./haptics";
import { keyboardHeight, keyboardTracked } from "./keyboardMotion";

export type MobileComposerPanel =
  | "actions"
  | "permissions"
  | "model"
  | "projects"
  | "skills"
  | "plan"
  | "workspace"
  | null;
const planStyle = MODE_COMMAND_STYLES[PLAN_COMMAND.name];
type Props = {
  context?: ReactNode;
  queue?: ReactNode;
  /** Receives the slot beside the model picker for the session progress capsule. */
  progressSlot?: (element: HTMLDivElement | null) => void;
  value: string;
  onChange: (text: string) => void;
  configuration: MobileConfiguration;
  catalog?: HostModelCatalog;
  catalogLoading?: boolean;
  onConfigurationChange: (value: MobileConfiguration) => void;
  lockedAgent: boolean;
  allowHandoff?: boolean;
  disabled: boolean;
  running: boolean;
  canSend: boolean;
  canStop: boolean;
  working: boolean;
  readingAttachments?: boolean;
  onSend: () => void;
  onStop: () => void;
  panel: MobileComposerPanel;
  onPanelChange: (panel: MobileComposerPanel) => void;
  project?: HostProject;
  projects: HostProject[];
  onProjectChange: (project: HostProject) => void;
  attachments: Attachment[];
  onFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  planMode: boolean;
  onPlanModeChange: (enabled: boolean) => void;
  skillsContextKey?: string;
  loadSkills?: MobileSkillsLoader;
  canCompact?: boolean;
  /** A pending question holds the bottom: shrink to one line until focused. */
  compact?: boolean;
  /** The compact line was focused; give the composer back its full height. */
  onExpand?: () => void;
  /** A new conversation's working copy; omitted when the Host cannot create worktrees. */
  workspace?: {
    value: MobileWorkspace;
    onChange: (workspace: MobileWorkspace) => void;
    loadBranches: () => Promise<MobileBranches>;
    loadWorktrees: () => Promise<MobileWorktrees>;
    /** The first send is creating the worktree. */
    creating?: boolean;
  };
};

function MobileAttachmentPresence({ children }: { children: ReactNode }) {
  const [present, safeToRemove] = usePresence();
  useLayoutEffect(() => { if (!present) safeToRemove?.(); }, [present, safeToRemove]);
  // The parent owns the reversible exit. Once it releases this child (or
  // reduced motion removes it), layout projection must not retain its DOM.
  return present ? children : null;
}

/** Attachment content stays inert while Motion completes its reversible exit. */
function MobileComposerAttachments({ attachments, onRemove }: {
  attachments: Attachment[];
  onRemove?: (id: string) => void;
}) {
  const reduced = useMotionPreference();
  const [retained, setRetained] = useState(attachments);
  if (attachments.length && retained !== attachments) setRetained(attachments);
  const shown = attachments.length ? attachments : reduced ? [] : retained;
  const closing = !attachments.length && shown.length > 0;
  const content = shown.length ? <MobileAttachmentPresence key="attachments"><motion.div layout="position"
    transition={reduced ? immediateTransition : popTransition}>
    <AttachmentList animated className="mobile-composer-attachments"
      attachments={shown} onRemove={closing ? undefined : onRemove} />
  </motion.div></MobileAttachmentPresence> : null;
  return <motion.div
    className="mobile-composer-attachment-region"
    layout="position"
    data-closing={closing || undefined}
    inert={closing || undefined}
    aria-hidden={closing || undefined}
    initial={false}
    animate={{ opacity: closing ? 0 : 1 }}
    transition={reduced ? immediateTransition : popTransition}
    onAnimationComplete={() => { if (closing) setRetained([]); }}
  >
    <AnimatePresence>{content}</AnimatePresence>
  </motion.div>;
}

function useMobileComposerController(props: Props) {
  const { t } = useTranslation();
  const area = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  usePreserveInputFocusOnTouch(form, area, true);
  const camera = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const pickerFocus = useRef<{
    field: HTMLTextAreaElement;
    selection: [number, number, "forward" | "backward" | "none"];
    keyboardOpen: boolean;
  } | undefined>(undefined);
  const panelAnchor = useRef<HTMLButtonElement>(null);
  const skillListId = useId();
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [skillActive, setSkillActive] = useState(0);
  const dismissedSlash = useRef<string | null>(null);
  const insertion = useRef({ start: props.value.length, end: props.value.length });
  const skillsKey = props.skillsContextKey ?? `${props.project?.id ?? ""}\0${props.configuration.harness}`;
  const nativeGuess = props.configuration.harness === "pi" || props.configuration.harness === "omp";
  const inlineOpen = !!slash && props.panel === null && !props.disabled;
  const skillsState = useMobileSkills(skillsKey, props.loadSkills, inlineOpen || props.panel === "actions" || props.panel === "skills", nativeGuess);
  const native = skillsState.catalog?.native ?? nativeGuess;
  const commands = useMemo(() => [PLAN_COMMAND,
    ...(props.canCompact && (skillsState.catalog?.canCompact ?? true) ? [COMPACT_COMMAND] : []),
    ...(skillsState.catalog?.skills ?? []).filter(skill => !["operator", "mono", "omnicode"].includes(skill.name) &&
      (skill.kind === "native" || !["plan", "compact", "orchestrator", "draft", "btw", "mcp", "add-to-folder"].includes(skill.name))),
  ], [props.canCompact, skillsState.catalog]);
  const options = rankSkills(commands, inlineOpen ? slash?.query ?? "" : "");
  useEffect(() => { setSlash(null); setSkillActive(0); pickerFocus.current = undefined; }, [skillsKey]);
  useEffect(() => { setSkillActive(0); }, [slash?.query]);
  useEffect(() => {
    if (props.disabled) setSlash(null);
  }, [props.disabled]);
  const syncSkillToken = (element: HTMLTextAreaElement) => {
    insertion.current = { start: element.selectionStart, end: element.selectionEnd };
    if (dismissedSlash.current === `${element.value}\0${element.selectionStart}\0${element.selectionEnd}`) return;
    dismissedSlash.current = null;
    setSlash(slashTokenAt(element.value, element.selectionStart, native));
  };
  const dismissSkills = () => {
    const element = area.current;
    if (element) dismissedSlash.current = `${element.value}\0${element.selectionStart}\0${element.selectionEnd}`;
    setSlash(null);
  };
  const pickSkill = (skill: Skill) => {
    if (props.disabled || !area.current) return;
    const point = slash ? { start: slash.start + 1 + slash.query.length, end: slash.end } : insertion.current;
    const result = insertMobileSkill(props.value, point.start, point.end, skill);
    setSlash(null);
    props.onPanelChange(null);
    props.onChange(result.text);
    requestAnimationFrame(() => {
      const element = area.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(result.cursor, result.cursor);
      insertion.current = { start: result.cursor, end: result.cursor };
    });
  };
  const { modelName, effort } = configurationLabels(
    props.catalog,
    props.configuration,
    props.lockedAgent ? props.configuration.model : undefined,
  );
  const close = useCallback(() => props.onPanelChange(null), [props.onPanelChange]);
  const workspace = !props.lockedAgent ? props.workspace : undefined;
  const workspaceText = workspace && workspaceLabel(workspace.value, workspace.creating);
  const workspaceName = workspaceText && ("key" in workspaceText ? t(workspaceText.key) : workspaceText.text);
  const hasQueue = !!props.queue;
  useMobileComposerDock(dock, form, hasQueue);
  useMobileTextareaAutosize(area, props.value, {
    minHeight: 24,
    widthSource: dock,
    measureWidth: () => {
      const container = form.current;
      const source = dock.current;
      if (!container || !source) return 0;
      const formStyle = getComputedStyle(container);
      const dockStyle = getComputedStyle(source);
      const inset = parseFloat(formStyle.getPropertyValue("--mobile-composer-input-inset")) || 18;
      return source.clientWidth -
        (parseFloat(dockStyle.paddingLeft) || 0) -
        (parseFloat(dockStyle.paddingRight) || 0) -
        (parseFloat(formStyle.borderLeftWidth) || 0) -
        (parseFloat(formStyle.borderRightWidth) || 0) - inset * 2;
    },
  });
  useEffect(() => {
    // Saving an existing session's configuration briefly disables the composer.
    // Keep its model sheet open so another option can be chosen after saving.
    if (props.disabled && props.panel !== "model") props.onPanelChange(null);
  }, [props.disabled, props.panel, props.onPanelChange]);
  useEffect(() => {
    if (props.panel !== null) return;
    // Dismiss the keyboard on an outside tap while keeping the card visible. Touch
    // scrolling cancels the pointer or moves it past the tap threshold.
    let start: { id: number; x: number; y: number } | undefined;
    const outside = (target: EventTarget | null) =>
      target instanceof Element &&
      !form.current?.parentElement?.contains(target) &&
      !target.closest(".mobile-sheet-backdrop") &&
      // Jumping to the latest message should not lower the keyboard under the
      // finger before the click lands.
      !target.closest(".mobile-jump");
    const down = (event: PointerEvent) => {
      start = outside(event.target)
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : undefined;
    };
    const up = (event: PointerEvent) => {
      if (!start || start.id !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      start = undefined;
      if (moved > 10) return;
      if (form.current?.contains(document.activeElement))
        (document.activeElement as HTMLElement).blur();
    };
    const cancel = () => {
      start = undefined;
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
    };
  }, [props.panel]);
  // The compact line carries its own send/stop button while the toolbar folds.
  const inline = useCollapseMotion(!!props.compact);
  // Acknowledge the tap on the button. The app clears the draft as it adds the
  // message's bubble: at once while it sends, or when a queued send is accepted.
  const [launching, setLaunching] = useState(false);
  useEffect(() => {
    if (launching && !props.working) setLaunching(false);
  }, [launching, props.working]);
  const launch = () => {
    if (props.value.trim() || props.attachments.length) {
      void lightImpact();
      setLaunching(true);
    }
    props.onSend();
  };
  const sendButton = (
    props.running && !props.value.trim() && !props.attachments.length ? (
      <button
        type="button"
        className="mobile-send"
        data-stop="true"
        data-state={props.working ? "stopping" : "streaming"}
        disabled={!props.canStop || props.working}
        aria-label={t("Stop")}
        onClick={props.onStop}
      >
        {props.working ? <MobileSpinner size={24} className="mobile-spin" /> : <Square size={16} fill="currentColor" />}
      </button>
    ) : (
      <button
        type="submit"
        className="mobile-send"
        data-state={props.working ? "sending" : "ready"}
        disabled={!props.canSend}
        aria-label={t("Send message")}
      >
        {props.working ? (
          <MobileSpinner size={20} className="mobile-spin" />
        ) : (
          <ArrowUp size={20} />
        )}
      </button>
    )
  );
  const openFilePicker = (input: HTMLInputElement | null) => {
    const field = area.current;
    pickerFocus.current = field && document.activeElement === field ? {
      field,
      selection: [field.selectionStart, field.selectionEnd, field.selectionDirection],
      keyboardOpen: !keyboardTracked() || keyboardHeight() > 0,
    } : undefined;
    close();
    input?.click();
  };
  const restorePickerFocus = useCallback(() => {
    const saved = pickerFocus.current;
    pickerFocus.current = undefined;
    if (!saved || saved.field !== area.current || !saved.field.isConnected ||
      saved.field.disabled || saved.field.closest('[inert], [aria-hidden="true"]')) return;
    const active = document.activeElement;
    if (active !== saved.field && active?.matches('input:not([type="file"]), textarea, select, [contenteditable]')) return;
    saved.field.focus({ preventScroll: true });
    saved.field.setSelectionRange(...saved.selection);
    // Android may retain DOM focus while its native picker dismisses the IME.
    if (saved.keyboardOpen && !keyboardHeight() && Capacitor.getPlatform() === "android")
      void Keyboard.show().catch(() => undefined);
  }, []);
  useEffect(() => {
    // React's cancel handler is specific to dialogs; file pickers emit their
    // own native cancel event, including when the same file is reselected.
    const inputs = [camera.current, photos.current, files.current];
    for (const input of inputs) input?.addEventListener("cancel", restorePickerFocus);
    return () => {
      for (const input of inputs) input?.removeEventListener("cancel", restorePickerFocus);
      pickerFocus.current = undefined;
    };
  }, [restorePickerFocus]);
  const selectFiles = (input: HTMLInputElement) => {
    const selected = Array.from(input.files ?? []);
    input.value = "";
    restorePickerFocus();
    if (selected.length) props.onFiles(selected);
  };
  return {
    area,
    camera,
    close,
    dismissSkills,
    dismissedSlash,
    dock,
    effort,
    files,
    form,
    inline,
    inlineOpen,
    launch,
    launching,
    modelName,
    openFilePicker,
    options,
    panelAnchor,
    photos,
    pickSkill,
    props,
    selectFiles,
    sendButton,
    setSkillActive,
    skillActive,
    skillListId,
    skillsState,
    syncSkillToken,
    t,
    workspace,
    workspaceName,
  };
}

type MobileComposerViewModel = ReturnType<typeof useMobileComposerController>;

function MobileComposerView({ vm }: { vm: MobileComposerViewModel }) {
  const {
    area,
    camera,
    close,
    dismissSkills,
    dismissedSlash,
    dock,
    effort,
    files,
    form,
    inline,
    inlineOpen,
    launch,
    launching,
    modelName,
    openFilePicker,
    options,
    panelAnchor,
    photos,
    pickSkill,
    props,
    selectFiles,
    sendButton,
    setSkillActive,
    skillActive,
    skillListId,
    skillsState,
    syncSkillToken,
    t,
    workspace,
    workspaceName,
  } = vm;
  return (
    <>
      <motion.div ref={dock} className="mobile-composer-dock" layout="position" layoutRoot transition={panelTransition}>
        {inlineOpen && <div className="mobile-sheet mobile-command-suggestions">
          <div className="mobile-skill-heading"><strong>{t("Skills and commands")}</strong>
            <IconButton type="button" label={t("Close suggestions")}
              onPointerDown={event => event.preventDefault()} onClick={dismissSkills}><X size={24} /></IconButton>
          </div>
          <MobileSkillList skills={options} loading={skillsState.loading} failed={!!skillsState.failed} error={skillsState.error}
            active={skillActive} id={skillListId} onPick={pickSkill} onActive={setSkillActive} onRetry={() => void skillsState.reload(true)} />
        </div>}
        {props.context}
        {props.queue ? <div className="mobile-message-queue">{props.queue}</div> : null}
        <motion.form
          layout
          transition={panelTransition}
          ref={form}
          className="mobile-composer mobile-composer-card"
          data-compact={props.compact || undefined}
          data-launching={launching || undefined}
          onPointerDownCapture={(event) => {
            if ((event.target as Element).closest("button"))
              preserveInputFocus(event, area.current);
          }}
          onMouseDownCapture={(event) => {
            if ((event.target as Element).closest("button"))
              preserveInputFocus(event, area.current);
          }}
          onClick={(event) => {
            if (!props.disabled && (event.target === event.currentTarget ||
              (event.target as Element).classList.contains("mobile-composer-input")))
              area.current?.focus();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (props.canSend) launch();
          }}
        >
          <motion.div
            layout="position"
            transition={panelTransition}
            className="mobile-composer-context"
            inert={props.compact || undefined}
            aria-hidden={props.compact || undefined}
          >
            <button
              type="button"
              className="mobile-composer-model"
              title={[modelName, effort && t(effort)].filter(Boolean).join(" · ")}
              disabled={props.disabled || props.running}
              aria-label={t("Model and reasoning")}
              aria-haspopup="dialog"
              aria-expanded={props.panel === "model"}
              aria-busy={props.catalogLoading || undefined}
              onClick={(event) => {
                panelAnchor.current = event.currentTarget;
                props.onPanelChange("model");
              }}
            >
              <HarnessIcon harness={props.configuration.harness} className="mobile-composer-agent-icon" />
              <span className="mobile-composer-model-label">
                <strong>{modelName}</strong>
                {effort && <small>{t(effort)}</small>}
              </span>
              {props.catalogLoading ? (
                <MobileSpinner size={16} className="mobile-spin" role="status" aria-label={t("Loading…")} />
              ) : (
                <ChevronsUpDown size={16} aria-hidden="true" />
              )}
            </button>
            {workspace && (
              <button
                type="button"
                className="mobile-composer-workspace"
                data-worktree={workspace.value.mode === "worktree" || workspace.value.linkedWorktree || undefined}
                title={workspace.value.cwd ?? workspaceName}
                disabled={props.disabled || props.running || workspace.creating}
                aria-label={t("Workspace: {value0}", { value0: workspaceName ?? "" })}
                aria-haspopup="dialog"
                aria-expanded={props.panel === "workspace"}
                aria-busy={workspace.creating || undefined}
                onClick={(event) => {
                  panelAnchor.current = event.currentTarget;
                  props.onPanelChange("workspace");
                }}
              >
                {workspace.value.mode === "worktree" || workspace.value.linkedWorktree
                  ? <FolderTree size={16} aria-hidden="true" />
                  : <Folder size={16} aria-hidden="true" />}
                <span>{workspaceName}</span>
                {workspace.creating ? (
                  <MobileSpinner size={16} className="mobile-spin" aria-hidden="true" />
                ) : (
                  <ChevronsUpDown size={16} aria-hidden="true" />
                )}
              </button>
            )}
            {props.progressSlot && <div ref={props.progressSlot} className="mobile-composer-progress" />}
          </motion.div>
          <motion.div layout transition={panelTransition} data-ui="message-input" className="mobile-composer-input">
            <MobileComposerAttachments
              attachments={props.attachments}
              onRemove={props.disabled ? undefined : props.onRemoveAttachment}
            />
            <div className="mobile-composer-line">
            <textarea
              data-ui="message-input-field"
              ref={area}
              aria-label={t("Message")}
              placeholder={t(
                props.compact
                  ? "Add to the conversation…"
                  : props.running ? "Agent is working…" : "Assign a task or type / for more",
              )}
              onFocus={() => {
                if (props.compact) props.onExpand?.();
              }}
              rows={1}
              value={props.value}
              onChange={(event) => { dismissedSlash.current = null; props.onChange(event.target.value); syncSkillToken(event.currentTarget); }}
              onSelect={(event) => syncSkillToken(event.currentTarget)}
              aria-autocomplete="list"
              aria-expanded={inlineOpen}
              aria-controls={inlineOpen ? skillListId : undefined}
              aria-activedescendant={inlineOpen && options.length ? `${skillListId}-${Math.min(skillActive, options.length - 1)}` : undefined}
              disabled={props.disabled}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (inlineOpen && !event.metaKey && !event.ctrlKey) {
                  if (event.key === "Escape") { event.preventDefault(); dismissSkills(); return; }
                  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) {
                    event.preventDefault();
                    setSkillActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
                    return;
                  }
                  if ((event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) && options.length) {
                    event.preventDefault(); pickSkill(options[Math.min(skillActive, options.length - 1)]!); return;
                  }
                }
                if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey) &&
                  !event.nativeEvent.isComposing &&
                  props.canSend
                ) {
                  event.preventDefault();
                  launch();
                }
              }}
            />
              {inline.foldState !== "closed" ? (
                <motion.span
                  initial={false}
                  animate={{ opacity: props.compact ? 1 : 0 }}
                  transition={popTransition}
                  onAnimationComplete={inline.finish}
                  className="mobile-composer-inline"
                  data-fold-state={inline.foldState}
                  inert={!props.compact || undefined}
                  aria-hidden={!props.compact || undefined}
                >
                  {sendButton}
                </motion.span>
              ) : null}
            </div>
            <AnimatedCollapse expanded={!props.compact} className="mobile-composer-toolbar-collapse">
            <div className="mobile-composer-toolbar">
              <button
                type="button"
                className="mobile-composer-action mobile-composer-add"
                aria-label={t("Add to message")}
                aria-haspopup="dialog"
                aria-expanded={props.panel === "actions"}
                disabled={props.disabled || props.readingAttachments}
                onClick={(event) => {
                  panelAnchor.current = event.currentTarget;
                  setSkillActive(0);
                  props.onPanelChange("actions");
                }}
              >
                <Plus size={24} />
              </button>
              <div className="mobile-composer-controls">
                {props.planMode && (
                  <button
                    type="button"
                    className={`mobile-composer-plan ${planStyle.pill?.className ?? planStyle.className}`}
                    disabled={props.disabled}
                    aria-label={t("Plan mode")}
                    title={t("Plan mode")}
                    aria-haspopup="dialog"
                    aria-expanded={props.panel === "plan"}
                    onClick={(event) => {
                      panelAnchor.current = event.currentTarget;
                      props.onPanelChange("plan");
                    }}
                  >
                    <planStyle.Icon size={20} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="mobile-composer-action mobile-composer-permissions"
                  data-full-access={
                    props.configuration.runtimeMode === "full-access"
                  }
                  aria-label={t("Permissions: {mode}", {
                    mode: t(RUNTIME_MODE_LABEL[props.configuration.runtimeMode]),
                  })}
                  title={t(RUNTIME_MODE_LABEL[props.configuration.runtimeMode])}
                  aria-haspopup="dialog"
                  aria-expanded={props.panel === "permissions"}
                  disabled={props.disabled || props.running}
                  onClick={(event) => {
                    panelAnchor.current = event.currentTarget;
                    props.onPanelChange("permissions");
                  }}
                >
                  <RuntimeModeIcon
                    mode={props.configuration.runtimeMode}
                    size={20}
                    className={
                      props.configuration.runtimeMode === "full-access"
                        ? "text-amber-400/90"
                        : undefined
                    }
                  />
                </button>
              </div>
              {sendButton}
            </div>
            </AnimatedCollapse>
          </motion.div>
          <input
            ref={camera}
            type="file"
            hidden
            accept="image/*"
            capture="environment"
            aria-label={t("Take photo")}
            disabled={props.disabled || props.readingAttachments}
            onChange={(event) => selectFiles(event.currentTarget)}
          />
          <input
            ref={photos}
            type="file"
            hidden
            accept="image/*"
            multiple
            aria-label={t("Upload photos")}
            disabled={props.disabled || props.readingAttachments}
            onChange={(event) => selectFiles(event.currentTarget)}
          />
          <input
            ref={files}
            type="file"
            hidden
            multiple
            aria-label={t("Upload files")}
            disabled={props.disabled || props.readingAttachments}
            onChange={(event) => selectFiles(event.currentTarget)}
          />
        </motion.form>
      </motion.div>
      <MobileModelControls
        open={props.panel === "model"}
        anchor={panelAnchor}
        preserveFocus={area}
        catalog={props.catalog}
        loading={props.catalogLoading}
        configuration={props.configuration}
        lockedAgent={props.lockedAgent}
        allowHandoff={props.allowHandoff}
        disabled={props.disabled}
        onChange={props.onConfigurationChange}
        onClose={close}
      />
      {workspace && props.project && (
        <MobileWorkspaceControls
          key={props.project.id}
          open={props.panel === "workspace"}
          anchor={panelAnchor}
          preserveFocus={area}
          workspace={workspace.value}
          disabled={props.disabled || props.running || !!workspace.creating}
          loadBranches={workspace.loadBranches}
          loadWorktrees={workspace.loadWorktrees}
          onChange={workspace.onChange}
          onClose={close}
        />
      )}
      <MobileSheet
        open={props.panel === "plan"}
        title="Plan mode"
        placement="anchor"
        anchor={panelAnchor}
        preserveFocus={area}
        width={SHEET_WIDTH.menu}
        side="top"
        onClose={close}
      >
        {() => (
        <button
          type="button"
          className="mobile-sheet-row"
          aria-label={t("Turn off plan mode")}
          disabled={props.disabled}
          onClick={() => {
            close();
            props.onPlanModeChange(false);
          }}
        >
          <X size={20} />
          <span>{t("Turn off")}</span>
        </button>
        )}
      </MobileSheet>
      <MobileSheet
        open={props.panel === "permissions"}
        title="Permissions"
        placement="anchor"
        anchor={panelAnchor}
        preserveFocus={area}
        width={SHEET_WIDTH.list}
        onClose={close}
      >
        {() => (
        <div role="radiogroup" aria-label={t("Permissions")}>
          {RUNTIME_MODES.map((mode) => (
            <button
              type="button"
              role="radio"
              className="mobile-sheet-row"
              key={mode}
              aria-checked={props.configuration.runtimeMode === mode}
              disabled={props.disabled}
              onClick={() => {
                close();
                props.onConfigurationChange({
                  ...props.configuration,
                  runtimeMode: mode,
                });
              }}
            >
              <RuntimeModeIcon
                mode={mode}
                size={20}
                className={
                  mode === "full-access"
                    ? "text-amber-400/90"
                    : "text-content/70"
                }
              />
              <span className="mobile-sheet-row-text">
                <strong>{t(RUNTIME_MODE_LABEL[mode])}</strong>
              </span>
              {props.configuration.runtimeMode === mode && (
                <Check size={20} />
              )}
            </button>
          ))}
        </div>
        )}
      </MobileSheet>
      <MobileSheet
        open={props.panel === "actions"}
        title="Add to message"
        placement="anchor"
        anchor={panelAnchor}
        preserveFocus={area}
        width={SHEET_WIDTH.menu}
        side="top"
        onClose={close}
      >
        {() => <>
        <button
          type="button"
          className="mobile-sheet-row"
          disabled={props.disabled || props.readingAttachments}
          onClick={() => openFilePicker(camera.current)}
        >
          <Camera size={20} />
          <span>{t("Camera")}</span>
        </button>
        <button
          type="button"
          className="mobile-sheet-row"
          disabled={props.disabled || props.readingAttachments}
          onClick={() => openFilePicker(photos.current)}
        >
          <Images size={20} />
          <span>{t("Gallery")}</span>
        </button>
        <button
          type="button"
          className="mobile-sheet-row"
          disabled={props.disabled || props.readingAttachments}
          onClick={() => openFilePicker(files.current)}
        >
          <File size={20} />
          <span>{t("Files")}</span>
        </button>
        <div className="mobile-menu-divider" role="separator" />
        {props.loadSkills && (
          <button type="button" className="mobile-sheet-row" aria-haspopup="dialog"
            disabled={props.disabled}
            onClick={() => { setSkillActive(0); props.onPanelChange("skills"); }}>
            <Shapes size={20} />
            <span>{t("Skills")}</span>
          </button>
        )}
        <button
          type="button"
          className="mobile-sheet-row"
          role="switch"
          aria-checked={props.planMode}
          disabled={props.disabled}
          onClick={() => {
            close();
            props.onPlanModeChange(!props.planMode);
          }}
        >
          <AiIdea size={20} className="text-yellow-300/80" />
          <span>{t("Plan mode")}</span>
          {props.planMode && <Check size={20} />}
        </button>
        {!props.lockedAgent && (
          <button type="button" className="mobile-sheet-row" aria-label={t("Choose project")}
            disabled={props.disabled || props.running || !props.projects.length}
            onClick={() => props.onPanelChange("projects")}>
            <Folder size={20} />
            <span>{t("Choose project")}</span>
          </button>
        )}
        </>}
      </MobileSheet>
      {props.loadSkills && (
        <MobileSheet
          open={props.panel === "skills"}
          title="Skills"
          header={{ title: t("Skills") }}
          preserveFocus={area}
          onClose={close}
        >
          {() => (
            <MobileSkillList grouped skills={options.filter(skill => skill !== PLAN_COMMAND)} loading={skillsState.loading}
              failed={!!skillsState.failed} error={skillsState.error} active={skillActive} id={skillListId}
              onPick={pickSkill} onActive={setSkillActive} onRetry={() => void skillsState.reload(true)} />
          )}
        </MobileSheet>
      )}
      <MobileSheet
        open={props.panel === "projects" && !props.lockedAgent}
        title="Choose project"
        placement="anchor"
        anchor={panelAnchor}
        preserveFocus={area}
        width={SHEET_WIDTH.list}
        side="top"
        onClose={close}
      >
        {() => (
        <div
          className="mobile-project-options"
          role="radiogroup"
          aria-label={t("Projects")}
        >
          {props.projects.map((project) => (
            <button
              type="button"
              className="mobile-sheet-row"
              role="radio"
              key={project.id}
              disabled={props.disabled}
              aria-checked={props.project?.id === project.id}
              onClick={() => {
                close();
                if (project.id !== props.project?.id)
                  props.onProjectChange(project);
              }}
            >
              <Folder size={20} />
              <span className="mobile-sheet-row-text">
                <strong>{project.name}</strong>
                <small>{project.machine?.kind === "wsl" ? `WSL · ${project.machine.distribution} · ${project.cwd}` : project.cwd}</small>
              </span>
              {project.id === props.project?.id && <Check size={20} />}
            </button>
          ))}
        </div>
        )}
      </MobileSheet>
    </>
  );
}

export const MobileComposer = memo(function MobileComposer(props: Props) {
  return <MobileComposerView vm={useMobileComposerController(props)} />;
});
