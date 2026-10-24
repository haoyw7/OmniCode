import { useSyncExternalStore } from "react";
import type { AutomationDraft } from "../../contracts/automations";

import { AccessPicker } from "../../features/sessions/ui/AccessPicker";
import { ModelControlPills, ModelPicker } from "../../features/sessions/ui/ModelPicker";
import { SkillPromptField } from "../../features/skills/ui/SkillPromptField";
import { loadModelControls, subscribeModelControls } from "../../features/settings/model/settings";

export function AutomationRuntimeControls({ draft, onChange }: { draft: AutomationDraft; onChange: (draft: AutomationDraft) => void }) {
  const controlsBeside = useSyncExternalStore(subscribeModelControls, loadModelControls) === "beside";
  return <>
                <SkillPromptField
                  value={draft.prompt}
                  harness={draft.harness}
                  cwd={draft.cwd}
                  onChange={(prompt) => onChange({ ...draft, prompt })}
                />
                <div className="flex items-center gap-1 px-2 pb-2">
                  <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
                    <div className="flex shrink-0 items-center gap-1">
                      <ModelPicker
                        harness={draft.harness}
                        model={draft.model}
                        values={draft.modelSettings}
                        project={draft.cwd}
                        hideSettings={controlsBeside}
                        onChange={(harness, model) =>
                          onChange({ ...draft, harness, model })
                        }
                        onSettingsChange={(modelSettings) =>
                          onChange({ ...draft, modelSettings })
                        }
                      />
                      {controlsBeside ? (
                        <ModelControlPills
                          harness={draft.harness}
                          model={draft.model}
                          values={draft.modelSettings}
                          onSettingsChange={(modelSettings) =>
                            onChange({ ...draft, modelSettings })
                          }
                        />
                      ) : null}
                      {draft.harness !== "fx" ? (
                        <AccessPicker
                          value={draft.runtimeMode}
                          onChange={(runtimeMode) =>
                            onChange({ ...draft, runtimeMode })
                          }
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
  </>;
}
