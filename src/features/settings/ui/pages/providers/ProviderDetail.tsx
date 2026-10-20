import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { immediateTransition, panelTransition } from "../../../../../shared/motion/tokens";
import { useMotionPreference } from "../../../../../shared/motion/useMotionPreference";
import { SearchableSelect } from "../../../../../shared/ui/SearchableSelect";
import { isHarnessAvailable } from "../../../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../../../integrations/harness/core/registry";
import type { HarnessVersionInfo } from "../../../../providers/model/harnessUpdates";
import { hasFreshCatalog, LAST_SELECTED_MODEL, modelsFor, resolveModel } from "../../../../sessions/model/models";
import { projectName } from "../../../../../shared/lib/paths";
import { HARNESS_TITLE, type HarnessId } from "../../../../sessions/model/session";
import type { ProviderScopeState } from "../../../model/providerDefaults";
import { loadClaudeHooks, saveClaudeHooks } from "../../../model/settings";
import { usePreferenceState } from "../../../model/usePreferenceState";
import { Row, Toggle } from "../../settingsLayout";
import { ProviderAccounts } from "./ProviderAccounts";
import { ProviderBinaryPath } from "./ProviderBinaryPath";
import { ProviderDetailHeader } from "./ProviderDetailHeader";
import { hasProviderAccounts, type ProviderAccountsController } from "./useProviderAccounts";

export const PROVIDER_DETAIL_ID = "provider-detail";

/** Everything about one provider: its CLI, models, visibility and accounts. */
export function ProviderDetail({
  harness,
  project,
  state,
  version,
  accounts,
  onUpdated,
  onDefault,
  onModelChange,
  onPickerVisible,
}: {
  harness: HarnessId;
  /** The project whose overrides are shown, or null for the global defaults. */
  project: string | null;
  state: ProviderScopeState;
  version?: HarnessVersionInfo;
  accounts: ProviderAccountsController;
  onUpdated: () => void;
  onDefault: (harness: HarnessId, model: string) => void;
  onModelChange: (harness: HarnessId, model: string) => void;
  onPickerVisible: (harness: HarnessId, visible: boolean) => void;
}) {
  const { t: uiT } = useTranslation();
  const reduced = useMotionPreference();
  const title = HARNESS_TITLE[harness];
  const models = modelsFor(harness);
  const available = isHarnessAvailable(harness);
  const followLastSelected = state.selectedModel === LAST_SELECTED_MODEL;
  const current = models.length > 0 ? resolveModel(harness, state.selectedModel) : null;
  const [binaryRevision, setBinaryRevision] = useState(0);

  useEffect(() => {
    if (!available || hasFreshCatalog(harness)) return;
    void refreshHarnessCatalogs([harness]);
  }, [available, harness]);

  const scopeHint = project
    ? uiT("Applies to {value0} only.", { value0: projectName(project) })
    : null;

  return (
    <motion.div
      key={harness}
      id={PROVIDER_DETAIL_ID}
      data-ui="provider-detail"
      role="region"
      aria-label={uiT("{value0} settings", { value0: title })}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? immediateTransition : panelTransition}
    >
      <ProviderDetailHeader
        harness={harness}
        available={available}
        modelCount={models.length}
        version={version}
        isDefault={state.isDefault}
        canUseDefault={Boolean(current)}
        onUseDefault={() => current && onDefault(harness, followLastSelected ? LAST_SELECTED_MODEL : current.id)}
        onUpdated={onUpdated}
        onBinaryChanged={() => setBinaryRevision((value) => value + 1)}
      />
      {current ? (
        <Row
          label={uiT("Default model")}
          description={
            scopeHint ??
            uiT("New {value0} conversations start with this model.", { value0: title })
          }
        >
          <SearchableSelect searchable={false} align="end" width={280} maxHeight={320} commitOnTab checkPosition="end" className="max-w-52"
            label={uiT("{value0} model", { value0: String(title) })}
            value={followLastSelected ? LAST_SELECTED_MODEL : current.id}
            onChange={(next) => onModelChange(harness, next)}
            onOpen={() => {
              // Fallbacks keep models non-empty and routine refreshes skip live
              // catalogs. Explicitly opening the picker must refresh either one.
              if (available) {
                void refreshHarnessCatalogs([harness], { force: true });
              }
            }}
            options={[
              { value: LAST_SELECTED_MODEL, label: uiT("Last selected model") },
              ...models.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </Row>
      ) : null}
      {available ? (
        <Row
          label={uiT("Show in picker")}
          description={
            state.pickerLocked
              ? uiT("Hidden globally")
              : scopeHint ?? uiT("List this provider in the model picker for new conversations.")
          }
        >
          <Toggle
            label={uiT("Show {value0} in the model picker", { value0: String(title) })}
            on={state.inPicker}
            onChange={(visible) => onPickerVisible(harness, visible)}
            disabled={state.pickerLocked}
          />
        </Row>
      ) : null}
      <ProviderBinaryPath key={binaryRevision} provider={harness} available={available} />
      {hasProviderAccounts(harness) ? (
        <ProviderAccounts provider={harness} controller={accounts} />
      ) : null}
      {harness === "claude" ? <ClaudeHooksRow /> : null}
    </motion.div>
  );
}

function ClaudeHooksRow() {
  const { t: uiT } = useTranslation();
  const [claudeHooks, setClaudeHooks] = usePreferenceState(loadClaudeHooks);
  return (
    <Row
      id="claude-hooks"
      label={uiT("Claude Code hooks")}
      description={uiT(
        "Run the hooks configured in your settings.json files — PreToolUse command rewrites, blocks, notifications, and the rest — just as the Claude Code CLI would. Turn this off if a hook is misbehaving and you need the session back. Takes effect on the next turn.",
      )}
    >
      <Toggle
        label={uiT("Claude Code hooks")}
        on={claudeHooks}
        onChange={(next) => {
          saveClaudeHooks(next);
          setClaudeHooks(next);
        }}
      />
    </Row>
  );
}
