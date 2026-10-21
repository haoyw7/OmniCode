import { pathKey, projectName } from "../../../shared/lib/paths";
import { looksLikeProject } from "../../projects/model/recents";
import type { InboxItem } from "../../inbox/model/githubTasks";
import { devicePreferences } from "../../../shared/lib/persistedPreferences";

export type NotificationProject = {
  id: string;
  name: string;
  detail: string;
  kind: "repository" | "local" | "linear" | "jira";
  paths: string[];
};

const CATALOG_KEY = "omnicode.notificationProjects.v2";
let catalogValue: string | null | undefined;
let catalog: NotificationProject[] = [];

function localNotificationProject(path: string): NotificationProject {
  return {
    id: `local:${pathKey(path)}`,
    name: projectName(path),
    detail: path,
    kind: "local",
    paths: [path],
  };
}

export function knownNotificationProject(
  path: string,
): NotificationProject | undefined {
  if (!looksLikeProject(path)) return;
  const key = pathKey(path);
  return (
    loadNotificationProjects().find((project) =>
      project.paths.some((entry) => pathKey(entry) === key),
    ) ?? localNotificationProject(path)
  );
}

export function knownNotificationProjectSelection(
  paths: readonly string[],
): { projects: NotificationProject[] } {
  const requested = new Map(
    paths.filter(looksLikeProject).map((path) => [pathKey(path), path]),
  );
  const stored = loadNotificationProjects();
  const projects = new Map(
    stored
      .filter(
        (project) =>
          project.paths.length === 0 ||
          project.paths.some((path) => requested.has(pathKey(path))),
      )
      .map((project) => [project.id, project]),
  );
  for (const path of requested.values()) {
    const project = knownNotificationProject(path)!;
    projects.set(project.id, project);
  }
  return { projects: [...projects.values()] };
}

export function loadNotificationProjects(): NotificationProject[] {
  try {
    const value = devicePreferences.getItem(CATALOG_KEY);
    if (value === catalogValue) return catalog;
    catalogValue = value;
    catalog = [];
    const parsed: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) return catalog;
    catalog = parsed.filter(
      (value): value is NotificationProject =>
        value &&
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        typeof value.detail === "string" &&
        ["repository", "local", "linear", "jira"].includes(value.kind) &&
        Array.isArray(value.paths) &&
        value.paths.every((path: unknown) => typeof path === "string"),
    );
    return catalog;
  } catch {
    return catalog;
  }
}

export function rememberNotificationProjects(
  projects: readonly NotificationProject[],
) {
  const current = loadNotificationProjects();
  const byId = new Map(current.map((project) => [project.id, project]));
  for (const project of projects) {
    const previous = byId.get(project.id);
    byId.set(project.id, {
      ...project,
      paths: [...new Set([...(previous?.paths ?? []), ...project.paths])],
    });
  }
  const nextProjects = [...byId.values()];
  const next = JSON.stringify(nextProjects);
  if (next === JSON.stringify(current)) return;
  catalog = nextProjects;
  try {
    devicePreferences.setItem(CATALOG_KEY, next, true);
    catalogValue = next;
  } catch {
    // Keep the catalog in memory when browser storage is unavailable.
  }
}

export function notificationProjectsSnapshot(): string {
  return JSON.stringify(loadNotificationProjects());
}

export function subscribeNotificationProjects(
  listener: () => void,
): () => void {
  return devicePreferences.subscribe([CATALOG_KEY], listener);
}

type NotificationWorkItem = Pick<InboxItem, "provider" | "repo" | "url"> &
  Partial<
    Pick<
      InboxItem,
      "projectPath" | "projectId" | "projectName" | "teamId" | "teamName"
    >
  >;

export function inboxNotificationProject(
  item: NotificationWorkItem,
): NotificationProject {
  if (item.provider === "jira") {
    let site = "unknown";
    try {
      site = new URL(item.url).host.toLowerCase();
    } catch {
      // Preserve a usable project identity even if a provider omits the URL.
    }
    return {
      id: `jira:${site}:project:${item.teamId || item.repo.toLowerCase() || "unknown"}`,
      name: item.teamName || item.repo || "Jira project",
      detail: `Jira · ${site}`,
      kind: "jira",
      paths: [],
    };
  }
  if (item.provider === "linear") {
    const project = item.projectId?.trim();
    return {
      id: project
        ? `linear:project:${project}`
        : `linear:team:${item.teamId || "unknown"}:unassigned`,
      name: project ? item.projectName || project : "No project",
      detail: `Linear · ${item.teamName || item.teamId || "Unknown team"}`,
      kind: "linear",
      paths: [],
    };
  }
  if (item.projectPath && looksLikeProject(item.projectPath)) {
    return {
      ...localNotificationProject(item.projectPath),
      name: item.repo || projectName(item.projectPath),
      kind: "repository",
    };
  }
  const remote = repositoryProject(item.url, item.repo);
  if (remote) return remote;
  return {
    id: `repository:${item.provider}:${item.repo.toLowerCase()}`,
    name: item.repo,
    detail: item.provider,
    kind: "repository",
    paths: [],
  };
}

function repositoryProject(
  remote: string,
  repo?: string,
): NotificationProject | undefined {
  try {
    const scp = remote.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/);
    const url = new URL(
      remote.includes("://")
        ? remote
        : scp
          ? `ssh://${scp[1]}/${scp[2]}`
          : remote,
    );
    if (!["http:", "https:", "ssh:", "git:"].includes(url.protocol)) return;
    const name = (repo ?? url.pathname)
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/, "");
    if (!url.hostname || !name.includes("/")) return;
    const host = url.host.toLowerCase();
    return {
      id: `repository:${host}/${name.toLowerCase()}`,
      name,
      detail: host,
      kind: "repository",
      paths: [],
    };
  } catch {
    return;
  }
}
