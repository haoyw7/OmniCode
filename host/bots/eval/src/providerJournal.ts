import {
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  constants,
} from "node:fs";
import { z } from "zod";
import { EvalError } from "./schema";
export const providerRequestIdPattern =
  /^(?:req_[A-Za-z0-9_-]{8,96}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})$/;
export const safeProviderRequestId = (value: string | null): string | null =>
  value && providerRequestIdPattern.test(value) ? value : null;
const failureKinds = [
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
  "UNKNOWN_PROVIDER_USAGE",
  "TIMEOUT",
  "OUTPUT_BYTE_LIMIT",
  "DIAGNOSTIC_WRITE_FAILED",
] as const;
export const diagnosticFailureKind = (value: string | null): string | null =>
  value === null
    ? null
    : failureKinds.includes(value as any)
      ? value
      : "PROVIDER_ERROR";
export type DiagnosticContext = {
  caseId?: string;
  phase?: "prompt" | "native" | "expansion";
  arm?: "control" | "monocode";
};
const recordSchema = z.object({
  schemaVersion: z.literal(1),
  recordedAt: z.string().datetime(),
  localRequestId: z.string().uuid(),
  providerRequestId: z.string().regex(providerRequestIdPattern).nullable(),
  event: z.enum(["request_started", "http_response", "request_terminal"]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  terminalState: z
    .enum(["completed", "cancelled", "failed", "unknown"])
    .nullable(),
  usageMissing: z.boolean().nullable(),
  failureKind: z.enum(failureKinds).nullable(),
  caseId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^\x00-\x1f\x7f]+$/)
    .optional(),
  phase: z.enum(["prompt", "native", "expansion"]).optional(),
  arm: z.enum(["control", "monocode"]).optional(),
});
/** Own a NEW campaign file outside temporary SDK sessions. Never opens a prior ledger for reuse. */
export class ProviderDiagnosticJournal {
  constructor(readonly path: string) {
    const fd = openSync(path, "wx", 0o600);
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  record(value: unknown) {
    let fd: number | undefined;
    try {
      const record = recordSchema.parse(value); // Unknown fields are removed, never persisted.
      fd = openSync(
        this.path,
        constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
      );
      writeFileSync(fd, JSON.stringify(record) + "\n");
      fsyncSync(fd);
    } catch {
      throw new EvalError("DIAGNOSTIC_WRITE_FAILED");
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
}
