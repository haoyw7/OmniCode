type Size = { cols: number; rows: number };

export function createTerminalResize(send: (cols: number, rows: number) => Promise<void>) {
  let pending: Size | undefined;
  let delivered: Size | undefined;
  let sending = false;
  let disposed = false;

  const flush = async () => {
    if (sending || disposed) return;
    sending = true;
    try {
      while (pending && !disposed) {
        const next = pending;
        pending = undefined;
        if (next.cols === delivered?.cols && next.rows === delivered.rows) continue;
        try {
          await send(next.cols, next.rows);
          delivered = next;
        } catch {
          delivered = undefined;
        }
      }
    } finally {
      sending = false;
    }
  };

  return {
    request(cols: number, rows: number) {
      if (disposed) return;
      pending = { cols, rows };
      void flush();
    },
    dispose() {
      disposed = true;
      pending = undefined;
    },
  };
}
