import { useEffect, useState } from "react";
import { parseAsJson, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { z } from "zod";
import { loadInboxFilters, loadInboxSource, saveInboxFilters, saveInboxSource, type InboxFilters } from "./inboxFilters";
import { loadHiddenLinearTeamIds, saveHiddenLinearTeamIds } from "./linear";
import { loadHiddenJiraProjectIds, saveHiddenJiraProjectIds } from "./jira";

const filtersSchema = z.object({
  assignedToMe: z.boolean(),
  hiddenProjects: z.array(z.string().min(1)),
  hiddenLinearProjects: z.array(z.string().min(1)),
  hiddenKinds: z.array(z.enum(["issue", "pr"])),
  time: z.enum(["all", "today", "7d", "30d"]),
  status: z.object({ open: z.boolean(), draft: z.boolean(), closed: z.boolean(), merged: z.boolean() }),
});
const filtersParser = parseAsJson<InboxFilters>(filtersSchema);
const sourceParser = parseAsStringLiteral(["github", "linear", "jira", "gitlab", "azuredevops"]);
const idsParser = parseAsJson(z.array(z.string().min(1)));

export function useInboxQueryState() {
  const [defaults] = useState(() => ({
    filters: loadInboxFilters(), source: loadInboxSource(),
    linearTeams: loadHiddenLinearTeamIds(), jiraProjects: loadHiddenJiraProjectIds(),
  }));
  const [filters, setFilters] = useQueryState("inboxFilters", filtersParser.withDefault(defaults.filters).withOptions({ clearOnDefault: false }));
  const [source, setSource] = useQueryState("inboxSource", sourceParser.withDefault(defaults.source).withOptions({ clearOnDefault: false }));
  const [searchInput, setSearchInput] = useQueryState("inboxSearch", parseAsString.withDefault(""));
  const [linearHiddenTeamIds, setLinearHiddenTeamIds] = useQueryState("inboxHiddenTeams", idsParser.withDefault(defaults.linearTeams).withOptions({ clearOnDefault: false }));
  const [jiraHiddenProjectIds, setJiraHiddenProjectIds] = useQueryState("inboxHiddenJiraProjects", idsParser.withDefault(defaults.jiraProjects).withOptions({ clearOnDefault: false }));
  // URL navigation and edits both become the next launch's device preference.
  useEffect(() => saveInboxFilters(filters), [filters]);
  useEffect(() => saveInboxSource(source), [source]);
  useEffect(() => {
    if (JSON.stringify(linearHiddenTeamIds) !== JSON.stringify(loadHiddenLinearTeamIds())) saveHiddenLinearTeamIds(linearHiddenTeamIds);
  }, [linearHiddenTeamIds]);
  useEffect(() => {
    if (JSON.stringify(jiraHiddenProjectIds) !== JSON.stringify(loadHiddenJiraProjectIds())) saveHiddenJiraProjectIds(jiraHiddenProjectIds);
  }, [jiraHiddenProjectIds]);
  return { filters, setFilters, source, setSource, searchInput, setSearchInput, linearHiddenTeamIds, setLinearHiddenTeamIds, jiraHiddenProjectIds, setJiraHiddenProjectIds };
}
