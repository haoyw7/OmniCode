import { randomUUID } from "node:crypto";
import type { BotThreadRuntime } from "./thread";
import { signature } from "./thread/store";
import { fields, id, object } from "./thread/policy";
import type { BotManager } from "./manager";
import type { BotDelegation } from "../../src/features/bots/model/bots";
import type { BotCoordination, BotTeam, BotTeams } from "../../src/features/bots/model/botTeams";

type CoordinationPlan = { id: string; teamId: string; source: BotCoordination["source"]; requestId: string;
  botIds: string[]; prompt: string; timeoutMs: number; createdAt: number; deadlineAt: number };

export class TeamService {
  constructor(readonly manager: BotManager) {
    manager.engine.store.db.exec(`
      CREATE TABLE IF NOT EXISTS bot_teams (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bot_coordinations (id TEXT PRIMARY KEY, source_run_id TEXT NOT NULL,
        request_id TEXT NOT NULL, signature TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(source_run_id,request_id));
      INSERT OR IGNORE INTO bot_metadata(key,value) VALUES ('teamsRevision','0');
    `);
  }
  get(teamId: string): BotTeam | undefined {
    const row = this.manager.engine.store.db.prepare("SELECT payload FROM bot_teams WHERE id=?").get(teamId);
    return row && JSON.parse(String(row.payload));
  }
  private list(includeArchived = false): BotTeam[] {
    return this.manager.engine.store.db.prepare("SELECT payload FROM bot_teams ORDER BY json_extract(payload,'$.createdAt'),id").all()
      .map(row => JSON.parse(String(row.payload)) as BotTeam).filter(team => includeArchived || team.archivedAt === undefined);
  }
  forBot(botId: string): BotTeam[] { return this.list().filter(team => team.memberBotIds.includes(botId)).slice(0, 50); }
  authorizeDelegation(value: BotDelegation): boolean {
    const team = value.teamId && this.get(value.teamId);
    return !!team && team.archivedAt === undefined && team.chiefBotId === value.source.botId &&
      team.memberBotIds.includes(value.source.botId) && team.memberBotIds.includes(value.target.botId);
  }
  private patch(raw: unknown, old?: BotTeam): Pick<BotTeam, "name" | "memberBotIds" | "chiefBotId"> {
    const patch = object(raw); fields(patch, ["name", "memberBotIds", "chiefBotId"]);
    const name = patch.name === undefined ? old?.name : id(patch.name, "team name", 100).trim();
    const memberBotIds = patch.memberBotIds === undefined ? old?.memberBotIds : patch.memberBotIds;
    if (!name || !Array.isArray(memberBotIds) || memberBotIds.length > 50 || new Set(memberBotIds).size !== memberBotIds.length ||
        memberBotIds.some(botId => typeof botId !== "string" || !this.manager.store.getBot(botId)))
      throw new Error("Team members must be unique existing Bots on this Host (maximum 50)");
    const chiefBotId = "chiefBotId" in patch ? patch.chiefBotId ?? undefined : old?.chiefBotId;
    if (chiefBotId !== undefined && (typeof chiefBotId !== "string" || !memberBotIds.includes(chiefBotId)))
      throw new Error("The Chief must be a member of this team");
    return { name, memberBotIds: [...memberBotIds] as string[], chiefBotId: chiefBotId as string | undefined };
  }
  async rpc(method: string, raw: Record<string, unknown>): Promise<BotTeam | BotTeams> {
    if (method === "botTeams.list") {
      fields(raw, ["includeArchived"]);
      if (raw.includeArchived !== undefined && typeof raw.includeArchived !== "boolean") throw new Error("Invalid archive filter");
      const row = this.manager.engine.store.db.prepare("SELECT value FROM bot_metadata WHERE key='teamsRevision'").get()!;
      return { revision: Number(row.value), teams: this.list(raw.includeArchived === true) };
    }
    if (method === "botTeams.get") {
      fields(raw, ["teamId"]);
      const team = this.get(id(raw.teamId, "team"));
      if (!team) throw new Error("Team not found");
      return team;
    }
    const create = method === "botTeams.create", configure = method === "botTeams.configure";
    if (!create && !configure && method !== "botTeams.archive" && method !== "botTeams.restore") throw new Error("Unsupported team operation");
    fields(raw, create ? ["commandId", "patch"] : configure ? ["teamId", "commandId", "expectedRevision", "patch"] : ["teamId", "commandId", "expectedRevision"]);
    const commandId = id(raw.commandId), teamId = create ? undefined : id(raw.teamId, "team"), sig = signature({ method, raw });
    const key = `teams:${teamId ?? "create"}`, previous = this.manager.store.commandReceipt(key, commandId, sig);
    if (previous !== undefined) return previous as BotTeam;
    const result = this.manager.engine.store.transaction(() => {
      const old = teamId ? this.get(teamId) : undefined;
      if (!create && !old) throw new Error("Team not found");
      if (!create && (!Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision !== old!.revision))
        throw new Error("Settings changed elsewhere. Reload before saving.");
      if (configure && old?.archivedAt !== undefined) throw new Error("Restore the archived team before changing it");
      const now = Date.now(), value: BotTeam = old ? { ...old, revision: old.revision + 1, updatedAt: now }
        : { id: randomUUID(), name: "", memberBotIds: [], revision: 1, createdAt: now, updatedAt: now };
      if (create || configure) Object.assign(value, this.patch(raw.patch, old));
      else value.archivedAt = method === "botTeams.archive" ? now : undefined;
      this.manager.engine.store.db.prepare("INSERT INTO bot_teams VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(value.id, JSON.stringify(value));
      this.manager.engine.store.db.prepare("UPDATE bot_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='teamsRevision'").run();
      this.manager.store.recordCommandReceipt(key, commandId, sig, value);
      return value;
    });
    this.manager.delegations.reconcile();
    return result;
  }
  private chief(runtime: BotThreadRuntime, teamId: string, botIds: string[]): void {
    const run = runtime.currentRun, team = this.get(teamId);
    if (this.manager.assistant(runtime.store.scope) !== runtime || !run || !["running", "waiting_approval"].includes(run.status) ||
        this.manager.store.getThread(run.botId, run.threadId)?.kind === "delegation")
      throw new Error("Chief delegation requires an active non-delegated Host run");
    if (!team || team.archivedAt !== undefined || team.chiefBotId !== run.botId || !team.memberBotIds.includes(run.botId))
      throw new Error("Only the current Chief may coordinate this team");
    if (botIds.some(botId => botId === run.botId || !team.memberBotIds.includes(botId)))
      throw new Error("Choose team members other than the Chief");
  }
  async delegate(runtime: BotThreadRuntime, requestId: string, raw: Record<string, unknown>): Promise<BotDelegation> {
    fields(raw, ["teamId", "botId", "prompt", "timeoutMs"]);
    const teamId = id(raw.teamId, "team"), botId = id(raw.botId, "Bot"); this.chief(runtime, teamId, [botId]);
    const { teamId: _team, ...input } = raw;
    return this.manager.delegations.submit(runtime, requestId, input, { teamId, mode: "background" });
  }
  async coordinate(runtime: BotThreadRuntime, requestId: string, raw: Record<string, unknown>): Promise<BotCoordination> {
    fields(raw, ["teamId", "botIds", "prompt", "timeoutMs"]);
    const teamId = id(raw.teamId, "team"), botIds = raw.botIds, prompt = id(raw.prompt, "delegation prompt", 100_000);
    if (!Array.isArray(botIds) || !botIds.length || botIds.length > 10 || new Set(botIds).size !== botIds.length || botIds.some(botId => typeof botId !== "string"))
      throw new Error("Choose between 1 and 10 unique team members");
    const timeoutMs = raw.timeoutMs ?? 240_000;
    if (!Number.isSafeInteger(timeoutMs) || Number(timeoutMs) < 1 || Number(timeoutMs) > 240_000) throw new Error("Bot delegation timeout must be between 1 and 240000 milliseconds");
    this.chief(runtime, teamId, botIds); id(requestId, "request ID", 200);
    const source = { ...runtime.store.scope, runId: runtime.currentRun!.id }, sig = signature({ teamId, botIds, prompt, timeoutMs });
    const previous = this.manager.engine.store.db.prepare("SELECT signature,payload FROM bot_coordinations WHERE source_run_id=? AND request_id=?").get(source.runId, requestId);
    let plan: CoordinationPlan;
    if (previous) {
      if (previous.signature !== sig) throw new Error("Coordination request ID was already used with different input");
      plan = JSON.parse(String(previous.payload));
    } else {
      const now = Date.now();
      plan = { id: randomUUID(), teamId, source, requestId, botIds, prompt, timeoutMs: Number(timeoutMs), createdAt: now, deadlineAt: now + Number(timeoutMs) };
      this.manager.engine.store.db.prepare("INSERT INTO bot_coordinations VALUES (?,?,?,?,?)").run(plan.id, source.runId, requestId, sig, JSON.stringify(plan));
    }
    const delegated = await Promise.all(plan.botIds.map(botId => this.manager.delegations.submit(runtime,
      `coordinate:${plan.id}:${botId}`, { botId, prompt: plan.prompt, timeoutMs: plan.timeoutMs }, { teamId: plan.teamId, mode: "attached", deadlineAt: plan.deadlineAt })));
    await Promise.all(delegated.filter(value => value.status === "running").map(value => this.manager.delegations.wait(runtime, value.id)));
    let budget = 60_000;
    const results = delegated.map(value => {
      const latest = this.manager.delegations.get(value.id)!;
      const points = Array.from(latest.result ?? ""), result = points.slice(0, budget).join(""); budget -= Array.from(result).length;
      return { botId: latest.target.botId, delegationId: latest.id, status: latest.status,
        ...(latest.result !== undefined ? { result } : {}), ...(latest.resultTruncated || points.length > Array.from(result).length ? { resultTruncated: true } : {}),
        ...(latest.error ? { error: latest.error } : {}) };
    });
    return { id: plan.id, teamId: plan.teamId, source, requestId, createdAt: plan.createdAt, deadlineAt: plan.deadlineAt,
      status: results.some(value => value.status === "running") ? "running" : "completed", results };
  }
}
