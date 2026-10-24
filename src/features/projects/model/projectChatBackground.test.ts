import { beforeEach, describe, expect, it } from "vitest";
import { clearProjectChatBackgroundSetting, loadProjectChatBackgroundSettings, projectChatBackgroundImageRevision, saveProjectChatBackgroundSettings } from "./projectChatBackground";

const KEY = "omnicode:project-chat-backgrounds";

function mockBrowserStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: { dispatchEvent: () => true },
    configurable: true,
  });
}

describe("project chat background settings", () => {
  beforeEach(mockBrowserStorage);

  it("stores independent overrides for each project", () => {
    saveProjectChatBackgroundSettings("/work/alpha", {
      path: "/backgrounds/alpha.webp",
      opacity: 0.22,
      effect: "none",
    });
    saveProjectChatBackgroundSettings("/work/beta", {
      path: "/backgrounds/beta.png",
      opacity: 0.48,
      effect: "none",
    });

    expect(loadProjectChatBackgroundSettings("/work/alpha")).toEqual({
      path: "/backgrounds/alpha.webp",
      opacity: 0.22,
      effect: "none",
    });
    expect(loadProjectChatBackgroundSettings("/work/beta")).toEqual({
      path: "/backgrounds/beta.png",
      opacity: 0.48,
      effect: "none",
    });
  });

  it("clamps visibility to the supported range", () => {
    saveProjectChatBackgroundSettings("/work/alpha", {
      path: "/backgrounds/alpha.webp",
      opacity: 1.5,
      effect: "none",
    });
    saveProjectChatBackgroundSettings("/work/beta", {
      path: "/backgrounds/beta.webp",
      opacity: 0,
      effect: "none",
    });

    expect(loadProjectChatBackgroundSettings("/work/alpha")?.opacity).toBe(1);
    expect(loadProjectChatBackgroundSettings("/work/beta")?.opacity).toBe(0.05);
  });

  it("falls back safely when stored project data is malformed", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        "/work/alpha": {
          path: "/backgrounds/alpha.webp",
          opacity: "bright",
          scope: "transcript",
        },
      }),
    );

    expect(loadProjectChatBackgroundSettings("/work/alpha")).toEqual({
      path: "/backgrounds/alpha.webp",
      opacity: 0.24,
      effect: "none",
    });
  });

  it("clears one project without changing the others", () => {
    saveProjectChatBackgroundSettings("/work/alpha", {
      path: "/backgrounds/alpha.webp",
      opacity: 0.2,
      effect: "none",
    });
    saveProjectChatBackgroundSettings("/work/beta", {
      path: "/backgrounds/beta.webp",
      opacity: 0.3,
      effect: "none",
    });

    clearProjectChatBackgroundSetting("/work/alpha");

    expect(loadProjectChatBackgroundSettings("/work/alpha")).toBeNull();
    expect(loadProjectChatBackgroundSettings("/work/beta")?.path).toBe(
      "/backgrounds/beta.webp",
    );
  });

  it("stores effects independently and preserves older project images", () => {
    localStorage.setItem("omnicode.newThreadBackgroundEffect", "ascii");
    saveProjectChatBackgroundSettings("/work/alpha", {
      path: "/backgrounds/alpha.webp",
      opacity: 0.2,
      effect: "dither",
    });
    saveProjectChatBackgroundSettings("/work/beta", {
      path: "/backgrounds/beta.webp",
      opacity: 0.4,
      effect: "none",
    });

    expect(loadProjectChatBackgroundSettings("/work/alpha")?.effect).toBe(
      "dither",
    );
    expect(loadProjectChatBackgroundSettings("/work/beta")?.effect).toBe(
      "none",
    );

    localStorage.setItem(
      KEY,
      JSON.stringify({
        "/work/alpha": {
          path: "/backgrounds/alpha.webp",
          effect: "unknown",
        },
      }),
    );
    expect(loadProjectChatBackgroundSettings("/work/alpha")?.effect).toBe(
      "none",
    );
  });

  it("does not reprocess the image for effect and visibility updates", () => {
    const imageRevision = projectChatBackgroundImageRevision();
    const settings = {
      path: "/backgrounds/alpha.webp",
      opacity: 0.2,
      effect: "none" as const,
    };
    saveProjectChatBackgroundSettings("/work/alpha", settings, true);
    expect(projectChatBackgroundImageRevision()).toBe(imageRevision + 1);

    saveProjectChatBackgroundSettings("/work/alpha", {
      ...settings,
      opacity: 0.4,
      effect: "dither",
    });
    expect(projectChatBackgroundImageRevision()).toBe(imageRevision + 1);
  });

  it("merges old project visibility without retaining empty-only behavior", () => {
    localStorage.setItem(KEY, JSON.stringify({
      "/work/alpha": {
        path: "/backgrounds/alpha.webp", emptyOpacity: 1, sessionOpacity: 0.3,
        scope: "empty", effect: "dither",
      },
      "/work/beta": { path: "/backgrounds/beta.webp", emptyOpacity: 0.4 },
    }));
    const merged = loadProjectChatBackgroundSettings("/work/alpha")!;
    expect(merged).toEqual({ path: "/backgrounds/alpha.webp", opacity: 0.3, effect: "dither" });
    expect(loadProjectChatBackgroundSettings("/work/beta")?.opacity).toBe(0.4);
    saveProjectChatBackgroundSettings("/work/alpha", { ...merged, opacity: 0.6 });
    expect(JSON.parse(localStorage.getItem(KEY)!)["/work/alpha"]).toEqual({
      path: "/backgrounds/alpha.webp", opacity: 0.6, effect: "dither",
    });
  });
});
