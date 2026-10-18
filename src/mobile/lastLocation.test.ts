// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LAST_LOCATION_KEY,
  readLastLocation,
  saveLastLocation,
} from "./lastLocation";

describe("mobile last location", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips the project and conversation for the same Host", () => {
    saveLastLocation({ environmentId: "env", projectId: "p", sessionId: "s" });
    expect(readLastLocation("env")).toEqual({
      environmentId: "env",
      projectId: "p",
      sessionId: "s",
    });
  });

  it("ignores locations from another Host or without a connection", () => {
    saveLastLocation({ environmentId: "env", projectId: "p" });
    expect(readLastLocation("other")).toBeUndefined();
    expect(readLastLocation(undefined)).toBeUndefined();
  });

  it("ignores malformed values", () => {
    localStorage.setItem(LAST_LOCATION_KEY, "{broken");
    expect(readLastLocation("env")).toBeUndefined();
    localStorage.setItem(
      LAST_LOCATION_KEY,
      JSON.stringify({ environmentId: "env", projectId: 3 }),
    );
    expect(readLastLocation("env")).toBeUndefined();
  });

  it("survives storage that throws", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() =>
      saveLastLocation({ environmentId: "env", projectId: "p" }),
    ).not.toThrow();
    expect(readLastLocation("env")).toBeUndefined();
  });
});
