import { z } from "zod";
const empty = z.object({}).strict(),
  text = z.string().min(1),
  project = { projectId: text },
  session = { ...project, sessionId: text };
const spec = (shape: z.ZodRawShape) => z.object(shape).strict();
export const TOOL_SCHEMAS: Record<string, z.ZodType> = {
  "agents.list": empty,
  "models.list": spec({ projectId: text.optional() }),
  "projects.list": empty,
  "sessions.list": spec(project),
  "sessions.get": spec(session),
  "sessions.create": spec({
    ...project,
    harness: text,
    model: text,
    runtimeMode: text.optional(),
  }),
  "sessions.send": spec({
    ...session,
    text,
    playbooks: z.union([text, z.array(text)]).optional(),
  }),
  "sessions.steer": spec({ ...session, runId: text, text }),
  "sessions.cancel": spec({ ...session, runId: text }),
  "sessions.approve": spec({
    ...session,
    runId: text,
    requestId: text,
    decision: z.enum(["allow", "deny"]),
  }),
  "files.list": spec({ ...project, args: spec({ path: text }) }),
  "files.read": spec({ ...project, args: spec({ path: text }) }),
  "files.search": spec({ ...project, args: spec({ query: text }) }),
  "files.write": spec({
    ...project,
    args: spec({ path: text, content: z.string() }),
  }),
  "files.delete": spec({ ...project, args: spec({ path: text }) }),
  "memory.read": spec({ topic: text.optional() }),
  "memory.search": spec({
    query: text,
    since: text.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  "memory.add": spec({
    fact: text,
    until: text.optional(),
    topic: text.optional(),
  }),
  "memory.replace": spec({ find: text, fact: text, topic: text.optional() }),
  "memory.remove": spec({ find: text, topic: text.optional() }),
  "chat.search": spec({
    query: text,
    since: text.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  "reminders.list": empty,
  "reminders.create": spec({
    delayMinutes: z.number().min(1).max(10080),
    prompt: text,
  }),
  "reminders.cancel": spec({ reminderId: text }),
  "habits.list": empty,
  "habits.create": spec({
    name: text,
    prompt: text,
    schedule: spec({
      scheduleKind: z.enum(["hourly", "daily", "weekdays", "weekly"]),
      time: text.optional(),
      minute: z.number().optional(),
      dayOfWeek: z.number().int().min(0).max(6).optional(),
    }),
  }),
  "habits.update": spec({
    habitId: text,
    enabled: z.boolean().optional(),
    prompt: text.optional(),
  }),
  "habits.delete": spec({ habitId: text }),
  "playbooks.list": empty,
  "playbooks.read": spec({ name: text }),
  "playbooks.save": spec({
    name: text,
    description: text,
    body: text,
    verified: z.boolean().optional(),
  }),
  "actions.get": spec({ requestId: text }),
  "reply.attachments": spec({
    sources: z.array(
      spec({
        kind: z.literal("project-file"),
        projectId: text,
        relativePath: text,
      }),
    ),
    text: text.optional(),
  }),
  "fixture.search": spec({ query: text }),
  "fixture.read": spec({ id: text }),
  "fixture.sheet.read": spec({ sheet: text }),
  "fixture.sheet.write": spec({
    sheet: text,
    cells: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  }),
  "fixture.contacts.search": spec({ query: text }),
  "fixture.mail.search": spec({ query: text }),
  "fixture.mail.draft": spec({ to: text, subject: text, body: text }),
  "fixture.mail.send": spec({ draftId: text }),
  "fixture.calendar.list": spec({ date: text }),
  "fixture.calendar.create": spec({
    title: text,
    start: text,
    end: text,
    attendees: z.array(text),
  }),
  "fixture.calculate": spec({
    operation: z.enum(["sum", "average", "multiply"]),
    values: z.array(z.number()).min(1),
  }),
};
export type ToolSchemaOptions = { version?: "fixture-v1" | "native-parity-v2" };
const NATIVE_TOOL_SCHEMAS: Record<string, z.ZodType> = {
  ...TOOL_SCHEMAS,
  "memory.search": spec({
    query: text
      .max(500)
      .regex(/\S/)
      .regex(/^[^\0]*$/)
      .optional(),
    since: text
      .max(20)
      .regex(/\S/)
      .regex(/^[^\0]*$/)
      .optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
};
export function toolSchemas(
  options: ToolSchemaOptions = {},
): Record<string, z.ZodType> {
  return options.version === "native-parity-v2"
    ? NATIVE_TOOL_SCHEMAS
    : TOOL_SCHEMAS;
}
export function toolDefinitions(
  names: string[],
  options: ToolSchemaOptions = {},
) {
  const schemas = toolSchemas(options);
  return names.map((name) => {
    if (!schemas[name]) throw new Error(`Unknown tool ${name}`);
    return { name, parameters: z.toJSONSchema(schemas[name]) };
  });
}
export const MUTATIONS = new Set([
  "sessions.create",
  "sessions.send",
  "sessions.steer",
  "sessions.cancel",
  "sessions.approve",
  "files.write",
  "files.delete",
  "memory.add",
  "memory.replace",
  "memory.remove",
  "reminders.create",
  "reminders.cancel",
  "habits.create",
  "habits.update",
  "habits.delete",
  "playbooks.save",
  "reply.attachments",
  "fixture.sheet.write",
  "fixture.mail.draft",
  "fixture.mail.send",
  "fixture.calendar.create",
]);

/** Recovery guidance for tool outcomes; does not perform or authorize retries. */
export type ToolErrorRecovery =
  "retry" | "reconcile" | "correct-or-stop" | "stop";
export function toolErrorRecovery(code: string): ToolErrorRecovery {
  if (code === "TRANSIENT" || code === "RATE_LIMIT") return "retry";
  if (code === "UNKNOWN_OUTCOME") return "reconcile";
  if (
    [
      "NOT_FOUND",
      "PERMISSION_DENIED",
      "TOOL_UNAVAILABLE",
      "INVALID_ARGUMENT",
      "IDEMPOTENCY_CONFLICT",
      "PROJECT_SCOPE_DENIED",
    ].includes(code)
  )
    return "correct-or-stop";
  return "stop";
}
