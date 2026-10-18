export type FeishuAdapterConfig = Parameters<
  typeof import("@larksuite/vercel-chat-adapter").createLarkAdapter
>[0];

/** Loading the factory does not construct an adapter or open a connection. */
export async function loadFeishuAdapter() {
  return (await import("@larksuite/vercel-chat-adapter")).createLarkAdapter;
}
