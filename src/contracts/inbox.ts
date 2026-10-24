/** Source context for a Host-owned inbox discussion. */
export type InboxAskContext = {
  key: string;
  title: string;
  url: string;
  provider: "github" | "linear" | "jira" | "gitlab" | "azuredevops";
  description?: string;
};

/** Lists identify discussions without transferring the source body. */
export type InboxAskSummary = Omit<InboxAskContext, "description">;
