import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readNativeGitPopup, finishNativeGitPopup, fitNativeGitPopup, subscribeNativeGitPopup } from "../../../platform/tauri/gitPopup";
import type { GitBranches } from "../../../platform/tauri/fs";
import { NativePopupHost } from "../../../shared/ui/NativePopupHost";
import { seedProjectBranches } from "../../source-control/hooks/useProjectBranches";
import { type QuickGitRequest } from "../model/quickGitPopup";
import type { QuickWorkspace } from "../model/quickWorkspace";

export function QuickGitPopup({ onShown, renderPicker }: {
  onShown: () => void;
  renderPicker: (props: { request: QuickGitRequest; onFinish: (id: string, choice?: QuickWorkspace) => Promise<void> }) => ReactNode;
}) {
  const [request, setRequest] = useState<QuickGitRequest | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    let disposed = false;
    let received = false;
    let stop: (() => void) | undefined;
    const accept = (request: QuickGitRequest | null) => {
      if (disposed) return;
      onShown();
      if (request?.branches) {
        seedProjectBranches(
          request.choice.tree?.path ?? request.choice.cwd ?? "",
          request.branches,
        );
      }
      if (errorRef.current) errorRef.current.textContent = "";
      setRequest(request);
    };
    void subscribeNativeGitPopup<QuickWorkspace, GitBranches>( ({ payload }) => {
      received = true;
      accept(payload);
    })
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        stop = unlisten;
        const initial = await readNativeGitPopup<QuickWorkspace, GitBranches>();
        if (!received) accept(initial);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, [onShown]);

  useLayoutEffect(() => {
    if (!host || !request) return;
    let lastHeight = 0;
    const fit = () => {
      const height = Math.ceil(host.getBoundingClientRect().height);
      if (height <= 2 || height === lastHeight) return;
      lastHeight = height;
      void fitNativeGitPopup(request.id, height).catch(
        () => undefined,
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();
    return () => observer.disconnect();
  }, [host, request]);

  useEffect(() => {
    const focus = () =>
      requestAnimationFrame(() =>
        host
          ?.querySelector<HTMLInputElement>("input, textarea")
          ?.focus({ preventScroll: true }),
      );
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [host]);

  const finish = useCallback(async (id: string, choice?: QuickWorkspace) => {
    try {
      await finishNativeGitPopup({
        id,
        choice: choice ?? null,
        restoreFocus: true,
      });
    } catch (error) {
      if (errorRef.current) errorRef.current.textContent = String(error);
      throw error;
    }
  }, []);

  return (
    <div
      ref={setHost}
      className="desktop-card max-h-[520px] overflow-y-auto rounded-xl border border-content/10 bg-background-base/45 text-content"
    >
      <p
        ref={errorRef}
        role="alert"
        className="empty:hidden px-3 py-2 text-xs text-red-400"
      />
      {host && request ? (
        <NativePopupHost key={request.id} value={host}>
          {renderPicker({ request, onFinish: finish })}
        </NativePopupHost>
      ) : null}
    </div>
  );
}

