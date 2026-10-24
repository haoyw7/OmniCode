import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InboxCredentials } from "./inbox-credentials";
import { HostJira, normalizeJiraSite } from "./jira";
import { jiraRichText, textToAdf } from "./jira-adf";

const cleanup: string[] = [];
afterEach(() => { for (const directory of cleanup.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const site = "https://acme.atlassian.net";
const config = { site, email: "ada@acme.com", token: "secret" };
function setup(connected = true) {
  const directory = mkdtempSync(join(tmpdir(), "omnicode-jira-")); cleanup.push(directory);
  const desktop = join(directory, "desktop"); mkdirSync(desktop);
  const credentials = new InboxCredentials(directory, () => desktop);
  if (connected) credentials.set("jira", config);
  const request = vi.fn<typeof fetch>();
  return { directory, desktop, credentials, request, service: new HostJira(credentials, request) };
}
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
const text = (value: string) => ({ type: "text", text: value });
const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] });

it("normalizes Jira sites and rejects credential-bearing or insecure URLs before HTTP", () => {
  for (const value of ["acme", "acme.atlassian.net", " https://Acme.atlassian.net/jira/software/projects "]) expect(normalizeJiraSite(value)).toBe(site);
  expect(normalizeJiraSite("jira.example.com:8443")).toBe("https://jira.example.com:8443");
  for (const value of ["http://acme.atlassian.net", "https://user@acme.atlassian.net", ""]) expect(() => normalizeJiraSite(value)).toThrow();
});

it("imports legacy config once and never reimports disconnected credentials", async () => {
  const { desktop, service, credentials } = setup(false);
  writeFileSync(join(desktop, "jira-config.json"), JSON.stringify(config));
  expect(await service.run("jira_status")).toEqual({ connected: true, site, email: config.email });
  expect(await service.run("jira_set_config", { token: "" })).toEqual({ connected: false, site: "", email: "" });
  expect(await new HostJira(credentials).run("jira_status")).toEqual({ connected: false, site: "", email: "" });
});

it("validates saved config with Basic auth and does not persist or echo rejected secrets", async () => {
  const { service, request, credentials } = setup();
  request.mockResolvedValueOnce(response({ accountId: "me" }));
  await service.run("jira_set_config", { ...config, token: "replacement" });
  expect(request.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Basic ${Buffer.from("ada@acme.com:replacement").toString("base64")}` });
  expect(request.mock.calls[0][1]?.redirect).toBe("error");
  request.mockResolvedValueOnce(new Response("echo rejected-secret", { status: 400 }));
  await expect(service.run("jira_set_config", { ...config, token: "rejected-secret" })).rejects.toThrow("Jira request failed (400)");
  expect(credentials.get("jira", "jira-config.json")).toMatchObject({ token: "replacement" });
});

it("fetches every project page and rejects nonadvancing pages instead of excluding visible projects", async () => {
  const { service, request } = setup();
  request.mockResolvedValueOnce(response({ startAt: 0, isLast: false, values: [{ id: "1", key: "ENG", name: "Engineering" }] }))
    .mockResolvedValueOnce(response({ startAt: 1, isLast: true, values: [{ id: "2", key: "OPS", name: "Operations" }] }));
  expect(await service.run("jira_list_projects")).toEqual([{ id: "1", key: "ENG", name: "Engineering" }, { id: "2", key: "OPS", name: "Operations" }]);
  expect(request.mock.calls.map(call => String(call[0]).split("startAt=")[1])).toEqual(["0", "1"]);
  request.mockResolvedValueOnce(response({ isLast: false, values: [] }));
  await expect(service.run("jira_list_projects")).rejects.toThrow("pagination did not advance");
});

it("preserves JQL bounds, filtering, DTOs and WebKit-compatible timestamps", async () => {
  const { service, request } = setup();
  request.mockResolvedValue(response({ issues: [{ id: "10042", key: "ENG-42", fields: {
    summary: "Fix auth", updated: "2026-08-27T10:00:00.000+0000", status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    labels: ["bug", "backend"], assignee: { displayName: "Maya", avatarUrls: { "48x48": "avatar" } }, project: { id: "10000", key: "ENG", name: "Engineering" },
  } }, { id: "10043" }] }));
  expect(await service.run("jira_list_issues", { assignedToMe: true, state: "open", projectIds: [" 10000 ", "10001", "x) OR (1"] })).toEqual([{
    provider: "jira", kind: "jira", id: "10042", identifier: "ENG-42", number: 42, url: `${site}/browse/ENG-42`, title: "Fix auth", state: "In Progress", stateType: "indeterminate",
    updatedAt: "2026-08-27T10:00:00.000+00:00", labels: [{ name: "bug", color: "" }, { name: "backend", color: "" }], assignees: [{ login: "Maya", avatarUrl: "avatar" }],
    draft: false, repo: "ENG", teamId: "10000", teamName: "Engineering", projectPath: "",
  }]);
  expect(JSON.parse(String(request.mock.calls[0][1]?.body)).jql).toBe("assignee = currentUser() AND project in (10000, 10001) AND statusCategory != Done ORDER BY updated DESC");
  request.mockResolvedValueOnce(response({ issues: [] }));
  await service.run("jira_list_issues", { state: "all" });
  expect(JSON.parse(String(request.mock.calls[1][1]?.body)).jql).toBe("updated >= -365d ORDER BY updated DESC");
});

it("preserves rich description authors, chronological comments and posting ADF", async () => {
  const { service, request } = setup();
  request.mockResolvedValueOnce(response({ fields: { description: { type: "doc", content: [paragraph("Steps")] }, reporter: { displayName: "Ada" }, creator: { displayName: "Lin" } } }));
  expect(await service.run("jira_issue_details", { key: "ENG-42" })).toEqual({ body: "Steps", author: "Ada", authorAvatarUrl: "" });
  request.mockResolvedValueOnce(response({ total: 3, comments: [{ id: "2", body: "Plain reply", created: "2026-08-31T11:00:00.000+0000" },
    { id: "1", body: { type: "doc", content: [paragraph("Root")] }, created: "2026-08-31T10:00:00.000+0000" }] }));
  expect(await service.run("jira_issue_thread", { key: "ENG-42" })).toMatchObject({ truncated: true, comments: [{ id: "1", body: "Root", url: `${site}/browse/ENG-42?focusedCommentId=1` }, { id: "2", body: "Plain reply" }] });
  request.mockResolvedValueOnce(response({ id: "3" }));
  expect(await service.run("jira_issue_comment", { key: "ENG-42", body: "First\nsecond\n\nNext" })).toBe(`${site}/browse/ENG-42?focusedCommentId=3`);
  expect(JSON.parse(String(request.mock.calls[2][1]?.body)).body).toEqual(textToAdf("First\nsecond\n\nNext"));
});

it("keeps the previous ADF Markdown output for nested lists, marks, code, quotes and tables", () => {
  const rich = { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [text("Repro")] },
    { type: "paragraph", content: [text("Ping "), { type: "mention", attrs: { text: "@Maya" } }, text(" see "),
      { ...text("docs"), marks: [{ type: "link", attrs: { href: "https://example.com" } }] }, { type: "hardBreak" },
      { ...text("now"), marks: [{ type: "strong" }] }, text(" run "), { ...text("make"), marks: [{ type: "code" }, { type: "strong" }] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [paragraph("one"), { type: "orderedList", content: [{ type: "listItem", content: [paragraph("nested")] }] }] }, { type: "listItem", content: [paragraph("two")] }] },
    { type: "codeBlock", attrs: { language: "sh" }, content: [text("npm test")] }, { type: "blockquote", content: [paragraph("quoted")] },
    { type: "mediaSingle", content: [{ type: "media", attrs: { id: "x" } }] },
  ] };
  expect(jiraRichText(rich)).toBe("## Repro\n\nPing @Maya see [docs](https://example.com)\n**now** run `make`\n\n- one\n  1. nested\n- two\n\n```sh\nnpm test\n```\n\n> quoted");
  const cell = (value: string) => ({ type: "tableCell", content: [paragraph(value)] });
  expect(jiraRichText({ type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [cell("a"), cell("b")] }, { type: "tableRow", content: [cell("1"), cell("2|3")] }] }] }))
    .toBe("| a | b |\n| --- | --- |\n| 1 | 2\\|3 | ".trim());
});
