// Local-only model fixture used by the opt-in real-runtime tests. Never shipped to DSH.
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { setTimeout } from "node:timers/promises";

export const inject = ["llm", "tools", "jobs"];
export function apply(ctx) {
  class FixtureAdapter extends LlmAdapter {
    providerInfo(id) {
      return { id, name: "OmniCode fixture" };
    }
    async listModels(provider) {
      return [
        await this.resolveModel(provider, "fixture"),
        await this.resolveModel(provider, "text-only"),
      ];
    }
    async resolveModel(provider, model) {
      return {
        provider,
        id: model,
        name: model,
        inputModalities: model === "text-only" ? ["text"] : ["text", "image"],
        contextWindow: 32000,
      };
    }
    async *stream(options) {
      const messages = options.messages;
      let start = -1;
      for (let index = 0; index < messages.length; index++) {
        if (
          messages[index].role === "user" &&
          messages[index].content?.some(
            (block) =>
              block.type === "text" && block.text.startsWith("fixture:"),
          )
        )
          start = index;
      }
      const prompt =
        messages[start]?.content
          ?.filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n") ?? "";
      const result = messages
        .slice(start + 1)
        .find((message) => message.role === "tool");
      const review = JSON.stringify(options).includes("REVIEW_POLICY");
      if (prompt.includes("fixture:error")) {
        yield {
          type: "finish",
          reason: {
            kind: "error",
            failure: {
              code: "AUTHENTICATION_FAILED",
              message: "Fixture authentication failure",
            },
          },
        };
        return;
      }
      const latest = messages.findLast((message) => message.role === "user");
      const late = latest?.content?.some(
        (block) =>
          block.type === "text" &&
          block.text.includes("answer_to_pending_question"),
      );
      const imageInput = messages.some(
        (message) =>
          message.role === "user" &&
          message.content?.some((block) => block.type === "image"),
      );
      const tool =
        !result &&
        (prompt.includes("fixture:write")
          ? {
              name: "write",
              arguments: JSON.stringify({
                file_path:
                  prompt.match(/file=([\w.-]+)/)?.[1] ?? "fixture-result.txt",
                content: "fixture result",
              }),
            }
          : prompt.includes("fixture:question")
            ? {
                name: "ask_user_question",
                arguments: JSON.stringify({
                  timeout: prompt.includes("timeout") ? 1 : 120,
                  questions: [
                    {
                      id: "choice",
                      question: "Choose a fixture",
                      options: [{ label: "One" }, { label: "Two" }],
                    },
                  ],
                }),
              }
            : prompt.includes("fixture:plan")
              ? {
                  name: "exit_plan_mode",
                  arguments: JSON.stringify({
                    plan: "# Fixture plan\n\n1. Inspect\n2. Implement\n3. Verify",
                  }),
                }
              : prompt.includes("fixture:image-output")
                ? {
                    name: "read_image",
                    arguments: JSON.stringify({ file_path: "fixture.png" }),
                  }
                : prompt.includes("fixture:todos")
                  ? {
                      name: "todo_write",
                      arguments: JSON.stringify({
                        todos: [
                          { content: "Fixture task", status: "in_progress" },
                        ],
                      }),
                    }
                  : prompt.includes("fixture:delegate")
                    ? {
                        name: "subagent",
                        arguments: JSON.stringify({
                          description: "Fixture child",
                          prompt: "fixture:slow child",
                        }),
                      }
                    : prompt.includes("fixture:job")
                      ? { name: "omnicode_fixture_job", arguments: "{}" }
                      : undefined);
      if (tool && !review && !late) {
        const block = {
          type: "tool-call",
          id: `fixture-call-${messages.length}`,
          ...tool,
        };
        yield { type: "block-start", index: 0, blockType: "tool-call" };
        yield {
          type: "tool-call-delta",
          index: 0,
          id: block.id,
          name: block.name,
          argumentsDelta: block.arguments,
        };
        yield { type: "block-end", index: 0, block };
        yield { type: "finish", reason: { kind: "tool-calls" } };
        return;
      }
      const text = review
        ? '{"risk":"low","decision":"allow"}'
        : late
          ? "native late answer received"
          : imageInput
            ? "image received"
            : "live response";
      const split = Math.min(5, text.length);
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text: text.slice(0, split) };
      try {
        await setTimeout(
          prompt.includes("fixture:slow") ? 1500 : 20,
          undefined,
          { signal: options.signal },
        );
      } catch {
        yield {
          type: "finish",
          reason: {
            kind: "aborted",
            failure: { code: "ABORTED", message: "Fixture cancelled" },
          },
        };
        return;
      }
      yield { type: "text-delta", index: 0, text: text.slice(split) };
      yield { type: "block-end", index: 0, block: { type: "text", text } };
      yield { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } };
      yield { type: "finish", reason: { kind: "stop" } };
    }
  }
  ctx.llm.registerAdapter(["omnicode-fixture"], new FixtureAdapter());
  ctx.tools.register(
    defineTool({
      name: "omnicode_fixture_job",
      description: "Start a local fixture job",
      parameters: {},
      output: {
        schema: { type: "string" },
        render: (_args, id) => [{ type: "text", text: id }],
      },
      execute(_args, exec) {
        return ctx.jobs.start({
          kind: "fixture",
          label: "Fixture background job",
          owner: exec.agent.session.id,
          run() {
            const controller = new AbortController();
            const done = setTimeout(800, undefined, {
              signal: controller.signal,
            }).then(
              () => ({ status: "completed" }),
              () => ({ status: "killed" }),
            );
            return { done, cancel: () => controller.abort() };
          },
        });
      },
    }),
  );
}
