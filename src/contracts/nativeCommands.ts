import type { HarnessId } from "./session";

export type NativeCommand = {
  name: string;
  description: string;
  invocation: string;
  source: HarnessId;
  origin?: string;
  aliases?: string[];
  inputHint?: string;
  subcommands?: Array<{ name: string; description?: string; usage?: string }>;
};

export type CommandContext = { cwd: string; sessionId?: string };

export type NativeCommandProvider = {
  discover(context: CommandContext): Promise<NativeCommand[]>;
  subscribe?(
    context: CommandContext,
    onCommands: (commands: NativeCommand[]) => void,
  ): () => void;
  /** Full command runtimes own slash arguments, including @file-like text. */
  rawSlashCommands?: boolean;
};
