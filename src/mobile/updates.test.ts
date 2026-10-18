import { startMotionClock, stopMotionClock, advanceMotionTimers } from "./motionTestClock";
// @vitest-environment happy-dom
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => vi.stubEnv("OMNICODE_UPDATE_CHANNEL", "lan"));
afterAll(() => vi.unstubAllEnvs());

const native = vi.hoisted(() => ({
  platform: "android",
  http: vi.fn(),
  info: vi.fn(),
  permission: vi.fn(),
  install: vi.fn(),
  listener: vi.fn(),
  foreground: vi.fn(),
  remove: vi.fn(),
  language: "en",
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => native.platform,
    isNativePlatform: () => native.platform !== "web",
  },
  CapacitorHttp: { get: native.http },
  registerPlugin: () => ({
    installPermission: native.permission,
    downloadAndInstall: native.install,
    addListener: native.listener,
  }),
}));
vi.mock("@capacitor/app", () => ({
  App: { getInfo: native.info, addListener: native.foreground },
}));
vi.mock("../shared/i18n/useTranslation", () => ({
  useTranslation: () => ({
    language: native.language,
    t: (text: string, values?: Record<string, unknown>) =>
      text.replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key])),
  }),
}));
vi.mock("../features/sessions/ui/AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", null, text),
}));
import {
  checkMobileUpdate,
  parseMobileUpdate,
  hasMobileUpdate,
  updateBaseUrl,
  updateBaseUrls,
  updateDownloadUrl,
} from "./updates";
import { MobileAppUpdates, useMobileAppUpdates } from "./MobileAppUpdates";

const manifest = {
  packageId: "com.omnicode.mobile",
  versionName: "0.7.0",
  versionCode: 5,
  downloadPath: "/apk/omnicode-5.apk",
  sha256: "a".repeat(64),
  size: 1234,
  publishedAt: "2026-10-03T12:00:00Z",
};
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
beforeEach(() => {
  startMotionClock();
  vi.useFakeTimers();
  vi.clearAllMocks();
  native.platform = "android";
  native.language = "en";
  native.info.mockResolvedValue({ version: "0.7.0", build: "4" });
  native.http.mockResolvedValue({ status: 200, data: manifest });
  native.foreground.mockResolvedValue({ remove: native.remove });
  native.listener.mockResolvedValue({ remove: native.remove });
  native.permission.mockResolvedValue({ allowed: true });
  native.install.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllTimers();
  stopMotionClock();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const advance = advanceMotionTimers;
async function mount(settle = true) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function TestApp() {
    const state = useMobileAppUpdates();
    return createElement(MobileAppUpdates, { state });
  }
  await act(async () => root!.render(createElement(TestApp)));
  if (settle) await advance(2_000);
  return container;
}
// Match the label people see; a content swap keeps an aria-hidden exiting copy.
const label = (item: Element) => {
  const copy = item.cloneNode(true) as Element;
  copy
    .querySelectorAll("[aria-hidden='true']")
    .forEach((node) => node.remove());
  return copy.textContent;
};
const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find(
    (item) => label(item) === text,
  )!;

describe("mobile app updates", () => {
  it("accepts optional bilingual notes and selects the current language", async () => {
    const notes =
      "<!-- release-notes:en -->\nEnglish preview\n<!-- /release-notes -->\n<!-- release-notes:zh-CN -->\n中文预览\n<!-- /release-notes -->";
    expect(parseMobileUpdate({ ...manifest, notes }).notes).toBe(notes);
    expect(() => parseMobileUpdate({ ...manifest, notes: {} })).toThrow(
      "Invalid update information",
    );
    native.language = "zh-CN";
    native.http.mockResolvedValue({
      status: 200,
      data: { ...manifest, notes },
    });
    const container = await mount();
    expect(container.textContent).toContain("中文预览");
    expect(container.textContent).not.toContain("English preview");
  });

  it("compares build codes even when the visible version stays the same", () => {
    expect(parseMobileUpdate(manifest)).toEqual(manifest);
    expect(hasMobileUpdate({ version: "0.7.0", build: 4 }, manifest)).toBe(
      true,
    );
    expect(hasMobileUpdate({ version: "0.7.0", build: 5 }, manifest)).toBe(
      false,
    );
    expect(hasMobileUpdate({ version: "0.7.0", build: 6 }, manifest)).toBe(
      false,
    );
  });
  it.each([
    { packageId: "other.app" },
    { downloadPath: "http://other/app.apk" },
    { downloadPath: "/apk/../app.apk" },
    { sha256: "bad" },
    { versionCode: 1.5 },
    { versionCode: -1 },
    { size: 0 },
    { publishedAt: "invalid" },
  ])("rejects invalid manifest %j", (change) => {
    expect(() => parseMobileUpdate({ ...manifest, ...change })).toThrow(
      "Invalid update information",
    );
  });
  it("checks the fixed HTTP source without requiring a Host login", async () => {
    expect(await checkMobileUpdate()).toEqual({
      ...manifest,
      sourceUrl: updateBaseUrl,
    });
    expect(native.http.mock.calls[0][0]).toMatchObject({
      url: `${updateBaseUrl}/latest.json`,
    });
    expect(native.http.mock.calls[0][0].headers).toBeUndefined();
  });
  it("falls back to HTTPS and downloads from the successful source", async () => {
    native.http.mockRejectedValueOnce(new Error("LAN offline"));
    const container = await mount();
    expect(native.http.mock.calls[1][0].url).toBe(
      `${updateBaseUrls[1]}/latest.json`,
    );
    expect(container.textContent).toContain(updateBaseUrls[1]);
    await act(async () => button(container, "Download and install").click());
    expect(native.install).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${updateBaseUrls[1]}${manifest.downloadPath}`,
      }),
    );
  });
  it("ignores manifest source URLs and rejects unconfigured download sources", async () => {
    native.http.mockResolvedValueOnce({
      status: 200,
      data: { ...manifest, sourceUrl: "https://other.example" },
    });
    expect(updateDownloadUrl(await checkMobileUpdate())).toBe(
      `${updateBaseUrl}${manifest.downloadPath}`,
    );
    expect(() =>
      updateDownloadUrl({ ...manifest, sourceUrl: "https://other.example" }),
    ).toThrow();
  });
  it("checks on app startup and foreground, and exposes the newer APK", async () => {
    const container = await mount(false);
    expect(container.textContent).toContain("A new version is available.");
    expect(container.textContent).toContain(updateBaseUrl);
    expect(button(container, "Checking for updates…").disabled).toBe(true);
    expect(button(container, "Download and install").disabled).toBe(true);
    expect(native.http).toHaveBeenCalledTimes(1);
    await act(async () =>
      native.foreground.mock.calls[0][1]({ isActive: false }),
    );
    expect(native.http).toHaveBeenCalledTimes(1);
    await act(async () =>
      native.foreground.mock.calls[0][1]({ isActive: true }),
    );
    expect(native.http).toHaveBeenCalledTimes(1);
    await advance(2_000);
    await act(async () =>
      native.foreground.mock.calls[0][1]({ isActive: true }),
    );
    expect(native.http).toHaveBeenCalledTimes(2);
  });
  it("keeps manual checks loading for two seconds and ignores repeated actions", async () => {
    const container = await mount();
    const check = button(container, "Check for updates");
    await act(async () => {
      check.click();
      check.click();
      native.foreground.mock.calls[0][1]({ isActive: true });
      button(container, "Download and install").click();
    });
    expect(native.http).toHaveBeenCalledTimes(2);
    expect(native.permission).not.toHaveBeenCalled();
    expect(check.querySelector(".mobile-spin")).not.toBeNull();
    await advance(1_999);
    expect(label(check)).toBe("Checking for updates…");
    expect(check.disabled).toBe(true);
    await act(async () =>
      native.foreground.mock.calls[0][1]({ isActive: true }),
    );
    expect(native.http).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(label(check)).toBe("Check for updates");
    expect(check.disabled).toBe(false);
    expect(button(container, "Download and install").disabled).toBe(false);
  });
  it("keeps a slow check locked until the request finishes without another delay", async () => {
    let finish!: (value: unknown) => void;
    native.http.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const container = await mount(false);
    await advance(3_000);
    expect(button(container, "Checking for updates…").disabled).toBe(true);
    await act(async () =>
      native.foreground.mock.calls[0][1]({ isActive: true }),
    );
    expect(native.http).toHaveBeenCalledTimes(1);
    await act(async () => finish({ status: 200, data: manifest }));
    expect(button(container, "Check for updates").disabled).toBe(false);
  });
  it("waits for Android install permission and lets the user retry after returning", async () => {
    native.permission.mockResolvedValueOnce({ allowed: false });
    const container = await mount();
    await act(async () => button(container, "Download and install").click());
    expect(native.install).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Allow OmniCode to install apps");
    await advance(1_999);
    expect(button(container, "Downloading… 0%").disabled).toBe(true);
    await advance(1);
    await act(async () => button(container, "Download and install").click());
    expect(native.install).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${updateBaseUrl}${manifest.downloadPath}`,
        sha256: manifest.sha256,
        versionCode: 5,
      }),
    );
    expect(container.textContent).toContain(
      "Confirm the update in the Android installer.",
    );
    expect(native.remove).toHaveBeenCalled();
    await advance(1_999);
    const downloading = button(container, "Downloading… 0%");
    expect(downloading.disabled).toBe(true);
    expect(downloading.querySelector(".mobile-spin")).not.toBeNull();
    expect(button(container, "Check for updates").disabled).toBe(true);
    await act(async () => {
      downloading.click();
      native.foreground.mock.calls[0][1]({ isActive: true });
    });
    expect(native.install).toHaveBeenCalledTimes(1);
    expect(native.http).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(button(container, "Download and install").disabled).toBe(false);
    expect(container.querySelector("progress")).toBeNull();
  });
  it("recovers from an offline update server and hides install when already current", async () => {
    native.http.mockRejectedValue(new Error("offline"));
    const container = await mount(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "offline",
    );
    await advance(1_999);
    expect(button(container, "Checking for updates…").disabled).toBe(true);
    await advance(1);
    native.http.mockResolvedValue({ status: 200, data: manifest });
    native.info.mockResolvedValue({ version: "0.7.0", build: "5" });
    await act(async () => button(container, "Check for updates").click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("You are up to date.");
    expect(button(container, "Download and install")).toBeUndefined();
  });
  it("does not offer an Android package for iOS", async () => {
    native.platform = "ios";
    const container = await mount();
    expect(container.textContent).toContain(
      "iOS updates require an Apple distribution channel.",
    );
    expect(native.http).not.toHaveBeenCalled();
    expect(container.querySelector("button")).toBeNull();
  });
  it("shows native download progress and prevents duplicate installation requests", async () => {
    let finish!: () => void;
    native.install.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const container = await mount();
    await act(async () => {
      button(container, "Download and install").click();
      button(container, "Download and install").click();
    });
    expect(native.install).toHaveBeenCalledTimes(1);
    await act(async () =>
      native.listener.mock.calls[0][1]({ received: 600, total: 1000 }),
    );
    expect(container.querySelector("progress")?.value).toBe(60);
    expect(container.textContent).toContain("Downloading… 60%");
    await advance(3_000);
    expect(button(container, "Downloading… 60%").disabled).toBe(true);
    await act(async () => finish());
    expect(container.querySelector("progress")).toBeNull();
    expect(button(container, "Download and install").disabled).toBe(false);
  });
  it("allows retry after a native download fails", async () => {
    native.install.mockRejectedValueOnce(new Error("download interrupted"));
    const container = await mount();
    await act(async () => button(container, "Download and install").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "download interrupted",
    );
    expect(native.remove).toHaveBeenCalled();
    await advance(1_999);
    expect(button(container, "Downloading… 0%").disabled).toBe(true);
    await advance(1);
    await act(async () => button(container, "Download and install").click());
    expect(native.install).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("prevents duplicate browser downloads throughout the minimum loading time", async () => {
    native.platform = "web";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(manifest)),
    );
    const download = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => {});
    const container = await mount();
    const install = button(container, "Download and install");
    await act(async () => {
      install.click();
      install.click();
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(
      `${updateBaseUrl}${manifest.downloadPath}`,
    );
    expect(native.install).not.toHaveBeenCalled();
    await advance(1_999);
    expect(install.disabled).toBe(true);
    expect(label(install)).toBe("Downloading… 0%");
    await act(async () => install.click());
    expect(download).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(install.disabled).toBe(false);
    await act(async () => install.click());
    expect(download).toHaveBeenCalledTimes(2);
  });
});
