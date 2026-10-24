import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { useContext, type ReactNode } from "react";
import { JiraSettings } from "../JiraSettings";
import { InboxProviderMark } from "../../../../shared/ui/branding/InboxProviderMark";
import { Group, RevealedSetting, settingDomId } from "../settingsLayout";
import { AzureDevOpsSettings, GithubSettings, GitlabSettings, LinearSettings } from "./InboxIntegrationSettings";



export function InboxPage({ renderNotifications }: { renderNotifications: (highlighted: boolean) => ReactNode }) {
  const { t: uiT } = useTranslation();
  const revealed = useContext(RevealedSetting);
  return (
    <>
      <div
        id={settingDomId("project-notifications")}
        data-setting-id="project-notifications"
      >
        {renderNotifications(revealed === "project-notifications")}
      </div>
      <Group
        id="github"
        title={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="github" className="size-4 shrink-0" />
            GitHub
          </span>
        }
        description={uiT(
          "Pull requests, reviews, and issues, read through the GitHub CLI.",
        )}
      >
        <GithubSettings />
      </Group>

      <Group
        id="gitlab"
        title={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="gitlab" className="size-4 shrink-0" />
            GitLab
          </span>
        }
        description={uiT(
          "Merge requests from GitLab.com or a self-managed instance.",
        )}
      >
        <GitlabSettings />
      </Group>

      <Group
        id="azuredevops"
        title={
          <span className="flex items-center gap-2">
            <InboxProviderMark
              provider="azuredevops"
              className="size-4 shrink-0"
            />
            ADO
          </span>
        }
        description={uiT(
          "Pull requests and Boards work items from your ADO organization.",
        )}
      >
        <AzureDevOpsSettings />
      </Group>

      <Group
        id="jira"
        title={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="jira" className="size-4 shrink-0" />
            Jira
          </span>
        }
        description={uiT("Jira Cloud issues from the projects you pick.")}
      >
        <JiraSettings />
      </Group>

      <Group
        id="linear"
        title={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="linear" className="size-4 shrink-0" />
            Linear
          </span>
        }
        description={uiT("Issues assigned to you, from the teams you pick.")}
      >
        <LinearSettings />
      </Group>
    </>
  );
}
