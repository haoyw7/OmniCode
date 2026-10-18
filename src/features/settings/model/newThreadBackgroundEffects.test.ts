// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPreparedNewThreadBackground,
  clearPreparedNewThreadBackground,
  prepareNewThreadBackgroundEffect,
} from "./newThreadBackgroundEffects";

afterEach(() => {
  clearPreparedNewThreadBackground();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("new-thread background effects", () => {
  it("uses the original asset directly for None so animation is preserved", async () => {
    const fetch = vi.fn();
    const worker = vi.fn(() => {
      throw new Error("None must not start a worker");
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("Worker", worker);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    await applyPreparedNewThreadBackground(
      "/background.gif?v=101",
      "asset://localhost/background.gif?v=101",
      "none",
      false,
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();
    expect(
      document.documentElement.style.getPropertyValue(
        "--chat-background-image",
      ),
    ).toContain("background.gif?v=101");
    expect(document.documentElement.classList).toContain(
      "chat-background-effect-ready",
    );
  });

  it("uses the original asset for Gradient Blur without starting the image worker", async () => {
    const fetch = vi.fn();
    const worker = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("Worker", worker);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    await applyPreparedNewThreadBackground(
      "/background.png?v=102",
      "asset://localhost/background.png?v=102",
      "gradient-blur",
      false,
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();
    expect(document.documentElement.classList).toContain(
      "chat-background-gradient-blur",
    );
    expect(document.documentElement.classList).toContain(
      "chat-background-effect-ready",
    );
    expect(
      document.documentElement.style.getPropertyValue(
        "--chat-background-image",
      ),
    ).toContain("background.png?v=102");

    await applyPreparedNewThreadBackground(
      "/background.png?v=102",
      "asset://localhost/background.png?v=102",
      "none",
      false,
    );
    expect(document.documentElement.classList).not.toContain(
      "chat-background-gradient-blur",
    );
  });

  it("leaves an unchanged background on screen when it is applied again", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const apply = () =>
      applyPreparedNewThreadBackground(
        "/background.png?v=103",
        "asset://localhost/background.png?v=103",
        "none",
        false,
      );
    await apply();

    const classes = document.documentElement.classList;
    const remove = vi.spyOn(classes, "remove");
    await apply();

    expect(remove).not.toHaveBeenCalled();
    expect(classes).toContain("chat-background-effect-ready");
  });

  it("drops rejected source promises so transient failures can retry", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("temporary failure"));
    vi.stubGlobal("fetch", fetch);
    const sourceKey = `/background.png?v=${Date.now()}`;

    await expect(
      prepareNewThreadBackgroundEffect(
        sourceKey,
        "asset://localhost/background.png",
        "dither",
        false,
      ),
    ).rejects.toThrow("temporary failure");
    await expect(
      prepareNewThreadBackgroundEffect(
        sourceKey,
        "asset://localhost/background.png",
        "dither",
        false,
      ),
    ).rejects.toThrow("temporary failure");

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
