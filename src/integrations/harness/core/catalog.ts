/** Provider-owned metadata, independent of feature stores and presentation. */
export type HarnessCatalogModel = {
  id: string;
  nativeId?: string;
  name: string;
  provider?: { id: string; name: string };
  contextWindow?: number;
  supportsImages?: boolean;
};
