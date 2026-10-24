import { leadingModeCommand, MODE_COMMAND_STYLES, ModeCommandText } from "../../features/sessions/ui/modeCommands";
import type { QuickComposerPresentation } from "../../features/quick-composer/ui/QuickComposer";

export const quickComposerPresentation: QuickComposerPresentation = {
  mode(text, names, indent) {
    const mode = leadingModeCommand(text, names);
    return mode ? { name: mode.name, end: mode.end, node: <ModeCommandText text={text} mode={mode} indent={indent} iconClassName="size-4" /> } : null;
  },
  commandLabel(name) {
    const style = MODE_COMMAND_STYLES[name];
    return <span className="flex items-center gap-1.5">
      {style ? <style.Icon className={`size-3.5 shrink-0 ${style.menu?.iconClassName ?? ""}`} /> : null}
      {name.charAt(0).toUpperCase() + name.slice(1)}
    </span>;
  },
};
