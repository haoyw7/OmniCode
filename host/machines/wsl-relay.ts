import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import type { MachineTransport } from "../machine-io";
import type { WslExecutionEvent } from "./wsl";

type Connection = MachineTransport & { onEvent(listener: (event: WslExecutionEvent) => void): () => void };
type Tunnel = { socket: Socket; closed: boolean };

/** Linux listeners can reach only endpoints explicitly granted by the Host. */
export class WslLoopbackRelay {
  private endpoints = new Map<string, Promise<string>>();
  private listeners = new Map<string, number>();
  private tunnels = new Map<string, Tunnel>();
  private closed = false;
  private stopEvents: () => void;

  constructor(private readonly rpc: Connection) {
    this.stopEvents = rpc.onEvent(event => this.event(event));
  }

  async environment(environment: Record<string, string>): Promise<Record<string, string>> {
    const mapped = { ...environment };
    for (const key of ["MONOCODE_CONTROL_ENDPOINT", "MONOCODE_WORKFLOW_ENDPOINT"])
      if (mapped[key]) mapped[key] = await this.endpoint(mapped[key]);
    return mapped;
  }

  private endpoint(endpoint: string): Promise<string> {
    if (this.closed) return Promise.reject(new Error("Host is stopping"));
    const match = /^127\.0\.0\.1:(\d{1,5})$/.exec(endpoint);
    const port = Number(match?.[1]);
    if (!match || port < 1 || port > 65535) return Promise.reject(new Error("Host control requires a loopback endpoint"));
    let pending = this.endpoints.get(endpoint);
    if (!pending) {
      const stream = `control:${randomUUID()}`;
      this.listeners.set(stream, port);
      pending = this.rpc.request<{ port: number }>("net.listen", { stream }).then(async result => {
        if (this.closed) { await this.rpc.request("net.close", { stream }); throw new Error("Host is stopping"); }
        return `127.0.0.1:${result.port}`;
      }).catch(error => { this.endpoints.delete(endpoint); this.listeners.delete(stream); throw error; });
      this.endpoints.set(endpoint, pending);
    }
    return pending;
  }

  private drop(stream: string, notify: boolean) {
    const record = this.tunnels.get(stream);
    if (!record || record.closed) return;
    record.closed = true; this.tunnels.delete(stream); record.socket.destroy();
    if (notify && !this.closed) void this.rpc.request("net.end", { stream, destroy: true }).catch(() => {});
  }

  private event(event: WslExecutionEvent) {
    if (event.kind === "disconnect") {
      for (const stream of this.tunnels.keys()) this.drop(stream, false);
      this.endpoints.clear(); this.listeners.clear(); return;
    }
    if (this.closed) return;
    if (event.kind === "tcp-open") {
      const port = this.listeners.get(event.stream);
      const stream = (event.data as { stream?: unknown })?.stream;
      if (typeof stream !== "string") return;
      if (!port || this.tunnels.size >= 128 || this.tunnels.has(stream)) {
        void this.rpc.request("net.end", { stream, destroy: true }).catch(() => {}); return;
      }
      const socket = createConnection({ host: "127.0.0.1", port, allowHalfOpen: true });
      const record = { socket, closed: false }; this.tunnels.set(stream, record);
      socket.setTimeout(10_000, () => this.drop(stream, true));
      socket.on("connect", () => {
        socket.setTimeout(0);
        void this.rpc.request("net.ack", { stream }).catch(() => this.drop(stream, true));
      });
      socket.on("data", chunk => {
        socket.pause();
        void this.rpc.request("net.write", { stream, data: chunk.toString("base64") })
          .then(() => { if (!record.closed) socket.resume(); }, () => this.drop(stream, true));
      });
      socket.on("end", () => {
        if (!record.closed) void this.rpc.request("net.end", { stream }).catch(() => this.drop(stream, true));
      });
      socket.on("error", () => this.drop(stream, true));
      socket.on("close", () => this.drop(stream, true));
    } else if (event.kind === "tcp-data") {
      const record = this.tunnels.get(event.stream);
      if (!record || record.closed) return;
      if (typeof event.data !== "string" || event.data.length > 90_000 || record.socket.writableLength > 2 * 1024 * 1024) { this.drop(event.stream, true); return; }
      const bytes = Buffer.from(event.data, "base64");
      if (bytes.length > 65_536) { this.drop(event.stream, true); return; }
      record.socket.write(bytes, error => {
        if (error) this.drop(event.stream, true);
        else if (!record.closed) void this.rpc.request("net.ack", { stream: event.stream }).catch(() => this.drop(event.stream, true));
      });
    } else if (event.kind === "tcp-end") this.tunnels.get(event.stream)?.socket.end();
    else if (event.kind === "tcp-close") this.drop(event.stream, false);
  }

  async close(notify = true): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.stopEvents();
    for (const stream of this.tunnels.keys()) this.drop(stream, false);
    if (notify) await Promise.allSettled([...this.listeners.keys()].map(stream => this.rpc.request("net.close", { stream })));
    this.endpoints.clear(); this.listeners.clear();
  }
}
