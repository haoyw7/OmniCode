/** Public account details only. DSH owns credentials, login and wallet queries. */
export type DeepseekAccountClient = {
  version: string;
  locale: string;
  timezoneOffsetSeconds: number;
};

export type DeepseekAccount = {
  status: "signed-out" | "credential-stored" | "unsupported";
  profile?: { name: string | null; contact: string | null };
  profileStatus?: "ready" | "failed";
  balanceStatus?: "ready" | "failed";
  wallets?: { currency: "CNY" | "USD"; balance: string }[];
  bonusWallets?: { currency: "CNY" | "USD"; balance: string }[];
};

/** Whitelist the wire result before publishing it beyond the execution Host. */
export function parseDeepseekAccount(value: unknown): DeepseekAccount {
  const data = value as DeepseekAccount | null;
  if (!data || !["signed-out", "credential-stored", "unsupported"].includes(data.status))
    throw new Error("Invalid DeepSeek account response");
  if (data.status !== "credential-stored") return { status: data.status };
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
  const wallets = (value: unknown): NonNullable<DeepseekAccount["wallets"]> =>
    Array.isArray(value) ? value.flatMap(wallet =>
      wallet && (wallet.currency === "CNY" || wallet.currency === "USD") &&
      typeof wallet.balance === "string" && /^-?\d+(?:\.\d+)?$/.test(wallet.balance)
        ? [{ currency: wallet.currency, balance: wallet.balance }] : []) : [];
  return {
    status: data.status,
    profileStatus: data.profileStatus === "ready" && data.profile ? "ready" : "failed",
    ...(data.profileStatus === "ready" && data.profile ? {
      profile: { name: text(data.profile.name), contact: text(data.profile.contact) },
    } : {}),
    balanceStatus: data.balanceStatus === "ready" ? "ready" : "failed",
    ...(data.balanceStatus === "ready" ? {
      wallets: wallets(data.wallets), bonusWallets: wallets(data.bonusWallets),
    } : {}),
  };
}
