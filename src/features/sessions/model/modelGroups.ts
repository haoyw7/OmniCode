import type { AgentModel } from "./models";
import { HARNESS_TITLE } from "./session";

type ModelGroup = {
  id: string;
  name: string;
  showLabel: boolean;
  models: Array<{ item: AgentModel; index: number }>;
};

/** Keep providers together in catalog order, with indices in display order. */
export function modelGroups(models: readonly AgentModel[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const item of models) {
    const id = item.provider
      ? `provider:${item.provider.id}`
      : `harness:${item.harness}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        name: item.provider?.name ?? HARNESS_TITLE[item.harness],
        // A provider remains useful context even when search leaves one group.
        showLabel: item.provider != null,
        models: [],
      };
      groups.set(id, group);
    }
    group.models.push({ item, index: 0 });
  }
  let index = 0;
  for (const group of groups.values()) {
    group.showLabel ||= groups.size > 1;
    for (const entry of group.models) entry.index = index++;
  }
  return [...groups.values()];
}
