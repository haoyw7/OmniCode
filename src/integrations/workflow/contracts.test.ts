import { expectTypeOf, test } from "vitest";
import type { z } from "zod";
import type { CreateWorkflowCausalityGraph, WorkflowAgentRuntime, WorkflowRunsState } from "../../contracts/workflow";
import { CreateWorkflowCausalityGraphSchema, WorkflowAgentRuntimeSchema } from "./createWorkflow";
import { workflowRunsStateSchema } from "./protocol/workflow-runs";

// The transport model must retain the existing validators' exact output shape.
// Run this file with TypeScript too: Vitest alone does not check type assertions.
test("workflow transport contracts match the existing runtime validators", () => {
  expectTypeOf<z.output<typeof WorkflowAgentRuntimeSchema>>().toEqualTypeOf<WorkflowAgentRuntime>();
  expectTypeOf<z.output<typeof CreateWorkflowCausalityGraphSchema>>().toEqualTypeOf<CreateWorkflowCausalityGraph>();
  expectTypeOf<z.output<typeof workflowRunsStateSchema>>().toEqualTypeOf<WorkflowRunsState>();
});
