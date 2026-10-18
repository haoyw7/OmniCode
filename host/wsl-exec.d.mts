import type { Readable, Writable } from "node:stream";
import type { Server } from "node:net";

export const WSL_EXEC_PROTOCOL: number;
export const MAX_FRAME_BYTES: number;
export function readLines(input: Readable, onLine: (line: string) => void, onError: (error: Error) => void, maximum?: number): () => void;
export interface ProcessIdentity { pid: number; startTime: string; bootId: string }
export function processIdentity(pid: number, procRoot?: string): Promise<ProcessIdentity>;
export function cleanupOrphans(directory: string, options?: { identify?: (pid: number) => Promise<ProcessIdentity>; kill?: (pid: number) => void | Promise<void> }): Promise<void>;
export function createWslExecServer(options: { socket: string; runDirectory: string }): Promise<{ server: Server; close(): Promise<void> }>;
export function probeWslExec(socket: string, timeout?: number): Promise<{ ready: number; service: string; runtime: string; connections: number }>;
export function prepareWslExec(runDirectory: string, socket: string): Promise<void>;
export function bridgeWslExec(socket: string, input?: Readable, output?: Writable): Promise<void>;
