import { useCallback, useEffect, useRef, useState } from "react";
import type { BotRpc } from "../model/botRpc";
import type { ImConfigure, ImControl, ImView } from "../model/im";
import { getUiLanguage } from "../../../shared/i18n/language";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { ChevronDown } from "../../../shared/ui/icons";

const stateLabels: Record<ImView["status"]["state"], string> = {
  stopped: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  failed: "Connection failed",
};
type Draft = { appId: string; ownerOpenId: string; appSecret: string };

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
  const [draft, setDraft] = useState<Draft>({
    appId: "",
    ownerOpenId: "",
    appSecret: "",
  });
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const edited = useRef(false);
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

  const receive = useCallback((next: ImView, replaceDraft = false) => {
    setView(next);
    if (replaceDraft || !edited.current) {
      edited.current = false;
      setDraft({
        appId: next.config?.appId ?? "",
        ownerOpenId: next.config?.ownerOpenId ?? "",
        appSecret: "",
      });
    }
  }, []);

  const load = useCallback(async () => {
    if (pendingRef.current) return;
    const request = ++reads.current;
    try {
      const next = await rpc<ImView>("im.get", {});
      if (mounted.current && request === reads.current) {
        receive(next);
        setLoadError(undefined);
      }
    } catch (cause) {
      if (mounted.current && request === reads.current)
        setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc, receive]);

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
    method: "im.configure" | "im.control",
    params: ImConfigure | ImControl,
  ) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    reads.current++;
    setPending(true);
    setError(undefined);
    setSaved(false);
    try {
      const next = await rpc<ImView>(method, params);
      if (!mounted.current) return;
      receive(next, method === "im.configure");
      if (method === "im.configure") setSaved(true);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
    if (mounted.current && pollingRef.current) await load();
  };

  const edit = (key: keyof Draft, value: string) => {
    edited.current = true;
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const busy = disabled || pending || !view;
  const allowSavedSecret =
    !!view?.config?.secretConfigured &&
    draft.appId.trim() === view.config.appId;
  const bindingChanged =
    !!view?.config &&
    (draft.appId.trim() !== view.config.appId ||
      draft.ownerOpenId.trim() !== view.config.ownerOpenId);
  const valid =
    !!draft.appId.trim() &&
    !!draft.ownerOpenId.trim() &&
    (!!draft.appSecret.trim() || allowSavedSecret);
  const save = () => {
    if (busy || !valid) return;
    void mutate("im.configure", {
      appId: draft.appId.trim(),
      ownerOpenId: draft.ownerOpenId.trim(),
      ...(draft.appSecret.trim() ? { appSecret: draft.appSecret.trim() } : {}),
      language: getUiLanguage(),
    });
  };
  const control = (input: ImControl) => void mutate("im.control", input);
  const time = (value: number) => new Date(value).toLocaleString(language);
  const summary = !supported
    ? t("Unavailable on this Host")
    : view
      ? t(stateLabels[view.status.state])
      : t("Connect your assistant");
  const notice = error ?? loadError;

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
          <div
            className="assistant-im"
            onKeyDown={(event) => {
              // Enter in this live configuration must never submit the assistant draft.
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                event.target instanceof HTMLInputElement
              ) {
                event.preventDefault();
                save();
              }
            }}
          >
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
                <button
                  type="button"
                  className="assistant-link-button"
                  disabled={pending}
                  onClick={() => {
                    setError(undefined);
                    void load();
                  }}
                >
                  {t("Retry")}
                </button>
              </div>
            )}
            {!view && !notice && (
              <p role="status">{t("Loading Feishu settings…")}</p>
            )}
            <label>
              {t("App ID")}
              <input data-ui="input"
                value={draft.appId}
                onChange={(event) => edit("appId", event.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              {t("App Secret")}
              <input data-ui="input"
                type="password"
                value={draft.appSecret}
                onChange={(event) => edit("appSecret", event.target.value)}
                disabled={busy}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={
                  allowSavedSecret
                    ? t("Saved; leave blank to keep it")
                    : t("Enter the App Secret")
                }
              />
            </label>
            <label>
              {t("Your Feishu open_id")}
              <input data-ui="input"
                value={draft.ownerOpenId}
                onChange={(event) => edit("ownerOpenId", event.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
              <small>
                {t(
                  "Use your open_id for this app. Other users and group messages cannot control your assistant.",
                )}
              </small>
            </label>
            {bindingChanged && (
              <p className="assistant-im-hint" role="status">
                {t(
                  "Changing the app or authorized account stops pending deliveries for the previous connection. Save, then connect again.",
                )}
              </p>
            )}
            <div className="assistant-im-actions">
              <button data-ui="button" data-variant="primary"
                type="button"
                className="assistant-primary"
                disabled={busy || !valid}
                onClick={save}
              >
                {t("Save Feishu settings")}
              </button>
              {saved && (
                <small role="status">{t("Feishu settings saved")}</small>
              )}
            </div>
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
                      <button
                        type="button"
                        className="assistant-link-button"
                        disabled={busy}
                        onClick={() => control({ action: "disable" })}
                      >
                        {t("Disconnect Feishu")}
                      </button>
                      <button
                        type="button"
                        className="assistant-link-button"
                        disabled={busy || !assistantEnabled}
                        onClick={() => control({ action: "reconnect" })}
                      >
                        {t("Reconnect")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="assistant-link-button"
                      disabled={busy || !view.configured || !assistantEnabled}
                      onClick={() => control({ action: "enable" })}
                    >
                      {t("Connect Feishu")}
                    </button>
                  )}
                </div>
                <small className="assistant-im-hint">
                  {t("Connection controls use the saved settings.")}
                </small>
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
                        <button
                          type="button"
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
                        </button>
                        <button
                          type="button"
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
                        </button>
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
