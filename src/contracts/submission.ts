export type BtwCommand = {
  type: "btw";
  commandId: string;
  sessionId: string;
  userBlockId: string;
  threadId: string;
} & (
  | {
      action: "send";
      sourceEndBlockId: string;
      messageId: string;
      text: string;
      model?: string;
      modelSettings?: Record<string, string>;
    }
  | { action: "retry" | "stop" | "delete" }
  | {
      action: "configure";
      model: string;
      modelSettings: Record<string, string>;
    }
);

export type BtwAction = BtwCommand extends infer C
  ? C extends BtwCommand
    ? Omit<C, "commandId" | "sessionId">
    : never
  : never;
