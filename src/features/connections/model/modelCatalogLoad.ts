import type { HostModelCatalog, RemoteProvider } from "./protocol";
import { translate } from "../../../shared/i18n/language";

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

  constructor(read: ModelCatalogReader, publish?: (catalog: HostModelCatalog) => void, previous?: HostModelCatalog) {
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
        // The first response defines the current providers. Keep cached rows
        // only for providers still loading or failing; a ready empty list or
        // a removed provider must still replace its old rows.
        if (providers === undefined) {
          value = next;
          if (previous) {
            const models = { ...next.models };
            const unresolved = new Set([
              ...(next.pending ?? []),
              ...Object.keys(next.errors) as RemoteProvider[],
            ]);
            for (const provider of unresolved) {
              if (models[provider] === undefined && previous.models[provider] !== undefined)
                models[provider] = previous.models[provider];
            }
            value = { ...next, models };
          }
        }
        if (!this.latest || Object.keys(next.models).length || Object.keys(next.errors).length ||
            next.pending?.join(",") !== this.latest.pending?.join(",")) {
          this.latest = value;
          publish?.(value);
          for (const listener of this.listeners) listener(value);
        }
        providers = next.pending;
        if (!providers?.length) return value;
        // Bound retries even if a broken provider never completes discovery.
        if (Date.now() - started >= 90_000) throw new Error(translate("Model discovery timed out"));
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
