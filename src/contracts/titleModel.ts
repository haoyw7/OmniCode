/** Public configuration never includes the saved API credential. */
export type TitleModelStatus = {
  enabled: boolean;
  endpoint: string;
  model: string;
  hasApiKey: boolean;
};

export type TitleModelUpdate = Pick<
  TitleModelStatus,
  "enabled" | "endpoint" | "model"
> & {
  /** Omitted preserves the saved key; an empty string explicitly removes it. */
  apiKey?: string;
};

export const DEFAULT_TITLE_MODEL: TitleModelStatus = {
  enabled: false,
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "",
  hasApiKey: false,
};
