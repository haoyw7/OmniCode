import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "../../../../tests/helpers/sessionPresentationRoot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../../../contracts/session";
import { AgentTranscript } from "./AgentTranscript";
import { setUiLanguage } from "../../../shared/i18n/language";

// Duration labels are localized; keep the host locale out of the assertions.
beforeEach(() => setUiLanguage("en"));

const appearance = vi.hoisted(() => ({
  layout: "chat" as "chat" | "full",
}));
vi.mock("../hooks/useTranscriptLayout", () => ({
  useTranscriptLayout: () => appearance.layout,
}));

function tool(id: string, approval?: Block["approval"]): Block {
  return {
    id,
    role: "tool",
    text: `Inspect hidden-detail-${id}`,
    tool: { kind: "shell", status: approval ? "pending" : "completed" },
    ...(approval ? { approval } : {}),
  };
}

function render(
  blocks: Block[],
  busy = false,
  latestTurnAccessory?: ReactNode,
) {
  return renderToStaticMarkup(
    createElement(AgentTranscript, { blocks, busy, turnAccessory: (_, latest) => latest ? latestTurnAccessory : null }),
  );
}

describe("AgentTranscript collapsed work", () => {
  it("keeps the completed time beside actions when a turn has no BTW control", () => {
    const markup = render([
      {
        id: "user",
        role: "user",
        text: "Inspect",
        startedAt: 1_000,
        durationMs: 2_000,
      },
      { id: "answer", role: "assistant", text: "Done" },
    ]);
    expect(markup).toContain('aria-label="Worked for 2s"');
    expect(markup).toContain(">2s</span>");
    expect(markup).not.toContain(">Worked for 2s</span>");
    expect(markup).toContain(`dateTime="${new Date(3_000).toISOString()}"`);
    expect(markup).toContain("flex shrink-0 items-center gap-2.5");
    expect(markup).not.toContain("ml-auto flex shrink-0 items-center gap-2.5");
  });

  it("shows the completed run time after a follow-up without changing its send time", () => {
    const markup = render([
      { id: "user", role: "user", text: "Inspect", startedAt: 1_000 },
      { id: "progress", role: "assistant", text: "Checking" },
      { id: "follow-up", role: "user", text: "Also test", sentAt: 5_000, durationMs: 8_000 },
      { id: "answer", role: "assistant", text: "Done" },
    ]);
    expect(markup).toContain(">8s</span>");
    expect(markup).toContain(`dateTime="${new Date(5_000).toISOString()}"`);
    expect(markup).toContain(`dateTime="${new Date(9_000).toISOString()}"`);
    expect(markup).not.toContain(`dateTime="${new Date(13_000).toISOString()}"`);
  });

  it("keeps the live clock on the fold line when no project footer can render", () => {
    vi.spyOn(Date, "now").mockReturnValue(26_000);
    try {
      const markup = render([
        { id: "user", role: "user", text: "Inspect", startedAt: 1_000 },
        { id: "answer", role: "assistant", text: "Working", streaming: true },
      ], true);
      expect(markup).toContain("Working for 25s");
      expect(markup).not.toContain("data-live-footer");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("shows a /operator request without the command in its amber bubble", () => {
    const markup = render([
      { id: "user", role: "user", text: "list my notes", omnicode: true },
    ]);
    expect(markup).toContain('data-omnicode="true"');
    expect(markup).toContain("list my notes");
    expect(markup).not.toContain("/operator");

    const legacy = render([
      { id: "old", role: "user", text: "/omnicode list my notes" },
    ]);
    expect(legacy).toContain('data-omnicode="true"');
    expect(legacy).not.toContain("/omnicode");
  });

  it("shows OmniCode CLI actions instead of their long shell commands", () => {
    const command =
      "/repo/target/debug/OmniCode.app/Contents/MacOS/omnicode";
    const markup = render(
      [
        { id: "user", role: "user", text: "/omnicode list my notes" },
        {
          id: "help",
          role: "tool",
          text: `${command} app --help`,
          tool: { kind: "shell", status: "completed" },
        },
        {
          id: "notes",
          role: "tool",
          text: `${command} app notes.list --json '{}'`,
          tool: { kind: "shell", status: "in_progress" },
        },
      ],
      true,
    );
    expect(markup).toContain("Using OmniCode");
    expect(markup).toContain('data-omnicode-tool-call="--help"');
    expect(markup).toContain('data-omnicode-tool-call="notes.list"');
    expect(markup).toContain("omnicode app --help");
    expect(markup).toContain("omnicode app notes.list");
    expect(markup).toContain("Ran");
    expect(markup).toContain("Running");
    expect(markup).not.toContain("Contents/MacOS/omnicode");
    expect(markup).not.toContain("Show error details for OmniCode");
  });

  it("shows the full command before approving a OmniCode CLI call", () => {
    const command = "omnicode app sessions.send --json '{\"prompt\":\"private-marker\"}'";
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks: [
          { id: "user", role: "user", text: "Send a follow-up" },
          {
            id: "call",
            role: "tool",
            text: command,
            tool: { kind: "shell", status: "pending" },
            approval: { requestId: 1 },
          },
        ],
        busy: true,
        onApproval: () => {},
      }),
    );
    expect(markup).toContain('data-omnicode-tool-call="sessions.send"');
    expect(markup).toContain("private-marker");
    expect(markup).toContain('data-approval="allow"');
    expect(markup).toContain('data-variant="primary"');
    expect(markup).toContain("Allow</button>");

    const compound = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks: [
          { id: "user", role: "user", text: "List notes" },
          {
            id: "call",
            role: "tool",
            text: "omnicode app notes.list && echo extra",
            tool: { kind: "shell", status: "pending" },
            approval: { requestId: 2 },
          },
        ],
        busy: true,
        onApproval: () => {},
      }),
    );
    expect(compound).not.toContain("data-omnicode-tool-call");
    expect(compound).toContain("echo extra");
    expect(compound).toContain("Allow</button>");
  });

  it("keeps a failed OmniCode call compact until its error is opened", () => {
    const markup = render([
      { id: "user", role: "user", text: "/omnicode list notes" },
      {
        id: "notes",
        role: "tool",
        text: "omnicode app notes.list",
        tool: { kind: "shell", status: "failed", detail: "Connection refused" },
      },
    ]);
    expect(markup).toContain('data-omnicode-tool-call="notes.list"');
    expect(markup).toContain("Ran");
    expect(markup).toContain("omnicode app notes.list");
    expect(markup).toContain("Show error details for OmniCode: List notes");
    expect(markup).not.toContain("Connection refused");
  });

  it("offers the saved CI context in a collapsed disclosure beside the short request", () => {
    const markup = render([
      {
        id: "ci-repair",
        role: "user",
        text: "Fix 1 failed CI check for acme/web PR #42.",
        ciContext:
          "Checked commit: abc123\n\nRun tests: expected <main>, received <script>",
      },
    ]);
    expect(markup).toContain("Fix 1 failed CI check for acme/web PR #42.");
    expect(markup).toMatch(/<details\b[^>]*>/);
    expect(markup).not.toMatch(/<details\b[^>]*\bopen[\s=>]/);
    expect(markup).toContain("CI context</span>");
    expect(markup).toContain(
      "Checked commit: abc123\n\nRun tests: expected &lt;main&gt;, received &lt;script&gt;",
    );
  });

  it("hides provider authentication errors handled by the sign-in modal", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        harness: "grok",
        blocks: [
          {
            id: "auth-error",
            role: "system",
            notice: "error",
            text: "Authentication required\n\nGrok Build is not signed in.",
          },
        ],
      }),
    );

    expect(markup).not.toContain("Authentication required");
    expect(markup).not.toContain("Sign in to Grok Build");
    expect(markup).not.toContain("<button");
  });

  it("reveals an orchestration result after the finished turn and before its action row", () => {
    const card: Block = {
      id: "proposal",
      role: "plan",
      text: "Assignment plan",
      orchestration: {
        version: 1,
        leadId: "lead",
        cwd: "/repo",
        request: "Build",
        author: { harness: "claude", model: "claude:test", name: "Lead" },
        settings: {
          choices: [
            { harness: "claude", model: "claude:test", name: "Worker" },
          ],
          maxWorkers: 2,
        },
        status: "ready",
        title: "Proposed assignments",
        summary: "Implement and verify",
        tasks: [],
      },
    };
    const blocks: Block[] = [
      {
        id: "user",
        role: "user",
        text: "Build",
        startedAt: 1000,
        durationMs: 500,
      },
      card, // Existing records have the card before the work.
      tool("inspection"),
      {
        id: "answer",
        role: "assistant",
        text: "The investigation is complete.",
      },
    ];
    expect(render(blocks, true)).not.toContain("data-orchestration-review");
    const finished = render(blocks);
    expect(finished.indexOf("The investigation is complete.")).toBeLessThan(
      finished.indexOf("data-orchestration-result"),
    );
    expect(finished.indexOf("data-orchestration-review")).toBeLessThan(
      finished.indexOf('aria-label="Worked for 1s"'),
    );
    expect(finished.match(/data-orchestration-review/g)).toHaveLength(1);
    card.orchestration!.status = "planning";
    expect(render(blocks)).not.toContain("data-orchestration-review");
  });
  it("renders a standalone user URL as a compact link preview", () => {
    const markup = render([
      { id: "user", role: "user", text: "https://www.example.com/docs" },
    ]);

    expect(markup).toContain("data-user-link-preview");
    expect(markup).toContain("example.com/docs");
    expect(markup).toContain("Open example.com");
    expect(markup).toContain("user-link-preview-title");
    expect(markup).toContain("user-message-with-link");
    expect(markup).toContain("user-message-bubble");
    expect(markup).not.toContain("text-ellipsis");
  });

  it("renders an unsent turn with send and remove controls", () => {
    const markup = render([
      { id: "draft", role: "user", text: "Explore this", draft: true },
    ]);

    expect(markup).toContain('data-draft="true"');
    expect(markup).toContain("border-dashed");
    expect(markup).toContain('aria-label="Send draft"');
    expect(markup).toContain('data-variant="primary"');
    expect(markup).toContain('aria-label="Remove draft"');
    expect(markup).toContain(">Draft</span>");
  });

  it("keeps surrounding prose and previews its first URL", () => {
    const markup = render([
      {
        id: "user",
        role: "user",
        text: "Please check https://example.com/docs",
      },
    ]);

    expect(markup).toContain("data-user-link-preview");
    expect(markup).toContain("Please check");
    expect(markup).toContain("Open example.com");
    expect(markup).not.toContain("Please check https://example.com/docs");
  });

  it("renders GitHub pull requests as compact work item chips", () => {
    const markup = render([
      {
        id: "user",
        role: "user",
        text: "Review https://github.com/acme/widgets/pull/73 please",
      },
    ]);

    expect(markup).toContain('data-github-work-item-chip="pr"');
    expect(markup).toContain('data-compact="true"');
    expect(markup).toContain("#73");
    expect(markup).not.toContain(">acme/widgets</span>");
    expect(markup).toContain("Review");
    expect(markup).toContain("please");
    expect(markup).not.toContain("user-link-preview-title");
  });

  it("keeps each completed turn's recorded model label", () => {
    const blocks: Block[] = [
      {
        id: "user",
        role: "user",
        text: "Remember this",
        durationMs: 9_000,
        turnModel: {
          harness: "claude",
          id: "claude:sonnet-5",
          name: "Claude Sonnet 5",
        },
      },
      { id: "answer", role: "assistant", text: "Remembered." },
    ];
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks,
        harness: "claude",
        model: "claude:opus-5",
      }),
    );

    expect(markup).toContain("Claude Sonnet 5 worked for 9s");
    expect(markup).toContain(">Claude Sonnet 5</span>");
    expect(markup).toContain(">9s</span>");
    expect(markup).not.toContain(">Claude Sonnet 5 worked for 9s</span>");
    expect(markup).not.toContain("Claude Opus 5 worked for 9s");
  });

  it("does not assign the current model to a legacy completed turn", () => {
    const blocks: Block[] = [
      {
        id: "user",
        role: "user",
        text: "Old prompt",
        durationMs: 9_000,
      },
      { id: "answer", role: "assistant", text: "Old answer." },
    ];
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks,
        harness: "claude",
        model: "claude:opus-5",
      }),
    );

    expect(markup).toContain("Worked for 9s");
    expect(markup).not.toContain("Claude Opus 5 worked for 9s");
  });
  it("marks the edited message with a quiet visual state instead of a text banner", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks: [{ id: "user", role: "user", text: "Edit this prompt" }],
        onEditLastTurn: () => {},
        editingLastTurn: true,
      }),
    );

    expect(markup).toContain('data-editing-last-turn="true"');
    expect(markup).toContain("edit-last-turn-bubble");
    expect(markup).toContain('aria-label="Cancel edit"');
    expect(markup).not.toContain("Editing this message");
  });

  it("renders the summary and answer without mounting a large completed tool trail", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Check the project" },
      ...Array.from({ length: 1357 }, (_, index) => tool(String(index))),
      { id: "answer", role: "assistant", text: "The project checks passed." },
    ];
    const markup = render(blocks);
    expect(markup).toContain("The project checks passed.");
    expect(markup).toContain("Show the work");
    expect(markup.includes("hidden-detail-")).toBe(false);
    const short = render([blocks[0], tool("one"), tool("two"), blocks.at(-1)!]);
    const tagCount = (html: string) => html.match(/<[a-z]/g)?.length ?? 0;
    expect(tagCount(markup)).toBe(tagCount(short));
  });

  it("keeps live work visible before the assistant answers", () => {
    expect(render([tool("live")], true)).toContain("hidden-detail-live");
  });

  it("keeps an unresolved approval visible even when narration follows it", () => {
    const markup = render(
      [
        tool("approval", { requestId: 1 }),
        {
          id: "answer",
          role: "assistant",
          text: "Please approve the command.",
        },
      ],
      true,
    );
    expect(markup).toContain("hidden-detail-approval");
    expect(markup).toContain("Please approve the command.");
    expect(markup.includes('aria-label="Show the work"')).toBe(false);
  });

  it("opens a failed subagent's own row on its provider reason", () => {
    const markup = render(
      [
        { id: "user", role: "user", text: "Delegate this", startedAt: 1_000 },
        {
          id: "agent",
          role: "tool",
          text: "Inspect auth",
          tool: {
            callId: "agent-1",
            kind: "agent",
            status: "failed",
            detail: "Child process disconnected",
          },
        },
        { id: "answer", role: "assistant", text: "I could not finish." },
      ],
      // Live keeps the run pinned on its own row; settled keeps it there too —
      // a run that died parks under the fold line, already open on the reason.
      true,
    );

    expect(markup).toContain("Inspect auth");
    expect(markup).toContain("failed");
    expect(markup).toContain("Child process disconnected");
    expect(markup).toContain("Hide Inspect auth&#x27;s work");

    const settledMarkup = render([
      { id: "user", role: "user", text: "Delegate this", startedAt: 1_000 },
      {
        id: "agent",
        role: "tool",
        text: "Inspect auth",
        tool: {
          callId: "agent-1",
          kind: "agent",
          status: "failed",
          detail: "Child process disconnected",
        },
      },
      { id: "answer", role: "assistant", text: "I could not finish." },
    ]);
    expect(settledMarkup).toContain("Child process disconnected");
    expect(settledMarkup).toContain("Hide Inspect auth&#x27;s work");
  });

  it("gives each running subagent its own row above the work that folds", () => {
    const markup = render(
      [
        { id: "user", role: "user", text: "Review this", startedAt: 1_000 },
        { id: "lead", role: "assistant", text: "I will run two reviews." },
        {
          id: "a1",
          role: "tool",
          text: "Correctness review",
          tool: { callId: "agent-1", kind: "agent", status: "in_progress" },
          agentRun: {
            name: "Correctness review",
            model: "claude-haiku-4-5",
            steps: [
              {
                id: "s1",
                kind: "tool",
                text: "Read src/App.tsx",
                status: "completed",
              },
            ],
          },
        },
        {
          id: "a2",
          role: "tool",
          text: "Quality review",
          tool: { callId: "agent-2", kind: "agent", status: "in_progress" },
          agentRun: {
            name: "Quality review",
            model: "custom-review-model",
            steps: [],
          },
        },
        tool("t1"),
        { id: "answer", role: "assistant", text: "Both reviewers agree." },
      ],
      true,
    );

    // A row each, named, hopping while the run is live — no grouped header.
    expect(markup).toContain("Correctness review");
    expect(markup).toContain("Quality review");
    expect(markup).toContain("Haiku 4.5");
    expect(markup).toContain("custom-review-model");
    expect(markup).toContain('data-animated="true"');
    expect(markup).not.toContain("are working");
    // A row counts its agent's work; it does not echo the call in flight,
    // which put a second scrolling command line on every row.
    expect(markup).toContain("1 step");
    expect(markup).not.toContain("Read src/App.tsx");
    expect(markup).not.toContain("starting up");
    // The name carries the shimmer while the run is live, and each row opens
    // on its own.
    expect(markup).toContain("shimmer-text");
    expect(markup).toContain("Show Correctness review&#x27;s work");
    // The rows sit outside the fold, so they stay put as the work collapses.
    expect(markup).toContain("Both reviewers agree.");
  });

  it("keeps the turn's status line at the top of the turn above a stack", () => {
    const markup = render(
      [
        { id: "user", role: "user", text: "Review this", startedAt: 1_000 },
        { id: "lead", role: "assistant", text: "I will run two reviews." },
        tool("t0"),
        { id: "plan", role: "assistant", text: "Splitting the review in two." },
        {
          id: "a1",
          role: "tool",
          text: "Independently review the current repository's recent changes for correctness and regressions. Inspect the uncommitted diff.",
          tool: { callId: "agent-1", kind: "agent", status: "in_progress" },
        },
        tool("t1"),
        { id: "answer", role: "assistant", text: "Both reviewers agree." },
      ],
      true,
    );

    // The line the work folds behind sits above everything it folds, and a
    // stack of delegated runs no longer pushes it down the turn.
    const statusAt = markup.indexOf("Show the work");
    const stackAt = markup.indexOf("Independently review");
    expect(statusAt).toBeGreaterThan(-1);
    expect(stackAt).toBeGreaterThan(statusAt);
    // The work around it is collapsed away, and the stack is still on screen:
    // it is pinned outside the fold's body, not inside it.
    expect(markup).not.toContain("hidden-detail-t1");
    expect(markup).not.toContain("Splitting the review in two.");
    // A row-length name is capped, and the whole brief stays on the hover.
    expect(markup).toContain(
      "Independently review the current repository&#x27;s recent…",
    );
    expect(markup).toContain("Inspect the uncommitted diff.");
  });

  it("groups an opened subagent's trail the way the main transcript does", () => {
    const markup = render(
      [
        { id: "user", role: "user", text: "Review this", durationMs: 4_000 },
        {
          id: "a1",
          role: "tool",
          // A failed run opens itself, which is the only way to see an open
          // panel without a click.
          text: "Correctness review",
          tool: { callId: "agent-1", kind: "agent", status: "failed" },
          agentRun: {
            name: "Correctness review",
            steps: [
              { id: "s1", kind: "message", text: "Reading the diff first." },
              { id: "s2", kind: "tool", text: "Read src/App.tsx" },
              { id: "s3", kind: "tool", text: "Read src/lib/session.ts" },
            ],
          },
        },
        { id: "answer", role: "assistant", text: "It could not finish." },
      ],
      true,
    );

    // The run's own words title a group, with the calls they introduced under
    // it — not one flat dump of every step it took.
    expect(markup).toContain("Reading the diff first.");
    expect(markup).toContain("Show the steps for Reading the diff first.");
    // An open row holds its wash, so the panel reads as hanging off it.
    expect(markup).toContain("hover:bg-content/5 bg-content/8");
    // The panel opens straight onto its phases. A scroll window of its own
    // here would nest one 17.5rem scroller inside the window each phase
    // already keeps, and the inner one could never reach its last row.
    expect(markup).toMatch(
      /data-open="true"><div[^>]*class="zen-fold-item"[^>]*data-fold-state="open"[^>]*><div><div class="flex min-w-0 flex-col pb-1">/,
    );
    // A settled group stays folded behind its header, so opening a long run
    // no longer dumps every call it made on screen at once.
    expect(markup).toContain('class="zen-phase-body" data-open="false"');
    expect(markup).not.toContain("src/lib/session.ts");
  });

  it("offers failed subagent tool results in the same error control as top-level tools", () => {
    const markup = render([
      { id: "user", role: "user", text: "Run tests" },
      {
        id: "agent",
        role: "tool",
        text: "Run tests",
        tool: { callId: "agent-1", kind: "agent", status: "failed" },
        agentRun: {
          name: "Run tests",
          steps: [
            {
              id: "bash",
              kind: "tool",
              text: "npm test",
              toolKind: "execute",
              status: "failed",
              detail: "Tests failed: assertion error",
            },
          ],
        },
      },
    ]);

    expect(markup).toContain("Show error details for npm test");
  });

  it("counts a failed step on a folded subagent row, so it is not hidden", () => {
    const markup = render([
      { id: "user", role: "user", text: "Run tests" },
      {
        id: "agent",
        role: "tool",
        text: "Run tests",
        // The run itself finished; only one of its steps did not.
        tool: { callId: "agent-1", kind: "agent", status: "completed" },
        agentRun: {
          name: "Run tests",
          steps: [
            { id: "read", kind: "tool", text: "Read package.json" },
            {
              id: "bash",
              kind: "tool",
              text: "npm test",
              status: "failed",
              detail: "Tests failed: assertion error",
            },
            { id: "fix", kind: "tool", text: "Edit src/App.tsx" },
          ],
        },
      },
    ]);

    expect(markup).toContain("3 steps, 1 failed");
  });

  it("opens a lone subagent straight into its own transcript", () => {
    const markup = render(
      [
        { id: "user", role: "user", text: "Review this", durationMs: 4_000 },
        {
          id: "a1",
          role: "tool",
          text: "Correctness review",
          tool: { callId: "agent-1", kind: "agent", status: "completed" },
          agentRun: {
            name: "Correctness review",
            steps: [
              {
                id: "s1",
                kind: "tool",
                text: "Read src/App.tsx",
                status: "completed",
              },
              { id: "s2", kind: "message", text: "Nothing to flag." },
            ],
          },
        },
        { id: "answer", role: "assistant", text: "Clean." },
      ],
      true,
    );

    // One agent needs no stack header: its own row is the row.
    expect(markup).not.toContain("Show every subagent");
    expect(markup).toContain("Correctness review");
    expect(markup).toContain("1 step");
    expect(markup).not.toContain("done");
    expect(markup).toContain("Show Correctness review&#x27;s work");
  });

  it("places a session accessory after the latest reply and before its action row", () => {
    const markup = render(
      [
        {
          id: "user",
          role: "user",
          text: "Change the files",
          startedAt: 1_000,
          durationMs: 500,
        },
        { id: "answer", role: "assistant", text: "Done changing files." },
      ],
      false,
      createElement("aside", { "data-test-review": true }, "Changed files"),
    );

    expect(markup.indexOf("Done changing files.")).toBeLessThan(
      markup.indexOf("Changed files"),
    );
    expect(markup.indexOf("Changed files")).toBeLessThan(
      markup.indexOf('aria-label="Worked for 1s"'),
    );
  });

  it("renders an advisor interjection between answered work phases", () => {
    // Live: the interjection lands on its own labeled row. Once the turn
    // settles it folds into the work trail — covered below.
    const markup = render(
      [
        tool("before"),
        { id: "answer", role: "assistant", text: "Complete answer." },
        {
          id: "advisor",
          role: "system",
          text: "Check the fallback.",
          interjection: { customType: "advisor", severity: "concern" },
        },
        tool("after"),
        { id: "ack", role: "assistant", text: "Checked." },
      ],
      true,
    );

    expect(markup).toContain("Complete answer.");
    expect(markup).toContain('aria-label="Interjection: Advisor"');
    expect(markup).toContain("Concern");
    expect(markup).toContain("Check the fallback.");
    expect(markup).toContain("Checked.");
  });

  it("folds a settled turn's interjections into the work trail", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Keep me posted" },
      tool("t1"),
      {
        id: "i1",
        role: "system",
        text: "ping from #general",
        interjection: { customType: "irc:incoming" },
      },
      {
        id: "i2",
        role: "system",
        text: "another ping",
        interjection: { customType: "irc:incoming" },
      },
      tool("t2"),
      {
        id: "i3",
        role: "system",
        text: "last ping",
        interjection: { customType: "irc:incoming" },
      },
      {
        id: "answer",
        role: "assistant",
        text: "The investigation is complete.",
      },
    ];

    const settled = render(blocks);
    // One fold line for the whole trail: the calls, and the notes they
    // absorbed. The dividers themselves stay behind the fold until opened.
    expect(settled).toContain("Ran 2 commands · 3 notes");
    expect(settled).toContain("The investigation is complete.");
    expect(settled).not.toContain('aria-label="Interjection:');
    expect(settled).not.toContain("ping from #general");

    // While the turn is live the same notes still land as their own rows.
    const live = render(blocks, true);
    expect(live.match(/aria-label="Interjection: irc:incoming"/g)).toHaveLength(
      3,
    );
    expect(live).toContain("ping from #general");
  });
});

describe("turn fold line", () => {
  it("stays at the top of the turn after an answered question", () => {
    const markup = render([
      { id: "user", role: "user", text: "Commit", startedAt: 1_000, durationMs: 2_000 },
      tool("t1"),
      { id: "ask", role: "assistant", text: "Include the new files?" },
      {
        id: "question",
        role: "system",
        text: "Include the new files?",
        question: {
          requestId: 1,
          decision: "answered",
          reply: { kind: "answered", answers: { q: ["keep"] } },
          questions: [{
            id: "q", prompt: "Include the new files?", allowCustom: false, multiSelect: false,
            options: [{ id: "keep", label: "Keep them for later" }],
          }],
        },
      },
      tool("t2"),
      { id: "answer", role: "assistant", text: "Committed." },
    ]);
    const line = markup.indexOf('aria-label="Show the work"');
    expect(line).toBeGreaterThan(-1);
    expect(line).toBeLessThan(markup.indexOf("data-question-history"));
    expect(markup.indexOf("Worked for 2s")).toBeGreaterThan(markup.indexOf("Committed."));
    // The answer shows on the card without opening it.
    expect(markup).toContain("Keep them for later");
  });
});

describe("worker assignment prompts", () => {
  it("hides the assignment envelope and keeps the task text", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        managed: true,
        blocks: [
          {
            id: "u1",
            role: "user",
            internal: true,
            text: "Review the current branch against main.\n\n<omnicode_assignment>\nYou are a worker managed by a OmniCode lead. Your assigned write scope is: src/App.tsx.\n</omnicode_assignment>",
          },
          { id: "a1", role: "assistant", text: "Looking now" },
        ],
      }),
    );
    expect(markup).toContain("Review the current branch against main.");
    expect(markup).toContain("Looking now");
    expect(markup).not.toContain("omnicode_assignment");
    expect(markup).not.toContain("You are a worker managed by a OmniCode lead");
  });
});

describe.each(["chat", "full"] as const)(
  "AgentTranscript %s image messages",
  (layout) => {
    beforeEach(() => {
      appearance.layout = layout;
    });

    afterEach(() => {
      appearance.layout = "chat";
    });

    it("lifts sent images above the text bubble", () => {
      const markup = render([
        {
          id: "user",
          role: "user",
          text: "Make this a capsule",
          attachments: [
            {
              id: "image",
              name: "shot.png",
              mimeType: "image/png",
              kind: "image",
              size: 1,
              data: "AA==",
            },
          ],
        },
      ]);
      const media = markup.indexOf("user-message-media");
      const bubble = markup.indexOf("user-message-bubble");
      expect(media).toBeGreaterThan(-1);
      expect(media).toBeLessThan(bubble);
      expect(markup.slice(bubble)).not.toContain("attachment-chip-image");
    });

    it("omits the empty bubble for an image-only message", () => {
      const markup = render([
        {
          id: "user",
          role: "user",
          text: "",
          attachments: [
            {
              id: "image",
              name: "shot.png",
              mimeType: "image/png",
              kind: "image",
              size: 1,
              data: "AA==",
            },
          ],
        },
      ]);
      expect(markup).toMatch(/<div hidden=""[^>]*user-message-bubble/);
    });
  },
);


it("keeps each turn accessory beside its reply while the next turn runs", () => {
  const blocks: Block[] = [
    { id: "u1", role: "user", text: "First", startedAt: 1000, durationMs: 500, checkpointTurnId: "first" },
    { id: "a1", role: "assistant", text: "First reply" },
    { id: "u2", role: "user", text: "Second", startedAt: 2000, checkpointTurnId: "second" },
    { id: "a2", role: "assistant", text: "Second reply", streaming: true },
  ];
  const markup = renderToStaticMarkup(createElement(AgentTranscript, {
    blocks, busy: true,
    turnAccessory: (user, latest) => createElement("aside", {}, `${user?.checkpointTurnId}:${latest}`),
  }));
  expect(markup.indexOf("First reply")).toBeLessThan(markup.indexOf("first:false"));
  expect(markup.indexOf("first:false")).toBeLessThan(markup.indexOf("Second reply"));
  expect(markup).toContain("second:true");
});
