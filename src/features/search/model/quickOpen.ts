import { fuzzyMatch } from "../../../shared/lib/fuzzy";
import { projectName } from "../../../shared/lib/paths";
import {
  sameProjectPath,
  type RecentProject,
} from "../../projects/model/recents";
import {
  sessionDisplayTitle,
  type HarnessId,
} from "../../sessions/model/session";
import {
  searchConversationTitles,
  searchRecentProjects,
  type ConversationHit,
  type ProjectHit,
} from "./appSearch";

/**
 * One palette for files, commands, sessions and projects. A leading `>`,
 * `#` or `@` picks the mode; anything else searches files.
 */
export type QuickOpenMode = "files" | "commands" | "sessions" | "projects";

export const QUICK_OPEN_PREFIX: Record<
  Exclude<QuickOpenMode, "files">,
  string
> = {
  commands: ">",
  sessions: "#",
  projects: "@",
};

export function parseQuickOpenQuery(raw: string): {
  mode: QuickOpenMode;
  query: string;
} {
  const text = raw.trimStart();
  for (const [mode, prefix] of Object.entries(QUICK_OPEN_PREFIX)) {
    if (text.startsWith(prefix)) {
      return {
        mode: mode as QuickOpenMode,
        query: text.slice(prefix.length).trim(),
      };
    }
  }
  return { mode: "files", query: raw };
}

/** The raw input for `mode`, keeping whatever was typed after the prefix. */
export function quickOpenQueryFor(mode: QuickOpenMode, raw: string): string {
  const { query } = parseQuickOpenQuery(raw);
  return mode === "files" ? query : `${QUICK_OPEN_PREFIX[mode]}${query}`;
}

export type QuickOpenCommand = { id: string; title: string };

export type RankedCommand = QuickOpenCommand & {
  label: string;
  score: number;
  positions: number[];
};

/**
 * Commands matched on their translated label, then the English id and title,
 * so either language finds them. Without a query, recently run commands lead.
 */
export function rankCommands(
  commands: QuickOpenCommand[],
  query: string,
  translate: (text: string) => string,
  recent: string[] = [],
): RankedCommand[] {
  const needle = query.trim();
  if (!needle) {
    const order = (id: string) => {
      const index = recent.indexOf(id);
      return index < 0 ? recent.length : index;
    };
    return commands
      .map((command, index) => ({ command, index }))
      .sort((a, b) => order(a.command.id) - order(b.command.id) || a.index - b.index)
      .map(({ command }) => ({
        ...command,
        label: translate(command.id),
        score: 0,
        positions: [],
      }));
  }
  const ranked: RankedCommand[] = [];
  for (const command of commands) {
    const label = translate(command.id);
    const labelHit = fuzzyMatch(needle, label);
    const hit =
      labelHit ??
      fuzzyMatch(needle, command.id) ??
      fuzzyMatch(needle, translate(command.title)) ??
      fuzzyMatch(needle, command.title);
    if (!hit) continue;
    const recentIndex = recent.indexOf(command.id);
    ranked.push({
      ...command,
      label,
      score: hit.score + (recentIndex < 0 ? 0 : 8 - Math.min(recentIndex, 7)),
      positions: labelHit ? labelHit.positions : [],
    });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

const RECENT_COMMANDS_KEY = "monocode.quickOpen.recentCommands";
const RECENT_COMMANDS_LIMIT = 8;

export function loadRecentCommands(): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(RECENT_COMMANDS_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberCommand(id: string): void {
  const next = [id, ...loadRecentCommands().filter((entry) => entry !== id)]
    .slice(0, RECENT_COMMANDS_LIMIT);
  try {
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
}

export type SessionRow = {
  id: string;
  cwd: string;
  harness: HarnessId;
  title: string;
  updatedAt: number;
};

const SESSION_LIMIT = 40;

/** Sessions by title; without a query, the current project's recent ones lead. */
export function rankSessions(
  rows: SessionRow[],
  query: string,
  currentProject: string | null,
): ConversationHit[] {
  if (query.trim()) {
    return searchConversationTitles(rows, query).slice(0, SESSION_LIMIT);
  }
  const inProject = (row: SessionRow) =>
    currentProject && sameProjectPath(row.cwd, currentProject) ? 0 : 1;
  return [...rows]
    .sort((a, b) => inProject(a) - inProject(b) || b.updatedAt - a.updatedAt)
    .slice(0, SESSION_LIMIT)
    .map((row) => ({
      id: `conversation:${row.id}`,
      kind: "conversation",
      sessionId: row.id,
      cwd: row.cwd,
      harness: row.harness,
      title: sessionDisplayTitle(row.title, row.harness),
      updatedAt: row.updatedAt,
      score: 0,
      positions: [],
    }));
}

/** Projects by name or path; without a query, the most recently opened. */
export function rankProjects(
  recents: RecentProject[],
  query: string,
): ProjectHit[] {
  if (query.trim()) return searchRecentProjects(recents, query);
  return [...recents]
    .sort((a, b) => b.openedAt - a.openedAt)
    .map((recent) => ({
      id: `project:${recent.path}`,
      kind: "project",
      path: recent.path,
      name: projectName(recent.path),
      score: 0,
      positions: [],
    }));
}
