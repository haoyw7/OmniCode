import { useTranslation } from "../../../shared/i18n/useTranslation";
import { ChevronDown } from "../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { sameProjectPath, type RecentProject } from "../../projects/model/recents";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";



export type InboxProjectOption = {
  path: string;
  name: string;
  logoPath: string | null;
  mascotName: string | null;
  mascotColor: string;
};

export function inboxProjectOptions(
  projects: RecentProject[],
  logos: ReturnType<typeof useTabGroupLogos>,
): InboxProjectOption[] {
  const mascots = loadTabGroupMascots();
  const colors = loadTabGroupColors();
  const custom = loadTabGroupCustomColors();
  return [...projects]
    .map((project) => {
      const name = projectName(project.path);
      const key = projectKey(project.path);
      return {
        path: project.path,
        name,
        logoPath: resolveTabGroupLogo(key, logos),
        mascotName: resolveTabGroupMascot(key, mascots),
        mascotColor: resolveTabGroupColor(key, colors, custom, name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function InboxProjectMark({
  project,
}: {
  project: Pick<
    InboxProjectOption,
    "name" | "logoPath" | "mascotName" | "mascotColor"
  >;
}) {
  if (project.logoPath) {
    return (
      <ProjectLogoIcon
        path={project.logoPath}
        className="size-3.5 shrink-0 rounded-sm"
        imageClassName="size-3.5"
      />
    );
  }
  return (
    <ProjectMascot
      project={project.name}
      color={project.mascotColor}
      name={project.mascotName}
      className="size-3 shrink-0"
    />
  );
}

export function InboxProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: InboxProjectOption[];
  value: string;
  onChange: (path: string) => void;
}) {
  const { t: uiT } = useTranslation();
  const visible = useSurfaceVisibility();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected =
    projects.find((project) => sameProjectPath(project.path, value)) ??
    projects[0] ??
    null;

  useEffect(() => {
    if (!visible || !open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (button.current?.contains(target) || menu.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [visible, open]);

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        disabled={projects.length === 0}
        onClick={() => setOpen((next) => !next)}
        className="inline-flex h-7 max-w-48 items-center gap-1.5 rounded-md border border-content/10 bg-content/5 px-2 text-[12px] text-content/80 hover:bg-content/6 hover:text-content disabled:cursor-default disabled:opacity-40"
      >
        {selected ? <InboxProjectMark project={selected} /> : null}
        <span className="min-w-0 truncate">
          {selected?.name ?? uiT("Choose project")}
        </span>
        <ChevronDown
          className="size-3 shrink-0 text-content/45"
        />
      </button>
      {open ? (
        <div
          ref={menu}
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-64 min-w-full max-w-64 overflow-y-auto rounded-lg border border-content/10 bg-content/10 p-1 shadow-xl backdrop-blur-xl outline-none"
        >
          {projects.map((project) => {
            const active = selected
              ? sameProjectPath(project.path, selected.path)
              : false;
            return (
              <button
                key={project.path}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(project.path);
                  setOpen(false);
                }}
                className={`flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[12px] ${
                  active
                    ? "bg-selection text-content"
                    : "text-content/80 hover:bg-content/3 hover:text-content"
                }`}
              >
                <InboxProjectMark project={project} />
                <span className="min-w-0 truncate">{project.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
