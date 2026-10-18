// Monocode shim for ZCode's renderer logger.
type Fields = Record<string, unknown>;
export const logger = {
  debug: (_message: string, _fields?: Fields) => {},
  info: (_message: string, _fields?: Fields) => {},
  warn: (message: string, fields?: Fields) => console.warn(`[workflows] ${message}`, fields ?? ""),
  error: (message: string, fields?: Fields) => console.error(`[workflows] ${message}`, fields ?? ""),
};
