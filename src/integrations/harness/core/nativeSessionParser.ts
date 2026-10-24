import type { NativeSessionFile, NativeTranscript } from "../../../contracts/session";

/** Native history parsing contract; the Host composes provider implementations. */
export type NativeSessionParser = (
  content: string,
  file: NativeSessionFile,
) => NativeTranscript;
