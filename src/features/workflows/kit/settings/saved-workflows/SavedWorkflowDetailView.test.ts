// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../../../../../shared/lib/queryClient";
import { SavedWorkflowDetailView } from "./SavedWorkflowDetailView";
import type { SavedWorkflowMetaForm } from "./SavedWorkflowMetaForm";
import type { IOmniCodeAgentService } from "../../_shims/services";
import { savedWorkflowsQuery } from "../../hooks/useSavedWorkflows";

let form: ComponentProps<typeof SavedWorkflowMetaForm>;
vi.mock("./SavedWorkflowMetaForm", () => ({ SavedWorkflowMetaForm: (props: typeof form) => { form = props; return null; } }));
vi.mock("./SavedWorkflowDetailHeader", () => ({ SavedWorkflowDetailHeader: () => null }));
vi.mock("../SettingsHeaderBreadcrumb", () => ({ SettingsBreadcrumbReporter: () => null }));
vi.mock("../../components/ai-elements/code-block", () => ({ CodeBlock: () => null }));
vi.mock("../../i18n/IntlProvider", () => ({ useWorkflowIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }) }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("sonner", () => ({ toast: vi.fn() }));

let root: Root;
let description: string;
const get = vi.fn(), save = vi.fn(), onSaved = vi.fn();
const service = { getSavedWorkflow: get, updateSavedWorkflowMeta: save } as unknown as IOmniCodeAgentService;
const render = (name = "one", workspacePath = "/project") => act(async () => root.render(createElement(SavedWorkflowDetailView, {
  target: { workspacePath }, agentService: service, name, projectLabel: "Project", entry: undefined,
  runs: [], now: 1, busy: false, canOpenRun: false, onBack: vi.fn(), onRun: vi.fn(), onRevise: vi.fn(),
  onCopyPath: vi.fn(), onDelete: vi.fn(), onOpenRun: vi.fn(), onMetaSaved: onSaved, launchDialog: null,
})));
beforeEach(() => {
  queryClient.clear(); vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div")); description = "Original";
  get.mockImplementation(async ({ name }) => ({ ok: true, name, path: name, script: "", meta: { description } }));
  save.mockImplementation(async ({ meta }) => { description = meta.description; return { ok: true }; });
});
afterEach(() => { act(() => root.unmount()); queryClient.clear(); vi.unstubAllGlobals(); });

it("adopts refreshed metadata without edits, keeps edits during refresh, and resets them across identities", async () => {
  await render();
  expect(form.draft.description).toBe("Original");
  description = "Remote";
  await act(async () => { await queryClient.invalidateQueries(); });
  expect(form.draft.description).toBe("Remote");
  await act(async () => form.onDescriptionChange("Draft"));
  description = "New remote";
  await act(async () => { await queryClient.invalidateQueries(); });
  expect(form.draft.description).toBe("Draft");
  expect(form.dirty).toBe(true);
  await render("two");
  expect(form.draft.description).toBe("New remote");
  await act(async () => form.onDescriptionChange("Second draft"));
  description = "Other workspace";
  await render("two", "/other");
  expect(form.draft.description).toBe("Other workspace");
});

it("retains a failed save for retry and publishes successful metadata", async () => {
  await render();
  await act(async () => form.onDescriptionChange("Edited"));
  save.mockRejectedValueOnce(new Error("offline"));
  await act(async () => form.onSave());
  expect(form.draft.description).toBe("Edited");
  expect(form.dirty).toBe(true);
  expect(onSaved).not.toHaveBeenCalled();
  await act(async () => form.onSave());
  expect(form.draft.description).toBe("Edited");
  expect(form.dirty).toBe(false);
  expect(onSaved).toHaveBeenCalledOnce();
});

it("isolates services and project identities and keeps definitions when run history is unavailable", async () => {
  const list = vi.fn(async () => ({ workflows: [{ name: "review" }], invalid: [], dir: "/workflows" }));
  const runs = vi.fn(async () => { throw new Error("history unavailable"); });
  const first = { listSavedWorkflows: list, listSavedWorkflowRuns: runs } as unknown as IOmniCodeAgentService;
  const second = { ...first };
  const target = { workspacePath: "/project" };
  expect(savedWorkflowsQuery(target, first).queryKey).not.toEqual(savedWorkflowsQuery(target, second).queryKey);
  expect(savedWorkflowsQuery(target, first).queryKey).not.toEqual(savedWorkflowsQuery({ workspacePath: "/other" }, first).queryKey);
  expect(await queryClient.fetchQuery(savedWorkflowsQuery(target, first))).toMatchObject({ entries: [{ name: "review" }], runs: [] });
});
