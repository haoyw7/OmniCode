import { ImChannelRegistry } from "./registry.ts";
import { ImMessageRouter } from "./router.ts";
import { ImSessionMap } from "./sessionMap.ts";
import type { ImChannel, ImRouteHandler } from "./types.ts";

export type ImRuntimeState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "failed";

/** Lifecycle shell for caller-supplied channels. Nothing starts on import. */
export class ImRuntime {
  readonly sessions: ImSessionMap;
  private readonly channels = new ImChannelRegistry();
  private readonly router: ImMessageRouter;
  private readonly active = new Set<ImChannel>();
  private currentState: ImRuntimeState = "stopped";
  private generation = 0;

  constructor(options: { onMessage: ImRouteHandler; sessions?: ImSessionMap }) {
    this.sessions = options.sessions ?? new ImSessionMap();
    this.router = new ImMessageRouter(
      this.channels,
      this.sessions,
      options.onMessage,
    );
  }

  get state(): ImRuntimeState {
    return this.currentState;
  }

  register(channel: ImChannel): void {
    if (this.state !== "stopped") {
      throw new Error("IM channels can only be registered while stopped");
    }
    this.channels.register(channel);
  }

  async start(): Promise<void> {
    if (this.state === "running") return;
    if (this.state !== "stopped") {
      throw new Error(`Cannot start IM runtime while ${this.state}`);
    }
    const channels = this.channels.list();
    if (!channels.length) throw new Error("No IM channels are registered");
    this.currentState = "starting";
    const generation = ++this.generation;
    const isActive = () =>
      this.generation === generation &&
      (this.state === "starting" || this.state === "running");
    try {
      for (const channel of channels) {
        this.active.add(channel);
        await channel.start(async (message) => {
          if (!isActive()) {
            throw new Error("IM runtime is not accepting messages");
          }
          if (message.conversation.channelId !== channel.id) {
            throw new Error("IM message channel does not match its source");
          }
          await this.router.receive(message, isActive);
        });
      }
      this.currentState = "running";
    } catch (error) {
      this.currentState = "stopping";
      const failures = await this.stopActive();
      this.currentState = failures.length ? "failed" : "stopped";
      if (failures.length) {
        throw new AggregateError([error, ...failures], "IM startup and cleanup failed");
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state === "stopped") return;
    if (this.state !== "running" && this.state !== "failed") {
      throw new Error(`Cannot stop IM runtime while ${this.state}`);
    }
    this.currentState = "stopping";
    const failures = await this.stopActive();
    this.currentState = failures.length ? "failed" : "stopped";
    if (failures.length) {
      throw new AggregateError(failures, "IM channel cleanup failed");
    }
  }

  private async stopActive(): Promise<unknown[]> {
    const failures: unknown[] = [];
    for (const channel of [...this.active].reverse()) {
      try {
        await channel.stop();
        this.active.delete(channel);
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  }
}
