// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileClient, HostRequestError } from "./client";
import { MobileHostStatus } from "./MobileHostStatus";
import { useHostConnectionStatus } from "./useHostConnectionStatus";
import { setUiLanguage } from "../shared/i18n/language";

const descriptor = {
  protocolVersion: 1,
  environmentId: "test-host",
  name: "Test computer",
  providers: ["codex"],
};
function fixture() {
  const values = new Map<string, string>();
  const request = vi.fn(async (method: string): Promise<unknown> =>
    method === "environment.describe" ? descriptor : [],
  );
  const client = new MobileClient(
    {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        values.set(key, value);
      },
      remove: async (key) => {
        values.delete(key);
      },
    },
    async (_endpoint, _token, input) =>
      request((input as { method: string }).method),
  );
  return {
    client,
    values,
    request,
    connect: () => client.connect("http://test-computer:3774", "123"),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setUiLanguage("en");
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("mobile Host connection status", () => {
  it("keeps switched-off credentials across restoration and reconnects only when explicitly enabled", async () => {
    const { client, request, connect, values } = fixture();
    await connect();
    await client.suspend();
    expect(client.connection).toMatchObject({ name: "Test computer", token: "123", disabled: true });
    expect(JSON.parse(values.get("connection")!)).toMatchObject({ token: "123", disabled: true });
    expect(client.getConnectionStatus().state).toBe("disconnected");
    request.mockClear();
    expect(await client.restore()).toBe(false);
    await client.verify();
    await expect(client.projects()).rejects.toThrow("Connect to a Host first");
    expect(request).not.toHaveBeenCalled();
    await client.reconnect();
    expect(client.connection?.disabled).toBe(false);
    expect(client.getConnectionStatus().state).toBe("connected");
    await client.disconnect();
    expect(client.connection).toBeUndefined();
    expect(values.has("connection")).toBe(false);
  });

  it("ignores a late verification response after the switch is turned off", async () => {
    const { client, request, connect } = fixture();
    await connect();
    const pending = deferred<unknown>();
    request.mockImplementationOnce(() => pending.promise);
    const verifying = client.verify();
    await client.suspend();
    pending.resolve(descriptor);
    await verifying;
    expect(client.connection?.disabled).toBe(true);
    expect(client.getConnectionStatus().state).toBe("disconnected");
  });

  it("reports request failure, stays reconnecting until verification finishes, and then recovers", async () => {
    const { client, request, connect } = fixture();
    await connect();
    expect(client.getConnectionStatus().state).toBe("connected");
    request.mockRejectedValueOnce(new Error("Computer is offline"));
    await expect(client.projects()).rejects.toThrow("offline");
    expect(client.getConnectionStatus()).toMatchObject({
      state: "failed",
      detail: "Computer is offline",
    });
    const pending = deferred<unknown>();
    // Device metadata can be read before describe is sent, so concurrent RPCs
    // may reach the transport first. Hold verification by method, not order.
    request.mockImplementation((method) => method === "environment.describe"
      ? pending.promise : Promise.resolve([]));
    const retry = client.reconnect();
    expect(client.getConnectionStatus().state).toBe("reconnecting");
    // A concurrent task response cannot hide an in-progress reconnect.
    await client.projects();
    expect(client.getConnectionStatus().state).toBe("reconnecting");
    request.mockRejectedValueOnce(new Error("Another request is still offline"));
    await expect(client.projects()).rejects.toThrow("offline");
    expect(client.getConnectionStatus().state).toBe("reconnecting");
    pending.resolve(descriptor);
    await retry;
    expect(client.getConnectionStatus().state).toBe("connected");
  });

  it("keeps task rejection separate from authentication and timeout failures", async () => {
    const { client, request, connect } = fixture();
    await connect();
    request.mockRejectedValueOnce(new HostRequestError("No such session", 400));
    await expect(client.projects()).rejects.toThrow("No such session");
    expect(client.getConnectionStatus().state).toBe("connected");
    request.mockRejectedValueOnce(
      new HostRequestError("Credential revoked", 401),
    );
    await expect(client.projects()).rejects.toThrow("revoked");
    expect(client.getConnectionStatus()).toMatchObject({
      state: "failed",
      reason: "authentication",
    });
    request.mockRejectedValueOnce(
      new DOMException("Request timed out", "TimeoutError"),
    );
    await expect(client.projects()).rejects.toThrow("timed out");
    expect(client.getConnectionStatus()).toMatchObject({
      state: "failed",
      reason: "timeout",
    });
  });

  it("does not paint a late reply green after disconnecting or switching Hosts", async () => {
    const { client, request, connect } = fixture();
    await connect();
    const pending = deferred<unknown>();
    request.mockImplementationOnce(() => pending.promise);
    const task = client.projects();
    await client.disconnect();
    pending.resolve([]);
    await expect(task).rejects.toThrow("Host connection changed.");
    expect(client.getConnectionStatus().state).toBe("disconnected");
    await connect();
    request.mockRejectedValueOnce(new Error("Other computer is offline"));
    await expect(
      client.connect("http://other-computer:3774", "123"),
    ).rejects.toThrow("offline");
    expect(client.connection?.endpoint).toBe("http://test-computer:3774");
    expect(client.getConnectionStatus().state).toBe("connected");
  });

  it("rejects a changed Host identity and ignores an older verification reply", async () => {
    const { client, request, connect } = fixture();
    await connect();
    request.mockResolvedValueOnce({
      ...descriptor,
      environmentId: "another-host",
    });
    await expect(client.reconnect()).rejects.toThrow("identity changed");
    expect(client.getConnectionStatus()).toMatchObject({
      state: "failed",
      reason: "identity",
    });
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    request
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const heartbeat = client.verify();
    const retry = client.reconnect();
    older.resolve(descriptor);
    await heartbeat;
    expect(client.getConnectionStatus().state).toBe("reconnecting");
    newer.resolve(descriptor);
    await retry;
    expect(client.getConnectionStatus().state).toBe("connected");
  });
});

function Viewer({
  client,
  foreground,
}: {
  client: MobileClient;
  foreground: boolean;
}) {
  return createElement(MobileHostStatus, {
    status: useHostConnectionStatus(client, true, foreground),
  });
}
describe("automatic Host connection checks", () => {
  it("shows failed, reconnecting and healthy states during an automatic retry", async () => {
    vi.useFakeTimers();
    const { client, request, connect } = fixture();
    await connect();
    request.mockRejectedValueOnce(new Error("Host is offline"));
    const node = document.createElement("div");
    document.body.append(node);
    await act(async () => {
      root = createRoot(node);
      root.render(createElement(Viewer, { client, foreground: true }));
    });
    expect(node.querySelector('[data-state="failed"]')!.textContent).toBe(
      "Connection failed",
    );
    const pending = deferred<unknown>();
    request.mockImplementationOnce(() => pending.promise);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(node.querySelector('[data-state="reconnecting"]')!.textContent).toBe(
      "Reconnecting…",
    );
    await act(async () => {
      pending.resolve(descriptor);
      await pending.promise;
    });
    expect(node.querySelector('[data-state="connected"]')).not.toBeNull();
    expect(
      node.querySelector('[role="status"]')!.getAttribute("aria-label"),
    ).toBe("Connected");
    expect(node.querySelector('[data-state="connected"]')!.textContent).toBe(
      "",
    );
  });

  it("pauses checks in the background and checks immediately on return", async () => {
    vi.useFakeTimers();
    const { client, request, connect } = fixture();
    await connect();
    request.mockClear();
    const node = document.createElement("div");
    document.body.append(node);
    await act(async () => {
      root = createRoot(node);
      root.render(createElement(Viewer, { client, foreground: false }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(request).not.toHaveBeenCalled();
    await act(async () => {
      root!.render(createElement(Viewer, { client, foreground: true }));
    });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {
      root!.render(createElement(Viewer, { client, foreground: false }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
