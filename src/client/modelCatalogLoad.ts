import type { HostModelCatalog } from "../contracts/protocol";
import type { RemoteProvider } from "../contracts/provider";

export type ModelCatalogReader = (params: {
  progressive: true;
  providers?: RemoteProvider[];
}) => Promise<HostModelCatalog>;

/** One shared read with intermediate snapshots for late-joining views. Older
 * Hosts omit `pending` and finish after the first response. */
export class ModelCatalogLoad {
  readonly promise: Promise<HostModelCatalog>;
  private latest?: HostModelCatalog;
  private listeners = new Set<(catalog: HostModelCatalog) => void>();

  constructor(read: ModelCatalogReader, publish?: (catalog: HostModelCatalog) => void,
    timeoutMessage = () => "Model discovery timed out") {
    this.promise = Promise.resolve().then(async () => {
      const started = Date.now();
      let providers: RemoteProvider[] | undefined;
      let value: HostModelCatalog = { models: {}, errors: {} };
      do {
        const next = await read({ progressive: true, ...(providers ? { providers } : {}) });
        value = {
          ...next,
          models: { ...value.models, ...next.models },
          errors: { ...value.errors, ...next.errors },
        };
        // Retain the original result object for complete, single-response reads.
        if (providers === undefined) value = next;
        if (!this.latest || Object.keys(next.models).length || Object.keys(next.errors).length ||
            next.pending?.join(",") !== this.latest.pending?.join(",")) {
          this.latest = value;
          publish?.(value);
          for (const listener of this.listeners) listener(value);
        }
        providers = next.pending;
        if (!providers?.length) return value;
        // Bound retries even if a broken provider never completes discovery.
        if (Date.now() - started >= 90_000) throw new Error(timeoutMessage());
        await new Promise(resolve => setTimeout(resolve, 500));
      } while (true);
    });
  }

  observe(listener?: (catalog: HostModelCatalog) => void): Promise<HostModelCatalog> {
    if (!listener) return this.promise;
    this.listeners.add(listener);
    if (this.latest) listener(this.latest);
    return this.promise.finally(() => this.listeners.delete(listener));
  }
}
