import type {
  HarnessId,
  Session,
} from "../../../features/sessions/model/session";
import type { GeneratedSessionTitle } from "../../../features/sessions/model/sessionTitle";
import {
  applyGeneratedTitle,
  applyNativeTitle,
  beginTitleCycle,
  titleStateFor,
} from "../../../features/sessions/model/titlePolicy";

export type NativeTitleInput = {
  sessionId: string;
  providerSessionId: string;
  cwd: string;
  providerAccountId?: string;
};
type Cycle = {
  message: string;
  epoch: number;
  harness: HarnessId;
  account?: string;
  timer?: ReturnType<typeof setTimeout>;
};
type Options = {
  get(id: string): Session | undefined;
  update(
    id: string,
    change: (session: Session) => Session,
  ): void | Promise<void>;
  read(session: Session): Promise<string | null>;
  generate(
    session: Session,
    message: string,
  ): Promise<GeneratedSessionTitle | null>;
};

/** Metadata work outlives turn streaming, but never its session/title ownership. */
export class SessionTitleCoordinator {
  private cycles = new Map<string, Cycle>();
  private reads = new Map<string, Promise<void>>();
  constructor(private readonly options: Options) {}

  begin(id: string, message: string, refresh = false): void {
    const session = this.options.get(id);
    if (!session || titleStateFor(session).source === "manual") return;
    if (
      !refresh &&
      (this.cycles.has(id) ||
        titleStateFor(session).fallbackAttempted ||
        titleStateFor(session).source !== "placeholder")
    )
      return;
    this.cancel(id);
    const next = beginTitleCycle(session, refresh);
    const cycle: Cycle = {
      message,
      epoch: next.titleState!.epoch,
      harness: next.harness,
      account: next.providerAccountId,
    };
    this.cycles.set(id, cycle);
    void Promise.resolve(
      this.options.update(id, (s) =>
        titleStateFor(s).epoch === titleStateFor(session).epoch
          ? beginTitleCycle(s, refresh)
          : s,
      ),
    )
      .then(() => {
        if (refresh || session.harness === "pi" || session.harness === "omp")
          void this.fallback(id, cycle).catch(() => this.cancel(id));
        else void this.read(id);
      })
      .catch(() => this.cancel(id));
  }

  settled(id: string, cancelled = false): void {
    if (cancelled) {
      this.cancel(id);
      return;
    }
    void this.read(id);
    const cycle = this.cycles.get(id);
    const session = this.options.get(id);
    if (
      !cycle ||
      !session ||
      cycle.timer ||
      titleStateFor(session).source !== "placeholder" ||
      titleStateFor(session).fallbackAttempted
    )
      return;
    cycle.timer = setTimeout(() => {
      cycle.timer = undefined;
      void this.read(id)
        .then(() => this.fallback(id, cycle))
        .catch(() => undefined);
    }, 15_000);
    (
      cycle.timer as ReturnType<typeof setTimeout> & { unref?: () => void }
    ).unref?.();
  }

  native(id: string, providerSessionId: string, title: string): void {
    void Promise.resolve(
      this.options.update(id, (s) =>
        applyNativeTitle(s, providerSessionId, title),
      ),
    )
      .then(() => {
        const session = this.options.get(id);
        if (session && titleStateFor(session).source === "native")
          this.cancel(id);
      })
      .catch(() => undefined);
  }

  read(id: string): Promise<void> {
    const existing = this.reads.get(id);
    if (existing) return existing;
    const session = this.options.get(id);
    if (
      !session?.providerSessionId ||
      titleStateFor(session).source === "manual" ||
      titleStateFor(session).purpose === "automation"
    )
      return Promise.resolve();
    const epoch = titleStateFor(session).epoch;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = Promise.race([
      Promise.resolve().then(() => this.options.read(session)),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 5_000);
      }),
    ])
      .then(async (title) => {
        if (!title || this.reads.get(id) !== pending) return;
        await this.options.update(id, (s) =>
          s.harness === session.harness &&
          (s.providerAccountId ?? "default") ===
            (session.providerAccountId ?? "default") &&
          titleStateFor(s).epoch === epoch
            ? applyNativeTitle(s, session.providerSessionId!, title)
            : s,
        );
        const current = this.options.get(id);
        if (current && titleStateFor(current).source === "native")
          this.cancel(id);
      })
      .catch(() => undefined)
      .finally(() => {
        if (timer) clearTimeout(timer);
        if (this.reads.get(id) === pending) this.reads.delete(id);
      });
    this.reads.set(id, pending);
    return pending;
  }

  private async fallback(id: string, cycle: Cycle): Promise<void> {
    const session = this.options.get(id);
    if (
      !session ||
      this.cycles.get(id) !== cycle ||
      session.harness !== cycle.harness ||
      (session.providerAccountId ?? "default") !== (cycle.account ?? "default")
    )
      return;
    const state = titleStateFor(session);
    if (
      state.epoch !== cycle.epoch ||
      state.source !== "placeholder" ||
      state.fallbackAttempted
    )
      return;
    await this.options.update(id, (s) =>
      titleStateFor(s).epoch === cycle.epoch &&
      titleStateFor(s).source === "placeholder"
        ? { ...s, titleState: { ...titleStateFor(s), fallbackAttempted: true } }
        : s,
    );
    const current = this.options.get(id);
    if (
      !current ||
      titleStateFor(current).epoch !== cycle.epoch ||
      titleStateFor(current).source !== "placeholder" ||
      this.cycles.get(id) !== cycle
    )
      return;
    try {
      const generated = await this.options.generate(current, cycle.message);
      if (!generated || this.cycles.get(id) !== cycle) return;
      await this.options.update(id, (s) =>
        s.harness === current.harness &&
        (s.providerAccountId ?? "default") ===
          (current.providerAccountId ?? "default") &&
        (!current.providerSessionId ||
          s.providerSessionId === current.providerSessionId)
          ? applyGeneratedTitle(s, cycle.epoch, generated.title)
          : s,
      );
    } catch {
      /* The durable attempt prevents repeated paid calls after failures. */
    }
  }

  cancel(id: string): void {
    const cycle = this.cycles.get(id);
    if (cycle?.timer) clearTimeout(cycle.timer);
    this.cycles.delete(id);
  }
  close(): void {
    this.reads.clear();
    for (const id of this.cycles.keys()) this.cancel(id);
  }
}
