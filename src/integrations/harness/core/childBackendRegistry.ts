export interface ChildBackend {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
}

/** Routes process operations without making provider protocols platform-aware. */
export class ChildBackendRegistry implements ChildBackend {
  private backends = new Map<string, ChildBackend>();
  private ready = new Map<string, Promise<void>>();
  private subscriptions = new Set<{
    event: string;
    handler: (event: { payload: unknown }) => void;
    stops: Map<string, () => void>;
    active: boolean;
  }>();
  private select: () => string = () => "local";
  private children = new Map<string, string>();

  setSelector(select: () => string): void { this.select = select; }

  usesSelectedMachine(id: string): boolean {
    const owner = this.children.get(id);
    return owner === undefined || owner === this.select();
  }

  private deliver(key: string, handler: (event: { payload: unknown }) => void, event: { payload: unknown }): void {
    const payload = event.payload;
    const id = payload && typeof payload === "object" && "sessionId" in payload ? payload.sessionId : undefined;
    const owner = typeof id === "string" ? this.children.get(id) : undefined;
    // PIDs may be identical in different distributions. Once an id is rebound,
    // late output or exit events from its previous machine cannot reach it.
    if (!owner || owner === key) handler(event);
  }

  register(key: string, backend: ChildBackend): void {
    if (!key || this.backends.has(key) && this.backends.get(key) !== backend)
      throw new Error(`Child backend already registered: ${key}`);
    if (this.backends.has(key)) return;
    this.backends.set(key, backend);
    const pending = Promise.all([...this.subscriptions].map(async (subscription) => {
      const stop = await backend.listen(subscription.event, event => this.deliver(key, subscription.handler, event));
      if (subscription.active && this.backends.get(key) === backend) subscription.stops.set(key, stop);
      else stop();
    })).then(() => undefined);
    this.ready.set(key, pending);
    void pending.catch(() => undefined);
  }

  replaceLocal(backend: ChildBackend): void {
    if (this.subscriptions.size) throw new Error("Configure the child backend before starting the bridge");
    this.backends.set("local", backend);
    this.ready.set("local", Promise.resolve());
  }

  unregister(key: string): void {
    this.backends.delete(key); this.ready.delete(key);
    for (const subscription of this.subscriptions) {
      subscription.stops.get(key)?.(); subscription.stops.delete(key);
    }
  }

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (command === "harness_kill_all") {
      const results = await Promise.allSettled([...this.backends.values()].map(backend => backend.invoke(command, args)));
      this.children.clear();
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      return undefined as T;
    }
    const id = typeof args?.sessionId === "string" ? args.sessionId : undefined;
    const starting = command === "harness_spawn" || command === "harness_sse_open";
    const previous = id ? this.children.get(id) : undefined;
    const key = starting ? this.select() : previous || this.select();
    const backend = this.backends.get(key);
    if (!backend) throw new Error(`Child backend is not available: ${key}`);
    await this.ready.get(key);
    // Utility processes reuse fixed ids. A new launch follows its current
    // machine; subsequent writes/cancellation stay with that launch's owner.
    // Retain ownership after exit: delayed cancel/write must never hit another machine.
    if (id && starting) {
      this.children.set(id, key);
      if (previous && previous !== key) {
        try { await this.backends.get(previous)?.invoke(command === "harness_spawn" ? "harness_kill" : "harness_sse_close", { sessionId: id }); }
        catch (error) { this.children.set(id, previous); throw error; }
      }
    }
    return backend.invoke<T>(command, args);
  }

  async listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
    const subscription = { event, handler: handler as (event: { payload: unknown }) => void,
      stops: new Map<string, () => void>(), active: true };
    this.subscriptions.add(subscription);
    const stop = () => {
      subscription.active = false;
      this.subscriptions.delete(subscription);
      for (const unlisten of subscription.stops.values()) unlisten();
      subscription.stops.clear();
    };
    try {
      await Promise.all([...this.backends].map(async ([key, backend]) => {
        const unlisten = await backend.listen(event, value => this.deliver(key, subscription.handler, value));
        if (subscription.active) subscription.stops.set(key, unlisten);
        else unlisten();
      }));
    } catch (error) { stop(); throw error; }
    return stop;
  }
}
