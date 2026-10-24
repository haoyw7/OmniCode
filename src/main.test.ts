// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  render: vi.fn(), sharedHost: vi.fn(), preferences: vi.fn(), workspaces: vi.fn(),
  connections: vi.fn(), accounts: vi.fn(), restore: vi.fn(), stopPreferences: vi.fn(),
}));
vi.mock("react-dom/client", () => ({ default: { createRoot: () => ({ render: mocks.render }) } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ listen: vi.fn() }) }));
vi.mock("./features/settings/model/appearance", () => ({ activateWindowAppearance: vi.fn(), initAppearance: vi.fn() }));
vi.mock("./features/settings/model/sounds", () => ({ initSounds: vi.fn() }));
vi.mock("./features/settings/model/typography", () => ({ initTypography: vi.fn() }));
vi.mock("./features/settings/model/sharedPreferenceEffects", () => ({ installSharedPreferenceEffects: vi.fn() }));
vi.mock("./features/settings/model/hostPreferences", () => ({ initializeHostPreferences: mocks.preferences, stopDesktopHostPreferences: mocks.stopPreferences }));
vi.mock("./features/settings/ui/SharedStateStatus", () => ({ SharedStateStatus: () => null }));
vi.mock("./features/connections/model/sharedHost", () => ({ initializeSharedHost: mocks.sharedHost }));
vi.mock("./features/connections/model/hostWorkspace", () => ({ initializeHostWorkspaces: mocks.workspaces }));
vi.mock("./features/connections/model/hostConnections", () => ({ initializeHostConnections: mocks.connections }));
vi.mock("./features/connections/model/remoteCommands", () => ({}));
vi.mock("./features/providers/model/providerBinaryPaths", () => ({ initializeProviderBinaryPaths: vi.fn(async () => undefined) }));
vi.mock("./features/providers/model/providerAccountCredentials", () => ({ initProviderAccountPublishing: mocks.accounts }));
vi.mock("./platform/tauri/fs", () => ({ homeDir: vi.fn(async () => "/home/me") }));
vi.mock("platform/tauri/languageSync", () => ({ initUiLanguage: vi.fn() }));
vi.mock("./shared/ui/icons", () => ({ configureDefaultIconArtwork: vi.fn() }));
vi.mock("./app/desktopIconArtwork", () => ({ desktopIconArtwork: {} }));
vi.mock("./app/model/appLifecycle", () => ({
  abortQuit: vi.fn(), askQuitConfirmation: vi.fn(), commitQuit: vi.fn(),
  loadBootWorkspace: mocks.restore, reportQuitPoll: vi.fn(),
}));
vi.mock("./app/model/updateNotice", () => ({ consumeInstalledUpdate: vi.fn() }));
vi.mock("./app/shell/WindowResizeHandles", () => ({ WindowResizeHandles: () => null }));
vi.mock("./app/shell/WindowResizeObserver", () => ({ WindowResizeObserver: () => null }));
vi.mock("./app/shell/BootRecovery", () => ({ BootRecovery: function Recovery() { return null; } }));
vi.mock("./app/App", () => ({ default: function Workspace() { return null; } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const initialize of [mocks.sharedHost, mocks.preferences, mocks.workspaces, mocks.connections, mocks.accounts])
    initialize.mockResolvedValue(undefined);
  mocks.restore.mockResolvedValue({ windowTransfer: null, resumed: null, history: [], historyCwd: null });
  document.body.innerHTML = '<div id="root"></div>';
});

it("waits for Host preparation before restoring the desktop workspace", async () => {
  let ready!: () => void;
  mocks.sharedHost.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
  await import("./main");
  await vi.waitFor(() => expect(mocks.sharedHost).toHaveBeenCalledOnce());
  expect(mocks.preferences).not.toHaveBeenCalled();
  expect(mocks.workspaces).not.toHaveBeenCalled();
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(mocks.render).not.toHaveBeenCalled();
  ready();
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
  expect(mocks.restore).toHaveBeenCalledOnce();
  expect(mocks.render.mock.calls[0][0].props.children.props.children.type.name).toBe("Workspace");
});

it("keeps a failed Host startup behind recovery and restores only after a successful retry", async () => {
  const error = new Error("Could not start shared conversation service: connection refused");
  mocks.sharedHost.mockRejectedValueOnce(error);
  await import("./main");
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(mocks.preferences).not.toHaveBeenCalled();
  const recovery = mocks.render.mock.calls[0][0].props.children;
  expect(recovery.type.name).toBe("Recovery");
  expect(recovery.props.error).toBe(error);
  recovery.props.onRetry();
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
  expect(mocks.sharedHost).toHaveBeenCalledTimes(2);
  expect(mocks.restore).toHaveBeenCalledOnce();
  expect(mocks.render.mock.calls[1][0].props.children.props.children.type.name).toBe("Workspace");
});
