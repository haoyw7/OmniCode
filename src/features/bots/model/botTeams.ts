import type { BotDelegationStatus, BotScope } from "./bots";

export type BotTeam = {
  id: string;
  name: string;
  memberBotIds: string[];
  chiefBotId?: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
};
export type BotTeamPatch = { name?: string; memberBotIds?: string[]; chiefBotId?: string | null };
export type BotTeams = { revision: number; teams: BotTeam[] };
export type BotCoordination = {
  id: string;
  teamId: string;
  source: BotScope & { runId: string };
  requestId: string;
  createdAt: number;
  deadlineAt: number;
  status: "running" | "completed";
  /** Ordered like the selected members. A completed group can include failed members. */
  results: Array<{ botId: string; delegationId: string; status: BotDelegationStatus; result?: string; resultTruncated?: boolean; error?: string }>;
};
