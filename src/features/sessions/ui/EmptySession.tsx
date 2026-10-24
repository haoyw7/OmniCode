import { type ReactNode, useSyncExternalStore } from "react";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { basename } from "../../../platform/tauri/fs";
import { projectKey } from "../../../shared/lib/paths";
import { looksLikeProject } from "../../projects/model/recents";
import { isChatFolder } from "../../../domain/chatFolderPath";
import { loadTabGroupLabels, resolveTabGroupLabel, subscribeTabGroupLabels } from "../../workspace/model/tabGroups";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";

type Props = {
  cwd: string;
  composer?: ReactNode;
};

export function EmptySession({ cwd, composer }: Props) {
  const { t } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const getProjectLabel = () =>
    looksLikeProject(cwd) && !isChatFolder(cwd)
      ? resolveTabGroupLabel(
          projectKey(cwd),
          loadTabGroupLabels(),
          basename(cwd),
        )
      : null;
  const project = useSyncExternalStore(
    subscribeTabGroupLabels,
    getProjectLabel,
    getProjectLabel,
  );
  const title = project
    ? t("What should we work on in {project}?", { project })
    : t("What should we work on?");

  return (
    <div
      ref={lockOverscroll}
      className="desktop-empty-session relative flex h-full min-h-0 overflow-y-auto overscroll-none"
    >
      {composer ? (
        // Desktop geometry shares the docked composer width, so sending the
        // first message does not change the input card’s horizontal position.
        <div className="desktop-empty-content pointer-events-none relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-1.5 py-12">
          <div className="desktop-empty-greeting pointer-events-auto mb-4 px-2.5">
            <h1
              data-empty-title
              className="desktop-page-heading truncate text-lg text-content"
              title={project ? cwd : undefined}
            >
              {title}
            </h1>
          </div>

          <div className="pointer-events-auto w-full">{composer}</div>
        </div>
      ) : null}
    </div>
  );
}
