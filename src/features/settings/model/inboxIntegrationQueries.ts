import { queryOptions } from "@tanstack/react-query";
import { githubStatus } from "../../inbox/model/githubTasks";
import { jiraConnected } from "../../inbox/model/jira";
import { gitlabConnected } from "../../inbox/model/gitlab";
import { azureDevOpsConnected } from "../../inbox/model/azureDevOps";
import { linearConnected } from "../../inbox/model/linear";

export const githubIntegrationQuery = () => queryOptions({ queryKey: ["inbox", "integration", "github"], queryFn: githubStatus });
export const jiraIntegrationQuery = () => queryOptions({ queryKey: ["inbox", "integration", "jira"], queryFn: jiraConnected });
export const gitlabIntegrationQuery = () => queryOptions({ queryKey: ["inbox", "integration", "gitlab"], queryFn: gitlabConnected });
export const azureDevOpsIntegrationQuery = () => queryOptions({ queryKey: ["inbox", "integration", "azuredevops"], queryFn: azureDevOpsConnected });
export const linearIntegrationQuery = () => queryOptions({ queryKey: ["inbox", "integration", "linear"], queryFn: linearConnected });
