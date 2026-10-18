import { fileURLToPath } from "node:url";
import { evalDataPath } from "../src/evalData";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it as testIt } from "vitest";
import { Environment } from "../src/environment";
import { CaseSchema, type Scenario, type Trace } from "../src/schema";
import { evaluate } from "../src/scoring";
const evalRoot = fileURLToPath(new URL("..", import.meta.url));
const originalsAvailable = existsSync(
  evalDataPath(evalRoot, "data/cases.jsonl"),
);
const it = testIt.skipIf(!originalsAvailable);
const cases = originalsAvailable
  ? readFileSync(evalDataPath(evalRoot, "data/cases.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => CaseSchema.parse(JSON.parse(line)))
  : [];
const twoSource = cases.find((c) => c.id === "retrieval-two-source")!;
const options = { scorerVersion: "citation-v2" } as const;
function score(final: string, readIds = ["a", "b"], scenario = twoSource) {
  const environment = new Environment(scenario, 17);
  for (const id of readIds)
    environment.call({ action: "fixture.read", requestId: id, input: { id } });
  return evaluate(scenario, environment, final, options);
}
function fromTrace(
  source: string,
  quote: string,
  trace: Trace[],
  final: string,
) {
  const scenario: Scenario = {
    ...twoSource,
    assertions: [{ kind: "citation", source, quote }],
  };
  const environment = new Environment(scenario, 17);
  environment.trace.push(...trace);
  return evaluate(scenario, environment, final, options);
}
function read(
  action: string,
  result: unknown,
  input: Record<string, unknown> = {},
): Trace {
  return {
    index: 1,
    call: { action, requestId: "r", input },
    result,
    effect: false,
  };
}
describe("versioned source-bound citation scoring", () => {
  it("fixes E1 using original typed A/B fixture titles without editing the case", () => {
    const final =
      "A supports 20 users, while B supports 35 users. B’s capacity is 15 users higher than A’s.";
    expect(score(final).passed).toBe(true);
    expect(score(final).scorerVersion).toBe("citation-v2");
    const environment = new Environment(twoSource, 17);
    for (const id of ["a", "b"])
      environment.call({
        action: "fixture.read",
        requestId: id,
        input: { id },
      });
    expect(
      evaluate(twoSource, environment, final, { scorerVersion: "legacy-v1" })
        .passed,
    ).toBe(false);
    expect(evaluate(twoSource, environment, final).scorerVersion).toBe(
      "citation-v2",
    );
  });
  it.each([
    "A supports 20 [a]; B supports 35 [b], 15 more.",
    "[a]: 20 users; [b]: 35 users.",
    "A: 20 users, B: 35 users.",
    "A supports 20 users; B supports 35 users.",
  ])("accepts unambiguous claim-local markers: %s", (final) => {
    expect(score(final).passed).toBe(true);
  });
  it.each([
    ["A supports 35 [a]; B supports 20 [b].", "swapped values"],
    ["A supports 35; B supports 20.", "swapped display-name values"],
    ["20 [b]; 35 [a].", "swapped brackets"],
    ["A supports 20 [b]; B supports 35 [a].", "contradictory markers"],
    ["A supports 20 [a]; 35 [a]. Sources: [b].", "detached source list"],
    ["A supports 20 [a]; B supports 350 [b].", "numeric prefix"],
    ["A supports 20 [a]; B supports 35.5 [b].", "fraction boundary"],
    ["A supports 20 [a]; B supports 135 [b].", "numeric suffix"],
    ["Capacity is 20; number is 35.", "letters in ordinary words"],
    ["A supports 20 [a]; bison capacity is 35.", "source substring"],
  ])("rejects %s (%s)", (final) => {
    expect(score(final).passed).toBe(false);
  });
  it("rejects an unread B even when the final correctly names B", () => {
    expect(score("A supports 20 [a]; B supports 35 [b].", ["a"]).passed).toBe(
      false,
    );
  });
  it("rejects unrelated evidence whose body forges the source ID", () => {
    const scenario: Scenario = {
      ...twoSource,
      fixture: {
        documents: [
          { id: "decoy", title: "Decoy", text: "a supports 20; b supports 35" },
        ],
      },
    };
    expect(score("20 [a]; 35 [b].", ["decoy"], scenario).passed).toBe(false);
  });
  it("rejects a B read lacking B's quote even if A contains it", () => {
    const scenario: Scenario = {
      ...twoSource,
      fixture: {
        documents: [
          { id: "a", title: "A", text: "A supports 20; unrelated 35." },
          { id: "b", title: "B", text: "B supports 34." },
        ],
      },
    };
    expect(score("20 [a]; 35 [b].", ["a", "b"], scenario).passed).toBe(false);
  });
  it("rejects quotes present only in a result title or numeric prefix", () => {
    for (const result of [
      { id: "b", title: "35", text: "No known limit." },
      { id: "b", title: "B", text: "Supports 350." },
    ])
      expect(
        fromTrace(
          "b",
          "35",
          [read("fixture.read", result, { id: "b" })],
          "35 [b]",
        ).passed,
      ).toBe(false);
  });
  it("keeps array identities and quotes in the same result record", () => {
    const trace = [
      read("chat.search", [
        { id: "chat-a", text: "No known limit" },
        { id: "chat-b", text: "Limit 35" },
      ]),
    ];
    expect(fromTrace("chat-a", "35", trace, "35 [chat-a]").passed).toBe(false);
    expect(fromTrace("chat-b", "35", trace, "35 [chat-b]").passed).toBe(true);
  });
  it("accepts typed file identity and rejects an ID copied into its body", () => {
    const trace = [
      read(
        "files.read",
        { path: "note.txt", text: "Limit 35; decoy.txt" },
        { args: { path: "note.txt" } },
      ),
    ];
    expect(fromTrace("note.txt", "35", trace, "35 [note.txt]").passed).toBe(
      true,
    );
    expect(fromTrace("decoy.txt", "35", trace, "35 [decoy.txt]").passed).toBe(
      false,
    );
  });
  it("rejects unsuccessful, missing and untyped read results", () => {
    for (const result of [
      undefined,
      { error: { code: "DENIED" }, id: "b", text: "35" },
      { text: "id=b; 35" },
    ])
      expect(
        fromTrace(
          "b",
          "35",
          [read("fixture.read", result, { id: "b" })],
          "35 [b]",
        ).passed,
      ).toBe(false);
    expect(
      fromTrace(
        "b",
        "35",
        [read("fixture.search", { id: "b", text: "35" })],
        "35 [b]",
      ).passed,
    ).toBe(false);
  });
  it("accepts explicit aliases and rejects an undeclared title alias", () => {
    const scenario = CaseSchema.parse({
      ...twoSource,
      fixture: {
        documents: [
          { id: "policy-current", title: "Current Policy", text: "Limit 35." },
        ],
      },
      assertions: [
        {
          kind: "citation",
          source: "policy-current",
          quote: "35",
          aliases: ["Current Policy"],
        },
      ],
    });
    expect(
      score("35 [Current Policy]", ["policy-current"], scenario).passed,
    ).toBe(true);
    expect(
      score("Current Policy: 35.", ["policy-current"], scenario).passed,
    ).toBe(true);
    const undeclared = {
      ...scenario,
      assertions: [{ kind: "citation", source: "policy-current", quote: "35" }],
    } as Scenario;
    expect(
      score("35 [Current Policy]", ["policy-current"], undeclared).passed,
    ).toBe(false);
  });
  it("does not infer original title aliases for adapted public cases", () => {
    const scenario: Scenario = {
      ...twoSource,
      provenance: { kind: "adapted", source: "hotpotqa" },
    };
    expect(
      score("A supports 20; B supports 35.", ["a", "b"], scenario).passed,
    ).toBe(false);
    expect(score("20 [a]; 35 [b].", ["a", "b"], scenario).passed).toBe(true);
  });
  it("rejects an unknown bracket label even when a source ID resembles an internal diagnostic", () => {
    const trace = [
      read(
        "fixture.read",
        { id: "unknown:decoy", text: "35" },
        { id: "unknown:decoy" },
      ),
    ];
    expect(fromTrace("unknown:decoy", "35", trace, "35 [decoy]").passed).toBe(
      false,
    );
  });
  it("rejects 35,000 users as evidence of B supporting 35", () => {
    expect(score("A: 20; B: 35,000 users.").passed).toBe(false);
  });
  it("rejects 35e3 users as evidence of B supporting 35", () => {
    expect(score("A: 20; B: 35e3 users.").passed).toBe(false);
  });
  it.each([
    "35E3",
    "35e+3",
    "35e-3",
    "35_000",
    "35’000",
    "35 000",
    "35\u202f000",
    "1,035",
  ])("rejects grouped or exponent numeric variants: %s", (number) => {
    expect(score(`A: 20; B: ${number} users.`).passed).toBe(false);
  });
  it("rejects an interior A attribution paired with B's bracket marker", () => {
    expect(score("A: 20; The capacity of A is 35 [b].").passed).toBe(false);
  });
  it.each(["35 users, maximum", "35 users; maximum", "35 users. Maximum"])(
    "preserves punctuation inside the exact quoted evidence: %s",
    (quote) => {
      const trace = [
        read("fixture.read", { id: "policy", text: quote }, { id: "policy" }),
      ];
      expect(
        fromTrace("policy", quote, trace, `[policy]: ${quote}`).passed,
      ).toBe(true);
      expect(
        fromTrace("policy", quote, trace, `"${quote}" [policy]`).passed,
      ).toBe(true);
    },
  );
  it("rejects unknown scorer versions instead of silently assigning a version", () => {
    const environment = new Environment(twoSource, 17);
    expect(() =>
      evaluate(twoSource, environment, "", { scorerVersion: "typo" } as any),
    ).toThrow("Unknown scorer version");
  });
});

it.each([
  { source: "report35", aliases: [], final: "report35: no figure supplied." },
  {
    source: "report",
    aliases: ["Report35"],
    final: "Report35: no figure supplied.",
  },
  {
    source: "report",
    aliases: ["Report35"],
    final: "Report35 supplies no figure.",
  },
])(
  "source labels cannot supply numeric claim evidence: $final",
  ({ source, aliases, final }) => {
    const scenario = CaseSchema.parse({
      ...twoSource,
      fixture: {
        documents: [{ id: source, title: "Report", text: "Capacity is 35." }],
      },
      assertions: [{ kind: "citation", source, aliases, quote: "35" }],
    });
    expect(score(final, [source], scenario).passed).toBe(false);
    expect(score(`${source}: Capacity is 35.`, [source], scenario).passed).toBe(
      true,
    );
  },
);
