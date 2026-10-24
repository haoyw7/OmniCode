export type BotNotification = {
  id: string;
  revision: number;
  kind: "reply" | "input";
  text: string;
};

/** Public chat activity only; worker sessions and internal status never alert. */
export type BotNotificationActivity = {
  id: string;
  name: string;
  revision: number;
  latest?: BotNotification;
};
