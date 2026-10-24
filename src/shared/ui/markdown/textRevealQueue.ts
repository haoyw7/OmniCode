/** Coordinate mounted replies without making the whole transcript rerender per character. */
export class TextRevealQueue {
  private order: readonly string[] = [];
  private pending = new Set<string>();
  private listeners = new Set<() => void>();
  private handles = new Map<string, TextRevealSequence>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  isPending(id: string) {
    return this.pending.has(id);
  }

  setOrder(ids: readonly string[]) {
    this.order = ids;
    const current = new Set(ids);
    for (const id of this.handles.keys()) {
      if (!current.has(id)) {
        this.handles.delete(id);
        this.pending.delete(id);
      }
    }
    this.notify();
  }

  forEntry(id: string): TextRevealSequence {
    let handle = this.handles.get(id);
    if (!handle) {
      handle = {
        subscribe: this.subscribe,
        isBlocked: () => {
          for (const earlier of this.order) {
            if (earlier === id) return false;
            if (this.pending.has(earlier)) return true;
          }
          return false;
        },
        setPending: (pending) => {
          if (this.pending.has(id) === pending) return;
          if (pending) this.pending.add(id);
          else this.pending.delete(id);
          this.notify();
        },
      };
      this.handles.set(id, handle);
    }
    return handle;
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

export type TextRevealSequence = {
  subscribe: (listener: () => void) => () => void;
  isBlocked: () => boolean;
  setPending: (pending: boolean) => void;
};
