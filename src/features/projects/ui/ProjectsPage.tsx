import { Button } from "../../../shared/ui/forms/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Input } from "../../../shared/ui/forms/Input";
import { useEffect, useMemo, useState } from "react";
import { ListMotion, ListMotionItem } from "../../../shared/ui/ListMotion";
import { useSurfaceVisibility } from "../../../shared/ui/SurfaceVisibility";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import {
  Archive,
  Folder,
  Internet,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
} from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { MenuHover } from "../../../shared/ui/MenuHover";
import {
  desktopModeForCwd,
  type DesktopMode,
} from "../../../app/model/desktopMode";
import {
  pathKey,
  prettyCwd,
  projectName,
  projectKey,
} from "../../../shared/lib/paths";
import { usePreferenceState } from "../../settings/model/usePreferenceState";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
  subscribeTabGroupLabels,
} from "../../workspace/model/tabGroups";
import { useChatFolders } from "../model/chatFolders";
import {
  collectRailProjects,
  isRemoteProjectPath,
  loadArchivedProjects,
  loadPinnedProjects,
  subscribeArchivedProjects,
  subscribeProjectPathsChanged,
  toggleProjectPin,
  type RecentProject,
} from "../model/recents";

export function ProjectsPage({
  mode,
  cwd,
  recents,
  onSelect,
  onOpen,
  onNewChat,
  onArchive,
  onRestore,
}: {
  mode: DesktopMode;
  cwd: string;
  recents: RecentProject[];
  onSelect: (path: string) => void;
  onOpen: () => void;
  onNewChat: () => void;
  onArchive: (path: string) => void;
  onRestore: (path: string) => void;
}) {
  const { t } = useTranslation();
  const visible = useSurfaceVisibility();
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState("recent");
  const [archive, setArchive] = useState(loadArchivedProjects);
  const [pins, setPins] = usePreferenceState(loadPinnedProjects);
  const [labels, setLabels] = usePreferenceState(loadTabGroupLabels);
  const chats = useChatFolders();
  const [menu, setMenu] = useState<{ path: string; anchor: HTMLElement }>();
  useEffect(
    () => subscribeArchivedProjects(() => setArchive(loadArchivedProjects())),
    [],
  );
  useEffect(
    () => subscribeTabGroupLabels(() => setLabels(loadTabGroupLabels())),
    [setLabels],
  );
  useEffect(
    () => subscribeProjectPathsChanged(() => setPins(loadPinnedProjects())),
    [setPins],
  );
  useEffect(() => {
    setMenu(undefined);
  }, [mode, visible, archived, query]);
  const projects = useMemo(() => {
    const archivedPaths = new Set(archive.map((item) => pathKey(item.path)));
    const source = archived
      ? archive.map((item) => ({ path: item.path, openedAt: item.archivedAt }))
      : [
          ...collectRailProjects(recents, cwd).values(),
          ...chats.map((path) => ({ path, openedAt: 0 })),
        ];
    const unique = new Map(source.map((item) => [pathKey(item.path), item]));
    return [...unique.values()]
      .filter(
        (item) =>
          desktopModeForCwd(item.path) === mode &&
          (archived || !archivedPaths.has(pathKey(item.path))),
      )
      .filter((item) =>
        `${resolveTabGroupLabel(projectKey(item.path), labels, projectName(item.path))} ${item.path}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      )
      .sort((a, b) =>
        sort === "name"
          ? resolveTabGroupLabel(
              projectKey(a.path),
              labels,
              projectName(a.path),
            ).localeCompare(
              resolveTabGroupLabel(
                projectKey(b.path),
                labels,
                projectName(b.path),
              ),
            )
          : b.openedAt - a.openedAt,
      );
  }, [archive, archived, chats, cwd, labels, mode, query, recents, sort]);
  const pinned = (path: string) =>
    pins.some((item) => pathKey(item) === pathKey(path));
  return (
    <section className="desktop-projects-page" aria-label={t("Projects")}>
      <header className="desktop-collection-header">
        <h1>{t("Projects")}</h1>
      </header>
      <div className="desktop-collection-toolbar">
        <div
          className="desktop-collection-tabs"
          role="tablist"
          aria-label={t("Projects")}
        >
          <Button variant="ghost" size="content"
            type="button"
            role="tab"
            aria-selected={!archived}
            onClick={() => setArchived(false)}
          >
            {t("Your projects")}
          </Button>
          <Button variant="ghost" size="content"
            type="button"
            role="tab"
            aria-selected={archived}
            onClick={() => setArchived(true)}
          >
            {t("Archived")}
          </Button>
        </div>
        <div className="desktop-collection-filters">
          <label className="desktop-collection-search">
            <Search />
            <Input variant="inline"
              aria-label={t("Search projects")}
              placeholder={t("Search projects")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <SearchableSelect
            label={t("Sort projects")}
            value={sort}
            onChange={setSort}
            searchable={false}
            options={[{ value: "recent", label: t("Recently opened") }, { value: "name", label: t("Name") }]}
          />
          <Button variant="ghost" size="content"
            type="button"
            className="desktop-collection-create"
            onClick={mode === "code" ? onOpen : onNewChat}
          >
            <Plus />
            {t(mode === "code" ? "Open project" : "New chat")}
          </Button>
        </div>
      </div>
      <div className="desktop-project-grid">
        <ListMotion enabled={visible}>
        {projects.map((project) => {
          const Icon =
            mode === "chat"
              ? MessageSquare
              : isRemoteProjectPath(project.path)
                ? Internet
                : Folder;
          return (
            <ListMotionItem role="article" className="desktop-project-card" key={project.path}>
              <Button variant="ghost" size="content"
                type="button"
                className="desktop-project-open"
                onClick={() =>
                  archived ? onRestore(project.path) : onSelect(project.path)
                }
              >
                <span className="desktop-project-icon">
                  <Icon />
                </span>
                <span className="desktop-project-name">
                  {resolveTabGroupLabel(
                    projectKey(project.path),
                    labels,
                    projectName(project.path),
                  )}
                  {pinned(project.path) ? <Pin /> : null}
                </span>
                <span data-file-label className="desktop-project-path" title={project.path}>
                  {prettyCwd(project.path)}
                </span>
              </Button>
              <Button variant="ghost" size="content"
                type="button"
                className="desktop-project-more"
                data-menu-trigger="project"
                aria-label={t("Project actions")}
                onClick={(event) =>
                  setMenu({ path: project.path, anchor: event.currentTarget })
                }
              >
                <MenuHover />
                <MoreHorizontal />
              </Button>
            </ListMotionItem>
          );
        })}
        </ListMotion>
      </div>
      {projects.length === 0 ? (
        <p className="desktop-collection-empty">
          {t(
            query
              ? "No matching projects"
              : archived
                ? "No archived projects"
                : "No projects yet",
          )}
        </p>
      ) : null}
      <Popover
        open={Boolean(menu) && visible}
        anchor={menu?.anchor ?? null}
        side="bottom"
        align="end"
        width={200}
        constrainHeight={false}
        onDismiss={() => setMenu(undefined)}
      >
        <div className="desktop-project-menu" role="menu">
          <Button variant="ghost" size="content"
            type="button"
            role="menuitem"
            onClick={() => {
              if (menu) toggleProjectPin(menu.path);
              setMenu(undefined);
            }}
          >
            <MenuHover />
            <Pin />
            <span data-menu-title>{t(menu && pinned(menu.path) ? "Unpin" : "Pin")}</span>
          </Button>
          <Button variant="ghost" size="content"
            type="button"
            role="menuitem"
            onClick={() => {
              if (menu) (archived ? onRestore : onArchive)(menu.path);
              setMenu(undefined);
            }}
          >
            <MenuHover />
            <Archive />
            <span data-menu-title>{t(archived ? "Restore" : "Archive")}</span>
          </Button>
        </div>
      </Popover>
    </section>
  );
}
