import type { BotFilePaneProps } from "../../features/bots/ui/BotFilePanel";
import { FilePane } from "./FilePane";

const NO_SESSIONS: never[] = [];
const noop = () => {};

/** Compose the workspace editor into the assistant's attachment card. */
export function BotFilePane(props: BotFilePaneProps) {
  return <FilePane {...props} sessions={NO_SESSIONS} onFocus={noop} onUpdatePlan={noop} onBuildPlan={noop} />;
}
