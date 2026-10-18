import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { HarnessEvent } from "../src/integrations/harness/core/types";
import {
  acquireHarnessBridge,
  configureChildBackend,
} from "../src/integrations/harness/core/child";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../src/features/orchestration/model/orchestrationState";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { HostChildBackend } from "./child-backend";
import { hostProviders } from "./providers";

it.each(["pi", "omp"] as const)(
  "runs the %s RPC adapter with lead-only control grants and worker scratch isolation",
  async (harness) => {
    const root = mkdtempSync(
      join(tmpdir(), `monocode-${harness}-orchestration-env-`),
    );
    const cwd = join(root, "repo");
    const scratch = join(root, "worker-scratch");
    mkdirSync(cwd);
    mkdirSync(scratch);
    const binary = join(root, "rpc-fixture.cjs");
    writeFileSync(
      binary,
      `const fs = require('node:fs');
const path = require('node:path');
const env = process.env;
fs.writeFileSync(path.join(${JSON.stringify(root)}, env.MONOCODE_FIXTURE_ID+'.json'), JSON.stringify({
  endpoint: env.MONOCODE_CONTROL_ENDPOINT || null, token: !!env.MONOCODE_CONTROL_TOKEN,
  appEndpoint: !!env.MONOCODE_APP_ENDPOINT, appToken: !!env.MONOCODE_APP_TOKEN,
  tmp: env.TMPDIR, temp: env.TEMP, tmpWindows: env.TMP, args: process.argv.slice(2)
}));
const emit = value => process.stdout.write(JSON.stringify(value)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const input = JSON.parse(line);
  const data = input.type === 'get_state' ? {sessionId: 'fixture-'+env.MONOCODE_FIXTURE_ID, model: {provider:'fixture', id:'test', contextWindow:200000}, isStreaming:false} : {};
  emit({type:'response', id:input.id, command:input.type, success:true, data});
  if(input.type === 'prompt') setTimeout(() => {
    emit({type:'agent_end', isTerminal:true});
    emit({type:'agent_settled'});
  }, 5);
});
`,
    );
    const store = new HostStore(join(root, "host.db"));
    const project = store.addProject(cwd, "Fixture");
    const leadId = `${harness}-lead`;
    const workerId = `${harness}-worker`;
    const ordinaryId = `${harness}-ordinary`;
    for (const id of [leadId, workerId, ordinaryId])
      store.save(
        {
          projectId: project.id,
          revision: 1,
          status: "idle",
          updatedAt: 1,
          session: {
            id,
            title: "Fixture",
            cwd,
            harness,
            model: `${harness}:default`,
            modelSettings: {},
            runtimeMode: "supervised",
            blocks: [],
            ...(id === workerId ? { orchestrationLeadId: leadId } : {}),
          },
        },
        {},
      );
    const task: OrchestrationTask = {
      id: "fixture-worker",
      sessionId: workerId,
      title: "Fixture worker",
      harness,
      model: `${harness}:default`,
      prompt: "Work",
      files: ["."],
      scopes: [cwd],
      dependsOn: [],
      scratchDir: scratch,
      status: "completed",
      accepted: false,
      result: "",
      delivered: false,
      workspacePolicy: "isolated-child",
    };
    const run: OrchestrationRun = {
      version: 2,
      leadId,
      cwd,
      status: "paused",
      allowedHarnesses: [harness],
      maxWorkers: 1,
      cli: "fixture",
      tasks: [task],
      continuations: 0,
      requests: {},
    };
    store.saveOrchestration("fixture-run", run);
    const backend = new HostChildBackend(
      { [harness]: binary },
      undefined,
      store,
    );
    configureChildBackend(backend);
    const releaseBridge = await acquireHarnessBridge();
    const provider = hostProviders[harness];
    const engine = new HostEngine(store, { [harness]: provider });
    for (const key of [
      "MONOCODE_CONTROL_ENDPOINT",
      "MONOCODE_CONTROL_TOKEN",
      "MONOCODE_APP_ENDPOINT",
      "MONOCODE_APP_TOKEN",
    ])
      vi.stubEnv(key, "unrelated-inherited-grant");
    try {
      await engine.ready;
      engine.orchestration.control.enable(leadId);
      backend.configureSessionEnvironment((id) => ({
        ...engine.orchestration.environment(id),
        MONOCODE_FIXTURE_ID: id,
      }));
      for (const sessionId of [leadId, workerId, ordinaryId]) {
        const events: HarnessEvent[] = [];
        await provider.send({
          sessionId,
          cwd,
          model: `${harness}:default`,
          runtimeMode: "supervised",
          text: "Complete the fixture turn",
          onEvent: (event) => events.push(event),
        });
        expect(events).toContainEqual({ type: "session.started" });
        expect(events).toContainEqual({ type: "message.completed" });
        await provider.stop(sessionId);
      }
      const lead = JSON.parse(
        readFileSync(join(root, `${leadId}.json`), "utf8"),
      );
      const worker = JSON.parse(
        readFileSync(join(root, `${workerId}.json`), "utf8"),
      );
      const ordinary = JSON.parse(
        readFileSync(join(root, `${ordinaryId}.json`), "utf8"),
      );
      expect(lead).toMatchObject({
        endpoint:
          engine.orchestration.control.environment(leadId)
            .MONOCODE_CONTROL_ENDPOINT,
        token: true,
        appEndpoint: false,
        appToken: false,
      });
      expect(worker).toMatchObject({
        endpoint: null,
        token: false,
        appEndpoint: false,
        appToken: false,
        tmp: scratch,
        temp: scratch,
        tmpWindows: scratch,
      });
      expect(ordinary).toMatchObject({
        endpoint: null,
        token: false,
        appEndpoint: false,
        appToken: false,
      });
      for (const launched of [lead, worker, ordinary])
        expect(launched.args).toEqual(
          expect.arrayContaining(["--mode", "rpc"]),
        );
      expect(
        store.db
          .prepare(
            "SELECT * FROM checkout_resources WHERE id LIKE 'host-guard:%'",
          )
          .all(),
      ).toEqual([]);
    } finally {
      for (const id of [leadId, workerId, ordinaryId]) await provider.stop(id);
      await engine.close();
      await backend.close();
      store.close();
      vi.unstubAllEnvs();
      releaseBridge();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
  15_000,
);
