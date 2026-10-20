import { REMOTE_PROVIDERS, type HostModelCatalog, type HostProject, type HostSession } from "../features/connections/model/protocol";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function blocks(value: unknown): boolean {
  return Array.isArray(value) && value.every(block => record(block) &&
    typeof block.id === "string" && typeof block.text === "string" &&
    ["user", "assistant", "image", "reasoning", "tool", "approval", "tasks", "plan", "system", "handoff"].includes(String(block.role)) &&
    (block.attachments === undefined || (Array.isArray(block.attachments) && block.attachments.every(file =>
      record(file) && typeof file.id === "string" && typeof file.name === "string"))) &&
    (block.agentRun === undefined || (record(block.agentRun) &&
      (block.agentRun.transcript === undefined || blocks(block.agentRun.transcript)))));
}
export function isOfflineSession(value: unknown, id: string): value is HostSession {
  if (!record(value) || !record(value.session)) return false;
  const session = value.session;
  return session.id === id && typeof value.projectId === "string" &&
    Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 &&
    typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) &&
    ["idle", "running", "interrupted"].includes(String(value.status)) &&
    typeof session.title === "string" && typeof session.cwd === "string" &&
    REMOTE_PROVIDERS.some(provider => provider === session.harness) &&
    typeof session.model === "string" && record(session.modelSettings) &&
    blocks(session.blocks);
}
export function isOfflineModels(value: unknown): value is HostModelCatalog {
  return record(value) && record(value.models) && record(value.errors) &&
    Object.values(value.models).every(rows => Array.isArray(rows) && rows.every(row =>
      record(row) && typeof row.id === "string" && typeof row.name === "string" &&
      REMOTE_PROVIDERS.some(provider => provider === row.harness))) &&
    Object.values(value.errors).every(error => typeof error === "string");
}
export function isOfflineProjects(value: unknown): value is HostProject[] {
  return Array.isArray(value) && value.every(project => record(project) &&
    ["id", "name", "cwd"].every(key => typeof project[key] === "string"));
}
