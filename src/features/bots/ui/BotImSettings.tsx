import { useCallback, useEffect, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import type { ImBind, ImControl, ImView } from "../model/im";
import { openBrowser } from "../../../platform/tauri/browser";
import { copyText } from "../../../platform/tauri/clipboard";
import { getUiLanguage } from "../../../shared/i18n/language";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { ChevronDown } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/forms/Button";
import { Input } from "../../../shared/ui/forms/Input";

const stateLabels: Record<ImView["status"]["state"], string> = {
  stopped: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  failed: "Connection failed",
};
/** Live Host configuration is independent of the surrounding assistant draft. */
export function BotImSettings({
  rpc,
  supported,
  active,
  assistantEnabled,
  disabled = false,
}: {
  rpc: BotRpc;
  supported: boolean;
  active: boolean;
  assistantEnabled: boolean;
  disabled?: boolean;
}) {
  const { t, language } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ImView>();
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const pendingRef = useRef(false);
  const reads = useRef(0);
  const mounted = useRef(true);
  const polling = active && open && supported && documentVisible;
  const pollingRef = useRef(polling);
  pollingRef.current = polling;

  useEffect(() => {
    mounted.current = true;
    const update = () =>
      setDocumentVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => {
      mounted.current = false;
      reads.current++;
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const load = useCallback(async () => {
    if (pendingRef.current) return;
    const request = ++reads.current;
    try {
      const next = await rpc<ImView>("im.get", {});
      if (mounted.current && request === reads.current) {
        setView(next);
        setLoadError(undefined);
      }
    } catch (cause) {
      if (mounted.current && request === reads.current)
        setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc]);

  useEffect(() => {
    if (!polling) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      await load();
      if (!disposed) timer = setTimeout(() => void refresh(), 2000);
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      reads.current++;
    };
  }, [polling, load]);

  const mutate = async (
    method: "im.bind" | "im.control",
    params: ImBind | ImControl,
  ) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    reads.current++;
    setPending(true);
    setGenerating(method === "im.bind" && params.action === "start");
    setError(undefined);
    setCopied(false);
    let result: ImView | undefined;
    try {
      const next = await rpc<ImView>(method, params);
      if (!mounted.current) return;
      setView(next);
      result = next;
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pendingRef.current = false;
      if (mounted.current) {
        setPending(false);
        setGenerating(false);
      }
    }
    if (method === "im.control" && mounted.current && pollingRef.current)
      await load();
    return result;
  };

  const busy = disabled || pending || !view;
  const binding = view?.binding;
  const waiting = binding?.state === "pending";
  const openBindingLink = async (url: string) => {
    try {
      await openBrowser(url);
      if (mounted.current) setError(undefined);
    } catch {
      if (mounted.current)
        setError(
          "Could not open the browser. Copy the binding link and open it manually.",
        );
    }
  };
  const bind = async () => {
    if (busy || !assistantEnabled) return;
    const next = await mutate("im.bind", {
      action: "start",
      language: getUiLanguage(),
    });
    if (
      mounted.current &&
      pollingRef.current &&
      next?.binding?.state === "pending" &&
      next.binding.verificationUrl
    )
      await openBindingLink(next.binding.verificationUrl);
  };
  const copyLink = async () => {
    if (!binding?.verificationUrl) return;
    try {
      await copyText(binding.verificationUrl);
      if (mounted.current) {
        setCopied(true);
        setError(undefined);
      }
    } catch {
      if (mounted.current)
        setError(
          "Could not copy the binding link. Select and copy it manually.",
        );
    }
  };
  const control = (input: ImControl) => void mutate("im.control", input);
  const time = (value: number) => new Date(value).toLocaleString(language);
  const summary = !supported
    ? t("Unavailable on this Host")
    : view
      ? t(stateLabels[view.status.state])
      : t("Connect your assistant");
  const notice = error ?? loadError ?? binding?.error;

  return (
    <section
      className="assistant-settings-section assistant-im-section"
      data-open={open}
    >
      <button
        type="button"
        className="assistant-settings-disclosure"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="assistant-settings-disclosure-title">
          {t("Feishu")}
        </span>
        <small className="assistant-settings-summary">{summary}</small>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <AnimatedCollapse expanded={open}>
        {!supported ? (
          <p className="assistant-im-hint">
            {t(
              "This Host does not support Feishu. Update and restart the Host to connect it.",
            )}
          </p>
        ) : (
          <div className="assistant-im">
            <p className="assistant-im-hint">
              {t(
                "Connect your personal assistant to Feishu on this Host. Only direct messages from your authorized account are accepted.",
              )}
            </p>
            {!assistantEnabled && (
              <p className="assistant-im-hint" role="status">
                {t("Enable the assistant before connecting Feishu.")}
              </p>
            )}
            {notice && (
              <div className="assistant-field-notice" role="alert">
                <span>{t(notice)}</span>
                <Button
                  variant="link"
                  className="assistant-link-button"
                  disabled={
                    disabled ||
                    pending ||
                    (!assistantEnabled &&
                      (binding?.state === "failed" || (!!error && !waiting)))
                  }
                  onClick={() => {
                    setError(undefined);
                    if (binding?.state === "failed" || (error && !waiting))
                      void bind();
                    else void load();
                  }}
                >
                  {t("Retry")}
                </Button>
              </div>
            )}
            {!view && !notice && (
              <p role="status">{t("Loading Feishu settings…")}</p>
            )}
            {waiting && binding.verificationUrl ? (
              <>
                <p role="status">{t("Waiting for Feishu authorization…")}</p>
                <p className="assistant-im-hint">
                  {t(
                    "Open the binding link in your browser and complete Feishu authorization. If prompted, scan the code with Feishu. This Host will connect automatically.",
                  )}
                </p>
                <label>
                  {t("Feishu binding link")}
                  <Input
                    readOnly
                    value={binding.verificationUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.preventDefault();
                    }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                {binding.expiresAt !== undefined && (
                  <small>
                    {t("Binding link expires: {time}", {
                      time: time(binding.expiresAt),
                    })}
                  </small>
                )}
                <div className="assistant-im-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void openBindingLink(binding.verificationUrl!)
                    }
                  >
                    {t("Open in browser")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void copyLink()}
                  >
                    {t(copied ? "Copied" : "Copy binding link")}
                  </Button>
                  <Button
                    variant="link"
                    disabled={busy}
                    onClick={() =>
                      void mutate("im.bind", {
                        action: "cancel",
                        bindingId: binding.id,
                      })
                    }
                  >
                    {t("Cancel")}
                  </Button>
                </div>
              </>
            ) : (
              <div className="assistant-im-actions">
                <Button
                  disabled={busy || !assistantEnabled}
                  onClick={() => void bind()}
                >
                  {t(
                    generating
                      ? "Generating binding link…"
                      : view?.configured
                        ? "Bind another Feishu account"
                        : "Bind Feishu",
                  )}
                </Button>
              </div>
            )}
            {binding?.state === "expired" && (
              <p role="status">
                {t(
                  "The Feishu binding link expired. Generate a new link to try again.",
                )}
              </p>
            )}
            {binding?.state === "cancelled" && (
              <p role="status">{t("Feishu binding cancelled.")}</p>
            )}
            {binding?.state === "completed" && (
              <p role="status">{t("Feishu account bound.")}</p>
            )}
            {view?.configured && !waiting && (
              <p className="assistant-im-hint">
                {t("Bound account: {account}", {
                  account: view.config?.ownerOpenId ?? "",
                })}
              </p>
            )}
            {view?.configured && waiting && (
              <p className="assistant-im-hint" role="status">
                {t(
                  "Your current connection stays active until authorization succeeds. Binding a different account stops pending deliveries for the previous connection.",
                )}
              </p>
            )}
            {view && (
              <div className="assistant-im-connection">
                <p role="status">
                  {t("Connection: {status}", {
                    status: t(stateLabels[view.status.state]),
                  })}
                </p>
                {view.status.error && (
                  <p className="assistant-field-error" role="alert">
                    {t(view.status.error)}
                  </p>
                )}
                {view.status.nextRetryAt !== undefined && (
                  <small>
                    {t("Next connection attempt: {time}", {
                      time: time(view.status.nextRetryAt),
                    })}
                  </small>
                )}
                <div className="assistant-im-actions">
                  {view.config?.enabled ? (
                    <>
                      <Button
                        variant="link"
                        className="assistant-link-button"
                        disabled={busy}
                        onClick={() => control({ action: "disable" })}
                      >
                        {t("Disconnect Feishu")}
                      </Button>
                      <Button
                        variant="link"
                        className="assistant-link-button"
                        disabled={busy || !assistantEnabled}
                        onClick={() => control({ action: "reconnect" })}
                      >
                        {t("Reconnect")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="link"
                      className="assistant-link-button"
                      disabled={
                        busy || waiting || !view.configured || !assistantEnabled
                      }
                      onClick={() => control({ action: "enable" })}
                    >
                      {t("Connect Feishu")}
                    </Button>
                  )}
                </div>
              </div>
            )}
            {view && (view.pending > 0 || view.deliveries.length > 0) && (
              <div className="assistant-im-outbox">
                <h4>{t("Message delivery")}</h4>
                {view.pending > 0 && (
                  <p>
                    {t("{count} messages pending delivery", {
                      count: view.pending,
                    })}
                  </p>
                )}
                <ul className="assistant-im-deliveries">
                  {view.deliveries.map((delivery) => (
                    <li key={delivery.id}>
                      <strong>
                        {t(
                          delivery.state === "unknown"
                            ? "Delivery unconfirmed"
                            : "Delivery failed",
                        )}
                      </strong>
                      <small>{time(delivery.createdAt)}</small>
                      <p>{delivery.summary}</p>
                      {delivery.error && (
                        <small className="assistant-field-error">
                          {t(delivery.error)}
                        </small>
                      )}
                      {delivery.state === "unknown" && (
                        <small>
                          {t(
                            "Feishu may already have received this message. Retrying may send it twice.",
                          )}
                        </small>
                      )}
                      <div className="assistant-im-actions">
                        <Button
                          variant="link"
                          className="assistant-link-button"
                          disabled={busy || !view.config?.enabled}
                          onClick={() =>
                            control({
                              action: "retry",
                              deliveryId: delivery.id,
                            })
                          }
                        >
                          {t(
                            delivery.state === "unknown"
                              ? "Retry (may duplicate)"
                              : "Retry delivery",
                          )}
                        </Button>
                        <Button
                          variant="link"
                          className="assistant-link-button"
                          disabled={busy}
                          onClick={() =>
                            control({
                              action: "discard",
                              deliveryId: delivery.id,
                            })
                          }
                        >
                          {t("Stop delivery")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                {view.deliveries.length > 0 && (
                  <small className="assistant-im-hint">
                    {t(
                      "Stopping delivery keeps the conversation and does not recall messages already sent.",
                    )}
                  </small>
                )}
              </div>
            )}
          </div>
        )}
      </AnimatedCollapse>
    </section>
  );
}
