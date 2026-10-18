export type TelegramAdapterConfig = Parameters<
  typeof import("@chat-adapter/telegram").createTelegramAdapter
>[0];

/** Webhook handling and conversion to ImChannel are future integration work. */
export async function loadTelegramAdapter() {
  return (await import("@chat-adapter/telegram")).createTelegramAdapter;
}
