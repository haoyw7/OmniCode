/** Provider-owned metadata, independent of feature stores and presentation. */
export type HarnessCatalogModel = {
  id: string;
  nativeId?: string;
  name: string;
  provider?: { id: string; name: string };
  contextWindow?: number;
  supportsImages?: boolean;
};

export type WorkBuddyAccount = {
  id: string;
  label: string;
  edition: "cn" | "global";
  readOnly: true;
  identity?: { email?: string; name?: string };
};

export type WorkBuddyCatalog = {
  accounts: WorkBuddyAccount[];
  models: HarnessCatalogModel[];
  errors: { edition: "cn" | "global"; message: string }[];
};
