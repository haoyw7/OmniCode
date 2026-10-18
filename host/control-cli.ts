/** Client only: the execution runtime never imports or starts a session Host. */
import { runControlCli } from "./control";
import { runAgentsCli, runAgentsMcp } from "./bots/agents-mcp";

const [namespace, ...args] = process.argv.slice(2);
if (namespace === "agents-mcp") await runAgentsMcp();
else if (namespace === "agents") process.exitCode = await runAgentsCli(args);
else if (namespace !== "control" && namespace !== "workflow" && namespace !== "assistant") {
  process.stderr.write("Expected control, workflow, assistant, agents, or agents-mcp\n");
  process.exitCode = 1;
} else process.exitCode = await runControlCli(args, namespace);
