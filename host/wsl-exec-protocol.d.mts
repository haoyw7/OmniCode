import type { Readable } from "node:stream";
export const WSL_EXEC_PROTOCOL: number;
export const MAX_FRAME_BYTES: number;
export function readLines(input: Readable, onLine: (line: string) => void, onError: (error: Error) => void, maximum?: number): () => void;
