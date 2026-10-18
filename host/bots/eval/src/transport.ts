import { DecisionSchema, EvalError, type Call } from "./schema";

export type TransportPolicyVersion =
  "envelope-strict-v1" | "terminal-compatible-v2";
export const DEFAULT_TRANSPORT_POLICY: TransportPolicyVersion =
  "terminal-compatible-v2";
export type ModelTurn =
  | { kind: "calls"; calls: Call[] }
  | {
      kind: "final";
      final: string;
      transport: "json-envelope" | "raw-terminal";
    };

// JSON.parse silently overwrites duplicate keys. Scan the already syntax-validated
// JSON tokens so duplicates (including escaped spellings) cannot hide actions.
function rejectDuplicateKeys(json: string) {
  const tokens = json.match(
    /"(?:\\.|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
  )!;
  let offset = 0;
  function value() {
    const token = tokens[offset++];
    if (token === "{") {
      const keys = new Set<string>();
      if (tokens[offset] !== "}") {
        do {
          const key = JSON.parse(tokens[offset++]);
          if (keys.has(key)) throw new EvalError("INVALID_MODEL_OUTPUT");
          keys.add(key);
          offset++; // colon
          value();
        } while (tokens[offset++] === ",");
      } else offset++;
    } else if (token === "[") {
      if (tokens[offset] !== "]") {
        do {
          value();
        } while (tokens[offset++] === ",");
      } else offset++;
    }
  }
  value();
}

export function parseModelTurn(
  text: string,
  policy: { version: TransportPolicyVersion },
): ModelTurn {
  if (
    !["envelope-strict-v1", "terminal-compatible-v2"].includes(policy.version)
  )
    throw new EvalError("INVALID_TRANSPORT_POLICY");
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(clean);
    rejectDuplicateKeys(clean);
  } catch (error) {
    // Malformed JSON-shaped output or decision syntax is never a raw terminal.
    if (
      error instanceof EvalError ||
      /^[{\[]/.test(clean) ||
      /"(?:calls|final)"\s*:/.test(clean)
    )
      throw new EvalError("INVALID_MODEL_OUTPUT");
  }
  const envelope =
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    ("calls" in raw || "final" in raw);
  if (envelope) {
    const parsed = DecisionSchema.safeParse(raw);
    if (!parsed.success) throw new EvalError("INVALID_MODEL_OUTPUT");
    const { calls, final } = parsed.data;
    if (calls.length) {
      if (final?.trim()) throw new EvalError("INVALID_MODEL_OUTPUT");
      return { kind: "calls", calls };
    }
    if (!final?.trim()) throw new EvalError("EMPTY_FINAL");
    return { kind: "final", final, transport: "json-envelope" };
  }
  if (policy.version !== "terminal-compatible-v2")
    throw new EvalError("INVALID_MODEL_OUTPUT");
  if (!text.trim()) throw new EvalError("EMPTY_FINAL");
  if (text.length > 20000) throw new EvalError("INVALID_MODEL_OUTPUT");
  return { kind: "final", final: text, transport: "raw-terminal" };
}
