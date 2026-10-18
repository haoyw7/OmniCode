import { z } from "zod";
export const CATEGORIES = [
  "intent",
  "planning",
  "retrieval",
  "files",
  "documents",
  "spreadsheets",
  "scheduling",
  "email",
  "memory",
  "recovery",
  "delegation",
  "reliability",
  "permissions",
  "security",
  "structured",
  "degradation",
] as const;
const record = z.record(z.string(), z.unknown());
const cell = z.union([z.string(), z.number(), z.null()]);
const FixtureSchema = z
  .object({
    files: z.record(z.string(), z.string()).optional(),
    documents: z
      .array(
        z
          .object({ id: z.string(), title: z.string(), text: z.string() })
          .strict(),
      )
      .optional(),
    sheets: z.record(z.string(), z.array(z.array(cell))).optional(),
    memory: z
      .array(
        z
          .object({
            fact: z.string(),
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            file: z
              .string()
              .regex(/^(?:memory|archive|topic:[A-Za-z0-9 ._-]+)$/)
              .optional(),
            topic: z.string().optional(),
            until: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    chat: z
      .array(z.object({ id: z.string(), text: z.string() }).strict())
      .optional(),
    sessions: z.array(record).optional(),
    projects: z.array(record).optional(),
    reminders: z.array(record).optional(),
    habits: z.array(record).optional(),
    playbooks: z.array(record).optional(),
    contacts: z.array(record).optional(),
    inbox: z.array(record).optional(),
    drafts: z.array(record).optional(),
    calendar: z.array(record).optional(),
    denied: z.array(z.string()).optional(),
    unavailable: z.array(z.string()).optional(),
    context: z.string().optional(),
    faults: z
      .array(
        z
          .object({
            action: z.string(),
            code: z.enum(["UNKNOWN_OUTCOME", "TRANSIENT", "RATE_LIMIT"]),
            remaining: z.number().int().positive().max(100),
            afterCommit: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export const CallSchema = z
  .object({
    action: z.string().min(1),
    requestId: z.string().min(1).max(128),
    input: record,
  })
  .strict();
export const DecisionSchema = z
  .object({
    calls: z.array(CallSchema).max(8).default([]),
    final: z.string().max(20000).optional(),
  })
  .strict()
  .refine(
    (v) => v.calls.length > 0 || v.final !== undefined,
    "Need calls or final",
  );
export const AssertionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("call"),
      action: z.string(),
      input: record.optional(),
      min: z.number().int().nonnegative().default(1),
      max: z.number().int().nonnegative().optional(),
      success: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("order"), actions: z.array(z.string()).min(2) })
    .strict(),
  z
    .object({ kind: z.literal("state"), path: z.string(), equals: z.unknown() })
    .strict(),
  z
    .object({
      kind: z.literal("state_pattern"),
      path: z.string(),
      regex: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("exact"), value: z.string() }).strict(),
  z
    .object({ kind: z.literal("contains"), values: z.array(z.string()).min(1) })
    .strict(),
  z
    .object({ kind: z.literal("excludes"), values: z.array(z.string()).min(1) })
    .strict(),
  z.object({ kind: z.literal("pattern"), regex: z.string() }).strict(),
  z.object({ kind: z.literal("json"), equals: z.unknown() }).strict(),
  z
    .object({
      kind: z.literal("citation"),
      source: z.string(),
      quote: z.string(),
      aliases: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("no_effects") }).strict(),
  z
    .object({
      kind: z.literal("max_calls"),
      value: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ kind: z.literal("forbidden"), actions: z.array(z.string()) })
    .strict(),
]);
export const CaseSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]+$/),
    category: z.enum(CATEGORIES),
    language: z.enum(["zh", "en", "mixed"]),
    support: z.enum(["native", "simulated-extension", "unsupported"]),
    tier: z.enum(["smoke", "standard", "stress"]),
    allowedEffects: z
      .array(
        z.object({ action: z.string(), input: record.optional() }).strict(),
      )
      .default([]),
    maxEffects: z.number().int().nonnegative().default(0),
    prompt: z.string().min(8),
    tools: z.array(z.string()),
    fixture: FixtureSchema,
    assertions: z.array(AssertionSchema).min(1),
    rubric: z
      .array(
        z.enum([
          "task_completion",
          "grounding",
          "clarification",
          "communication",
          "safety",
          "recovery",
        ]),
      )
      .min(1),
    events: z
      .array(
        z
          .object({
            afterStep: z.number().int().positive(),
            text: z.string(),
            patch: record.optional(),
          })
          .strict(),
      )
      .default([]),
    maxSteps: z.number().int().min(1).max(20).default(8),
    provenance: z
      .object({
        kind: z.enum(["original", "adapted", "verbatim"]),
        source: z.string(),
        upstreamId: z.string().optional(),
      })
      .strict(),
  })
  .strict();
export type Scenario = z.infer<typeof CaseSchema>;
export type Call = z.infer<typeof CallSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Trace = {
  index: number;
  call: Call;
  result: any;
  effect: boolean;
  recovery?: "retry" | "reconcile" | "correct-or-stop" | "stop";
  noProgress?: boolean;
  repeatedErrorCount?: number;
};
export type Usage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencyMs: number;
  models: string[];
};
export type Status =
  "passed" | "failed" | "environment_error" | "budget_exhausted" | "skipped";
export type Result = {
  providerDiagnostics?: ProviderDiagnostic[];
  id: string;
  category: string;
  language: string;
  support: string;
  status: Status;
  mode: string;
  error?: string;
  final: string;
  modelOutputs?: string[];
  agentUsage?: Usage;
  transportPolicy?: import("./transport").TransportPolicyVersion;
  transport?: "json-envelope" | "raw-terminal";
  repairAttempts?: number;
  scorerVersion?: string;
  environmentVersion?: import("./environment").EnvironmentVersion;
  transport_valid?: boolean;
  task_pass?: boolean;
  safety_pass?: boolean;
  safety?: import("./safety").SafetyObservation;
  trace: Trace[];
  state: any;
  checks: { assertion: unknown; passed: boolean; evidence: unknown }[];
  judge?: any;
  usage: Usage;
  seed: number;
  caseHash: string;
  eventsDelivered: number;
};
export class EvalError extends Error {
  constructor(
    public code: string,
    message = code,
  ) {
    super(message);
  }
}
const ProviderDiagnosticSchema = z.object({
  localRequestId: z.string().uuid().optional(),
  providerRequestId: z
    .string()
    .regex(
      /^(?:req_[A-Za-z0-9_-]{8,96}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})$/,
    )
    .nullable()
    .optional(),
  usageMissing: z.boolean().optional(),
  providerUsageObserved: z.boolean().optional(),
  terminalState: z
    .enum(["completed", "cancelled", "failed", "unknown"])
    .optional(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  stopReason: z
    .enum([
      "stop",
      "toolUse",
      "length",
      "error",
      "aborted",
      "pending",
      "unknown",
    ])
    .nullable(),
  failureKind: z
    .enum([
      "AUTH_UNAVAILABLE",
      "REQUEST_BUDGET",
      "CREDIT_UNAVAILABLE",
      "RATE_LIMIT",
      "MODEL_UNAVAILABLE",
      "NETWORK_ERROR",
      "CLI_UNAVAILABLE",
      "PROVIDER_ERROR",
      "PROVIDER_HTTP_ERROR",
      "PROVIDER_ABORTED",
      "MISSING_USAGE",
    ])
    .nullable(),
});
export type ProviderDiagnostic = z.infer<typeof ProviderDiagnosticSchema>;
/** Persist normalized enums/status only; never spread provider error objects. */
export function sanitizedProviderDiagnostics(
  error: unknown,
): ProviderDiagnostic[] | undefined {
  if (!error || typeof error !== "object") return undefined;
  const source = (error as { providerDiagnostics?: unknown })
    .providerDiagnostics;
  const values = Array.isArray(source)
    ? source
    : "diagnostics" in error
      ? [(error as { diagnostics: unknown }).diagnostics]
      : [];
  const safe = values.slice(0, 200).flatMap((value) => {
    const result = ProviderDiagnosticSchema.safeParse(value);
    return result.success ? [result.data] : [];
  });
  return safe.length ? safe : undefined;
}
