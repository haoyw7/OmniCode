/** One scheduler owns the motor, even while several transcript surfaces stay mounted. */
export class OutputHaptics {
  private owner?: object;
  private timer?: ReturnType<typeof setTimeout>;
  private samples: { at: number; count: number }[] = [];
  private lastData = -Infinity;
  private lastPulse = -Infinity;
  private interval = 500;
  private blockedUntil = 0;

  constructor(private pulse: () => void, private cancel: () => void) {}

  claim(owner: object) {
    this.stop();
    this.owner = owner;
  }
  release(owner: object) {
    if (this.owner !== owner) return;
    this.stop();
    this.owner = undefined;
  }
  add(owner: object, count: number) {
    if (this.owner !== owner || count <= 0) return;
    const now = Date.now();
    if (now - this.lastData >= 400) {
      this.samples = [];
      this.interval = 500;
    }
    this.samples.push({ at: now, count });
    this.lastData = now;
    if (this.timer === undefined) this.tick();
  }
  /** Interactions take priority over output ticks, without accumulating a backlog. */
  interrupt() {
    this.blockedUntil = Date.now() + 350;
    this.cancel();
  }
  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.samples = [];
    this.lastData = -Infinity;
    this.lastPulse = -Infinity;
    this.cancel();
  }
  private tick = () => {
    this.timer = undefined;
    const now = Date.now();
    if (now - this.lastData >= 400) return;
    this.samples = this.samples.filter((sample) => now - sample.at < 800);
    const cps = this.samples.reduce((sum, sample) => sum + sample.count, 0) / 0.8;
    const target = 1000 / Math.min(6, Math.max(1.5, 1.5 + cps / 20));
    this.interval += (target - this.interval) * 0.25;
    if (now >= this.blockedUntil && now - this.lastPulse >= this.interval) {
      this.lastPulse = now;
      this.pulse();
    }
    this.timer = setTimeout(this.tick, 25);
  };
}
