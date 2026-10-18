import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { expect, it, vi } from "vitest";
import {
  acquireHarnessBridge,
  configureChildBackend,
} from "../../../src/integrations/harness/core/child";
import { HostChildBackend } from "../../child-backend";
import { HostEngine } from "../../engine";
import { hostProviders } from "../../providers";
import { HostStore } from "../../store";

it.each(["pi", "omp"] as const)(
  "refreshes %s assistant grants between consecutive turns while retaining native history",
  async (harness) => {
    const root = mkdtempSync(join(tmpdir(), `assistant-${harness}-grants-`));
    const cwd = join(root, "repo"),
      log = join(root, "turns.jsonl"),
      binary = join(root, "rpc-fixture.cjs");
    mkdirSync(cwd);
    writeFileSync(
      binary,
      `
const fs = require('node:fs'), net = require('node:net'), crypto = require('node:crypto');
const env = process.env, emit = value => process.stdout.write(JSON.stringify(value)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const input = JSON.parse(line);
  emit({type:'response', id:input.id, command:input.type, success:true, data:input.type === 'get_state' ? {sessionId:'retained-brain', model:{provider:'fixture', id:'test', contextWindow:200000}, isStreaming:false} : {}});
  if (input.type !== 'prompt') return;
  const socket = net.connect(Number(env.MONOCODE_CONTROL_ENDPOINT.split(':')[1]), '127.0.0.1');
  let reply = '';
  socket.setEncoding('utf8');
  socket.on('connect', () => socket.write(JSON.stringify({namespace:'assistant', token:env.MONOCODE_CONTROL_TOKEN, requestId:'catalog-'+crypto.randomUUID(), action:'projects.list', input:{}})+'\\n'));
  socket.on('data', data => reply += data);
  socket.on('end', () => {
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({pid:process.pid, grant:crypto.createHash('sha256').update(env.MONOCODE_CONTROL_TOKEN).digest('hex'), args:process.argv.slice(2), reply:JSON.parse(reply)})+'\\n');
    emit({type:'agent_end', isTerminal:true});
    emit({type:'agent_settled'});
  });
});
`,
    );
    const store = new HostStore(join(root, "host.db"));
    store.addProject(cwd, "Fixture");
    const backend = new HostChildBackend(
      { [harness]: binary },
      undefined,
      store,
    );
    configureChildBackend(backend);
    const releaseBridge = await acquireHarnessBridge();
    const engine = new HostEngine(store, { [harness]: hostProviders[harness] });
    const issued: Record<string, string>[] = [];
    try {
      await engine.ready;
      backend.configureSessionEnvironment((id) => {
        const environment = engine.assistant.environment(id);
        if (environment.MONOCODE_CONTROL_TOKEN) issued.push(environment);
        return environment;
      });
      engine.assistant.setCatalog(
        async () => [harness],
        async () => ({
          models: { [harness]: [{ id: `${harness}:default`, name: "Test" }] },
          errors: {},
        }),
      );
      await engine.assistant.rpc("assistant.configure", {
        commandId: "configure",
        expectedRevision: 0,
        patch: {
          harness,
          model: `${harness}:default`,
          triggers: { user: true, event: false, schedule: false },
        },
      });
      for (const commandId of ["first", "second"]) {
        const receipt = (await engine.assistant.rpc("assistant.send", {
          commandId,
          text: "Read the projects",
        })) as { wakeupId: string };
        await vi.waitFor(
          () =>
            expect({
              state: engine.assistant.store.wakeup(receipt.wakeupId)?.state,
              error: engine.assistant.store.get()?.error,
            }).toEqual({ state: "completed", error: undefined }),
          { timeout: 6000 },
        );
      }
      const turns = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(turns).toHaveLength(2);
      expect(turns.map((turn) => turn.reply.ok)).toEqual([true, true]);
      expect(turns[1].pid).not.toBe(turns[0].pid);
      expect(turns[1].grant).not.toBe(turns[0].grant);
      expect(turns[1].args).toContain("retained-brain");
      for (const environment of issued) {
        const reply = await new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
          const socket = connect(Number(environment.MONOCODE_CONTROL_ENDPOINT.split(":")[1]), "127.0.0.1");
          let data = "";
          socket.setEncoding("utf8");
          socket.on("error", reject);
          socket.on("connect", () => socket.write(JSON.stringify({ namespace: "assistant", token: environment.MONOCODE_CONTROL_TOKEN, requestId: "revoked-probe", action: "projects.list", input: {} }) + "\n"));
          socket.on("data", chunk => { data += chunk; });
          socket.on("end", () => resolve(JSON.parse(data)));
        });
        expect(reply).toMatchObject({ ok: false, error: "Connection revoked or unauthorized" });
      }
      const brain = store.session(
        engine.assistant.store.get()!.brainSessionId!,
      );
      expect(brain.session.providerSessionId).toBe("retained-brain");
      expect(
        brain.session.blocks.filter((block) => block.role === "user"),
      ).toHaveLength(2);
    } finally {
      await engine.close();
      await backend.close();
      releaseBridge();
      await new Promise((resolve) => setTimeout(resolve, 0));
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  18000,
);
