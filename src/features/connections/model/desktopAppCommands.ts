import type { DesktopAppCommand, DesktopAppCommandPoll, DesktopAppCommandResponse } from "../../../contracts/app";
import type { RemoteMachine } from "../../../contracts/protocol";
import { remoteRequest } from "./connections";
import { loadRemoteHostDescriptor } from "./remoteHostMetadata";

/** Window presentation is a leased Host delivery; execution stays on Host. */
export function consumeDesktopAppCommands(machine: RemoteMachine, windowId: string,
  sessionIds: () => string[], handle: (command: DesktopAppCommand) => Promise<unknown>): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const receipts = new Map<string, { signature: string; response: DesktopAppCommandResponse }>();
  const delay = () => new Promise<void>(resolve => {
    wake = resolve;
    timer = setTimeout(() => { timer = undefined; wake = undefined; resolve(); }, 1_000);
  });
  void (async () => {
    while (!stopped) {
      try {
        const descriptor = await loadRemoteHostDescriptor(machine.id, machine.environmentId);
        if (stopped || !descriptor.capabilities.includes("app.desktopCommands.v1")) return;
        while (!stopped) {
          const result = await remoteRequest<DesktopAppCommandPoll>(machine.id, "app.commands.poll", {
            windowId, sessionIds: sessionIds(), waitMs: 25_000,
          });
          if (stopped) return;
          for (const command of result.commands) {
            if (stopped) return;
            const signature = JSON.stringify(command);
            const previous = receipts.get(command.id);
            let response: DesktopAppCommandResponse;
            if (previous) response = previous.signature === signature ? previous.response
              : { ok: false, error: "Request ID was already used with different input" };
            else {
              try { response = { ok: true, result: await handle(command) }; }
              catch (error) { response = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
              receipts.set(command.id, { signature, response });
              if (receipts.size > 256) receipts.delete(receipts.keys().next().value!);
            }
            await remoteRequest(machine.id, "app.commands.complete", { windowId, id: command.id, response });
          }
        }
      } catch {
        if (!stopped) await delay();
      }
    }
  })();
  return () => { stopped = true; clearTimeout(timer); wake?.(); };
}
