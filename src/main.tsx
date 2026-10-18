import { observeNativeScrollbarEdges } from "./shared/ui/nativeScrollbarEdges";
import { animate, MotionConfig } from "motion/react";
import { defaultTransition, immediateTransition } from "./shared/motion/tokens";
import { prefersReducedMotion } from "./shared/lib/reducedMotion";
import { initializeHostPreferences, stopDesktopHostPreferences } from "./features/settings/model/hostPreferences";
import { installSharedPreferenceEffects } from "./features/settings/model/sharedPreferenceEffects";
import { SharedStateStatus } from "./features/settings/ui/SharedStateStatus";
import { initializeHostWorkspaces } from "./features/connections/model/hostWorkspace";
import { initializeHostConnections } from "./features/connections/model/hostConnections";
import React, { useLayoutEffect } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  activateWindowAppearance,
  initAppearance,
} from "./features/settings/model/appearance";
import { initSounds } from "./features/settings/model/sounds";
import { initTypography } from "./features/settings/model/typography";
import {
  abortQuit,
  askQuitConfirmation,
  commitQuit,
  loadBootWorkspace,
  reportQuitPoll,
} from "./app/model/appLifecycle";
import { homeDir } from "./platform/tauri/fs";
import { setHomeDir } from "./shared/lib/paths";
import { consumeInstalledUpdate } from "./app/model/updateNotice";
import { initializeProviderBinaryPaths } from "./features/providers/model/providerBinaryPaths";
import { initProviderAccountPublishing } from "./features/providers/model/providerAccountCredentials";
// Lets file commands reach a connected machine for `remote://` paths.
import "./features/connections/model/remoteCommands";
import "./styles/index.css";
import { initUiLanguage } from "./shared/i18n/languageSync";
import { initializeSharedHost } from "./features/connections/model/sharedHost";
import { WindowResizeHandles } from "./app/shell/WindowResizeHandles";
import { WindowResizeObserver } from "./app/shell/WindowResizeObserver";
import { BootRecovery } from "./app/shell/BootRecovery";
import { configureDefaultIconArtwork } from "./shared/ui/icons";
import { desktopIconArtwork } from "./app/desktopIconArtwork";

configureDefaultIconArtwork(desktopIconArtwork);

performance.mark("omnicode:bootstrap");
// Let local boot IPC overlap loading/evaluating the workspace UI.
const appLoaded = import("./app/App");

initUiLanguage();
initAppearance();
initTypography();
initSounds();
installSharedPreferenceEffects();
// Prime the real home directory before the first render so every `~/` file
// reference resolves consistently. The IPC call is local and failures remain
// best-effort, falling back to inference from a session's cwd.
const homeDirPrimed = homeDir()
  .then(setHomeDir)
  .catch(() => {});
const providerBinaryPathsPrimed = initializeProviderBinaryPaths().catch(
  () => undefined,
);

// A transferred tab should land immediately instead of replaying the intro.
let skipSplashIntro = false;

/** Resolves once the finite logo intro in index.html has played. */
function bootSplashIntroFinished(splash: HTMLElement): Promise<unknown> {
  if (skipSplashIntro || prefersReducedMotion() || typeof splash.getAnimations !== "function") return Promise.resolve();
  const intro = splash
    .getAnimations({ subtree: true })
    .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
  return Promise.all(intro.map((animation) => animation.finished.catch(() => undefined)));
}

function dismissBootSplash() {
  const splash = document.getElementById("boot-splash");
  if (!splash || splash.dataset.dismissed === "1") return;
  splash.dataset.dismissed = "1";
  void bootSplashIntroFinished(splash).then(() => fadeBootSplash(splash));
}

function fadeBootSplash(splash: HTMLElement) {
  activateWindowAppearance();
  void animate(splash, { opacity: 0 }, prefersReducedMotion() ? immediateTransition : defaultTransition).then(() => {
    splash.remove();
    performance.mark("omnicode:ui-ready");
    performance.measure("omnicode:navigation-to-ui", { start: 0, end: "omnicode:ui-ready" });
  });
}

function BootGate({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => observeNativeScrollbarEdges(document), []);
  useLayoutEffect(() => {
    dismissBootSplash();
  }, []);
  return (
    <MotionConfig reducedMotion="user" transition={defaultTransition}>
      {children}
      <div style={{ position: "fixed", bottom: 8, right: 8, zIndex: 10000, maxWidth: "70vw" }}><SharedStateStatus /></div>
      <WindowResizeHandles />
      <WindowResizeObserver />
    </MotionConfig>
  );
}

void listen<number>("quit_poll", (event) => {
  void reportQuitPoll(event.payload);
});
// Scoped to this window on purpose: a global `listen` is registered as `Any`,
// which Tauri matches for every event regardless of the emitter's target, so
// one dialog would become one per window.
void getCurrentWebviewWindow().listen<{ id: number; inFlight: number }>(
  "quit_confirm",
  (event) => {
    void askQuitConfirmation(event.payload.id, event.payload.inFlight);
  },
);
void listen<number>("quit_commit", (event) => {
  void commitQuit(event.payload);
});
void listen("quit_aborted", () => {
  abortQuit();
});

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);
let booting = false;
let bootAttempt = 0;
const retryBoot = () => { void boot(); };
async function boot() {
  if (booting) return;
  booting = true;
  const attempt = ++bootAttempt;
  stopDesktopHostPreferences();
  try {
    await providerBinaryPathsPrimed;
    await initializeSharedHost();
    await initializeHostPreferences();
    await Promise.all([initProviderAccountPublishing(), initializeHostWorkspaces(), initializeHostConnections()]);
    const [
      ,
      ,
      { windowTransfer, resumed, history, historyCwd },
      { default: App },
    ] = await Promise.all([
      homeDirPrimed,
      providerBinaryPathsPrimed,
      loadBootWorkspace(),
      appLoaded,
    ]);
    performance.mark("omnicode:workspace-ready");
    const installedUpdate = windowTransfer ? null : consumeInstalledUpdate();
    skipSplashIntro = Boolean(windowTransfer);
    root.render(
      <React.StrictMode>
        <BootGate>
          <App
            windowTransfer={windowTransfer}
            resumed={resumed}
            installedUpdate={installedUpdate}
            history={history}
            historyCwd={historyCwd}
          />
        </BootGate>
      </React.StrictMode>,
    );
  } catch (error) {
    root.render(
      <BootGate>
        <BootRecovery key={attempt} error={error} onRetry={retryBoot} />
      </BootGate>,
    );
  } finally {
    booting = false;
  }
}
void boot();
