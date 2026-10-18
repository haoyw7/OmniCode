import { createServer as createNetServer, type Server as NetServer } from "node:net";
import type { Server as HttpServer } from "node:http";
import { adapterAddresses } from "./pairing-hosts";

const RESCAN_MS = 30_000;

/**
 * Exposes the loopback Host on this computer's adapter addresses so paired
 * phones can reach it directly. Addresses come and go (DHCP, VPN); they are
 * rescanned, and an address another process already holds is retried later.
 */
export function listenOnAdapters(server: HttpServer, port: number): () => void {
  const listeners = new Map<string, NetServer>();
  const warned = new Set<string>();
  let closed = false;

  const sync = () => {
    if (closed) return;
    const current = new Set(adapterAddresses());
    for (const [address, listener] of listeners) {
      if (current.has(address)) continue;
      listener.close();
      listeners.delete(address);
    }
    for (const address of current) {
      if (listeners.has(address)) continue;
      const listener = createNetServer((socket) => server.emit("connection", socket));
      listeners.set(address, listener);
      listener.once("error", (error: NodeJS.ErrnoException) => {
        listeners.delete(address);
        const key = `${address}:${error.code}`;
        if (warned.has(key)) return;
        warned.add(key);
        console.warn(`Host could not listen on ${address}:${port}: ${error.code ?? error.message}`);
      });
      listener.listen(port, address);
    }
  };

  sync();
  const timer = setInterval(sync, RESCAN_MS);
  timer.unref();
  return () => {
    closed = true;
    clearInterval(timer);
    for (const listener of listeners.values()) listener.close();
    listeners.clear();
  };
}
