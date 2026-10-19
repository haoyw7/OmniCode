import { useTranslation } from "../../../shared/i18n/useTranslation";
import { showStatusToast, withStatusToast } from "../../../shared/ui/StatusToast";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Loader } from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import {
  CHAT_BACKGROUND_OPACITY_MAX,
  CHAT_BACKGROUND_OPACITY_MIN,
  chatBackgroundSrc,
  loadChatBackgroundOpacity,
  loadChatBackgroundPath,
  loadNewThreadBackgroundEffect,
  NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS,
  NEW_THREAD_BACKGROUND_EFFECT_LABELS,
  NEW_THREAD_BACKGROUND_EFFECTS,
  type NewThreadBackgroundEffect,
} from "../../settings/model/appearance";
import {
  clearProjectChatBackground,
  pickAndSaveProjectChatBackground,
  projectChatBackgroundSrc,
} from "../model/chatBackground";
import {
  clearProjectChatBackgroundSetting,
  loadProjectChatBackgroundSettings,
  projectChatBackgroundImageRevision,
  saveProjectChatBackgroundSettings,
} from "../model/projectChatBackground";
import { useProjectBackgroundEffect } from "./useProjectBackgroundEffect";
import { GradientBlurBackground } from "../../settings/ui/GradientBlurBackground";

type Props = {
  project: string;
  name: string;
  onClose: () => void;
};

export function ProjectBackgroundDialog({ project, name, onClose }: Props) {
  const { t: uiT } = useTranslation();
  const initial = loadProjectChatBackgroundSettings(project);
  const [path, setPath] = useState(initial?.path ?? null);
  const [opacity, setOpacity] = useState(
    initial?.opacity ?? loadChatBackgroundOpacity(),
  );
  const [effect, setEffect] = useState<NewThreadBackgroundEffect>(
    initial?.effect ?? NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  );
  const [revision, setRevision] = useState(projectChatBackgroundImageRevision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const globalPath = loadChatBackgroundPath();
  const effectPreviewSrc = useProjectBackgroundEffect(path, effect, revision);
  const previewSrc = path
    ? (effectPreviewSrc ?? projectChatBackgroundSrc(path, revision))
    : chatBackgroundSrc(globalPath);
  const previewEffect = path ? effect : loadNewThreadBackgroundEffect();

  const save = (
    nextPath: string,
    nextOpacity: number,
    nextEffect: NewThreadBackgroundEffect,
    imageChanged = false,
  ) => {
    saveProjectChatBackgroundSettings(
      project,
      {
        path: nextPath,
        opacity: nextOpacity,
        effect: nextEffect,
      },
      imageChanged,
    );
    setRevision(projectChatBackgroundImageRevision());
  };

  const choose = async () => {
    setBusy(true);
    setError(null);
    try {
      // The file picker is the progress UI here; confirm only the result.
      const nextPath = await pickAndSaveProjectChatBackground(project);
      if (!nextPath) return;
      showStatusToast(uiT("Background updated"));
      save(nextPath, opacity, effect, true);
      setPath(nextPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async () => {
    setBusy(true);
    setError(null);
    try {
      await withStatusToast(() => clearProjectChatBackground(project), {
        loading: uiT("Removing background…"),
        success: uiT("Background removed"),
        error: false,
      });
      clearProjectChatBackgroundSetting(project);
      setPath(null);
      setOpacity(loadChatBackgroundOpacity());
      setEffect(NEW_THREAD_BACKGROUND_EFFECT_DEFAULT);
      setRevision(projectChatBackgroundImageRevision());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const updateOpacity = (percent: number) => {
    const next = Math.min(
      CHAT_BACKGROUND_OPACITY_MAX,
      Math.max(CHAT_BACKGROUND_OPACITY_MIN, percent / 100),
    );
    setOpacity(next);
    if (path) save(path, next, effect);
  };

  const updateEffect = (next: NewThreadBackgroundEffect) => {
    setEffect(next);
    if (path) save(path, opacity, next);
  };

  return (
    <Modal
      title={uiT("Background Image")}
      description={uiT("Choose a background image for {value0}", {
        value0: String(name),
      })}
      size="sm"
      fitViewport
      onClose={onClose}
    >
      <div className="flex flex-col gap-5 p-4">
        <div>
          <div
            className={`overflow-hidden rounded-xl border border-content/10 ${previewEffect === "gradient-blur" ? "bg-background-base" : "bg-content/5"}`}
          >
            {previewSrc ? (
              previewEffect === "gradient-blur" ? (
                <div className="relative h-40">
                  <GradientBlurBackground
                    className="gradient-blur-preview absolute inset-0"
                    style={
                      {
                        "--chat-background-image": `url(${JSON.stringify(previewSrc)})`,
                        opacity,
                      } as CSSProperties
                    }
                  />
                </div>
              ) : (
                <img
                  src={previewSrc}
                  alt=""
                  draggable={false}
                  className="h-40 w-full object-cover"
                  style={{ opacity }}
                />
              )
            ) : (
              <div className="grid h-40 place-items-center text-[12px] text-content/40">
                {uiT("No background selected")}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void choose()}
            disabled={busy}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-content/10 px-2.5 py-1.5 text-[12px] text-content/70 hover:bg-content/6 hover:text-content disabled:opacity-40"
          >
            {busy ? (
              <Loader className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            {path ? uiT("Change image") : uiT("Choose image")}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-content/45">
            {path
              ? uiT(
                  "This image overrides the global background for this project.",
                )
              : uiT(
                  "This project currently follows the global Appearance setting.",
                )}
          </p>
          {error ? (
            <p className="mt-1.5 text-[12px] text-red-400">{error}</p>
          ) : null}
        </div>

        {path ? (
          <div className="border-t border-stroke pt-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <span className="text-[13px] font-medium text-content">
                  {uiT("Background effect")}
                </span>
                <p className="text-[11px] text-content/45 line-clamp-1">
                  {uiT(NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS[effect])}
                </p>
              </div>
              <div className="w-36 shrink-0">
                <SearchableSelect
                  label={uiT("Project background effect")}
                  variant="transparent"
                  value={effect}
                  options={NEW_THREAD_BACKGROUND_EFFECTS.map((option) => ({
                    value: option,
                    label: uiT(NEW_THREAD_BACKGROUND_EFFECT_LABELS[option]),
                  }))}
                  onChange={(next) =>
                    updateEffect(next as NewThreadBackgroundEffect)
                  }
                  searchable={false}
                  align="end"
                />
              </div>
            </div>
          </div>
        ) : null}

        <ProjectBackgroundRow label={uiT("Background image strength")}>
          <div className="flex w-56 items-center gap-3">
            <input
              type="range"
              min={Math.round(CHAT_BACKGROUND_OPACITY_MIN * 100)}
              max={Math.round(CHAT_BACKGROUND_OPACITY_MAX * 100)}
              value={Math.round(opacity * 100)}
              aria-label={uiT("Background image strength")}
              className="sidebar-opacity-slider min-w-0 flex-1"
              onChange={(event) =>
                updateOpacity(Number(event.target.value))
              }
            />
            <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-content">
              {Math.round(opacity * 100)}%
            </span>
          </div>
        </ProjectBackgroundRow>

        {path ? (
          <button
            type="button"
            onClick={() => void removeImage()}
            disabled={busy}
            className="w-full rounded-md border border-content/10 px-2.5 py-1.5 text-[12px] text-red-400 hover:border-red-400/40 hover:bg-red-400/10 disabled:opacity-40"
          >
            {uiT("Remove background image")}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

function ProjectBackgroundRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-stroke pt-4">
      <span className="text-[13px] font-medium text-content">{label}</span>
      {children}
    </div>
  );
}
