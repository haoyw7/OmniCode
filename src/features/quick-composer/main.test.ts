// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  render: vi.fn(), sharedHost: vi.fn(), preferences: vi.fn(), accounts: vi.fn(),
  setTheme: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("react-dom/client", () => ({ default: { createRoot: () => ({ render: mocks.render }) } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTheme: mocks.setTheme }) }));
vi.mock("../../platform/tauri/platform", () => ({ IS_MAC: true }));
vi.mock("../settings/model/appearance", () => ({
  applyAccentColor: vi.fn(), applyThemeDarkLightness: vi.fn(), applyThemePreference: () => "dark", applyThemeTint: vi.fn(),
  loadAccentColor: vi.fn(), loadThemeDarkLightness: vi.fn(), loadThemeHue: vi.fn(), loadThemePreference: vi.fn(), loadThemeSaturation: vi.fn(),
}));
vi.mock("../settings/model/typography", () => ({ initTypography: vi.fn() }));
vi.mock("../settings/model/sounds", () => ({ initSounds: vi.fn() }));
vi.mock("../../shared/i18n/languageSync", () => ({ initUiLanguage: vi.fn() }));
vi.mock("../../shared/i18n/language", () => ({ refreshUiLanguage: vi.fn(), translate: (value: string) => value }));
vi.mock("../settings/model/sharedPreferences", () => ({ subscribeSharedPreferences: vi.fn() }));
vi.mock("../connections/model/sharedHost", () => ({ initializeSharedHost: mocks.sharedHost }));
vi.mock("../settings/model/hostPreferences", () => ({ initializeHostPreferences: mocks.preferences }));
vi.mock("../providers/model/providerAccountCredentials", () => ({ initProviderAccountPublishing: mocks.accounts }));
vi.mock("./ui/QuickComposer", () => ({ QuickComposer: function Composer() { return null; } }));
vi.mock("./ui/QuickGitPopup", () => ({ QuickGitPopup: function Popup() { return null; } }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.sharedHost.mockResolvedValue(undefined);
  mocks.preferences.mockResolvedValue(undefined);
  mocks.accounts.mockResolvedValue(undefined);
  document.body.innerHTML = '<div id="root"></div>';
});
it("waits for verified Host preferences and accounts before enabling quick launch controls", async () => {
  let ready!: () => void;
  mocks.preferences.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
  await import("./main");
  await vi.waitFor(() => expect(mocks.preferences).toHaveBeenCalledOnce());
  expect(mocks.render).not.toHaveBeenCalled();
  expect(mocks.accounts).not.toHaveBeenCalled();
  ready();
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
  expect(mocks.accounts).toHaveBeenCalledOnce();
  expect(mocks.render.mock.calls[0][0].props.children.props.children.type.name).toBe("Composer");
});
it("shows a retry when Host bootstrap fails without enabling controls using legacy defaults", async () => {
  mocks.sharedHost.mockRejectedValue(new Error("Host upgrade required"));
  await import("./main");
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
  expect(mocks.preferences).not.toHaveBeenCalled();
  expect(mocks.accounts).not.toHaveBeenCalled();
  const errorView = mocks.render.mock.calls[0][0];
  expect(errorView.type).toBe("div");
  expect(errorView.props.children[1].props.children).toContain("Host upgrade required");
  expect(errorView.props.children[2].props.children).toBe("Retry");
});
