import { useState, type ReactNode } from "react";
import type {
  UsageLimitSource,
  UsageProvider,
} from "../../../integrations/harness/core/usage";
import { usagePools, usagePace, usageLimitLabel } from "../model/usagePools";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { useMaskEmails } from "../../settings/model/displayPrefs";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { useNow } from "../../../shared/hooks/useNow";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { Button } from "../../../shared/ui/forms/Button";
import {
  ListMotion,
  ListMotionItem,
  ListMotionButton,
} from "../../../shared/ui/ListMotion";
import { usageColor } from "./UsageCharts";
import type { UsageDialogRenderer } from "./usageDialog";

export function UsageLimits({
  sources,
  icon,
  onReset,
  onEnableCursor,
  dialog,
}: {
  sources: readonly UsageLimitSource[];
  icon: (provider: UsageProvider) => ReactNode;
  onReset?: (source: UsageLimitSource) => void;
  onEnableCursor?: () => void;
  dialog: UsageDialogRenderer;
}) {
  const { t, language } = useTranslation(),
    masked = useMaskEmails(),
    now = useNow(30_000);
  const [selected, setSelected] = useState<UsageLimitSource | null>(null);
  const pools = usagePools(sources, now);
  return (
    <div className="usage-limit-grid">
      <ListMotion>
        {pools.map((pool) => (
          <ListMotionItem
            role="region"
            aria-label={HARNESS_TITLE[pool.provider]}
            className="usage-pool"
            key={pool.provider}
            style={
              {
                "--usage-color": usageColor(pool.provider),
              } as React.CSSProperties
            }
          >
            <h2>
              {icon(pool.provider)}
              {HARNESS_TITLE[pool.provider]}
              <small>
                {t("{count} accounts", { count: pool.accounts.length })}
              </small>
            </h2>
            {pool.windows.map((group) => {
              const remaining =
                group.members.reduce(
                  (sum, member) => sum + 100 - member.window.usedPercent,
                  0,
                ) / group.members.length;
              return (
                <div className="usage-pool-window" key={group.id}>
                  <div className="usage-pool-window-title">
                    <span>{usageLimitLabel(group, t)}</span>
                    <strong>
                      {remaining.toFixed(0)}% {t("remaining")}
                    </strong>
                  </div>
                  <div
                    className="usage-pool-bar"
                    aria-label={`${HARNESS_TITLE[pool.provider]} ${usageLimitLabel(group, t)}`}
                  >
                    {group.members.map((member, index) => {
                      const pace = usagePace(member.window, now);
                      return (
                        <button
                          key={`${member.account.environmentKey}:${member.account.id}`}
                          type="button"
                          className="hover:opacity-80 active:opacity-70 usage-pool-segment"
                          onClick={() => setSelected(member.account)}
                          aria-label={`${index + 1}. ${member.account.label}: ${(100 - member.window.usedPercent).toFixed(0)}% ${t("remaining")}`}
                          title={`${member.account.label} · ${(100 - member.window.usedPercent).toFixed(0)}% ${t("remaining")}`}
                        >
                          <span
                            className="usage-pool-remaining"
                            style={{
                              width: `${100 - member.window.usedPercent}%`,
                            }}
                          />
                          {member.window.resetsAt &&
                          member.window.resetsAt > now ? (
                            <span
                              className="usage-pool-refill"
                              style={{
                                left: `${100 - member.window.usedPercent}%`,
                                width: `${member.refillPercent}%`,
                              }}
                            />
                          ) : null}
                          {pace !== null ? (
                            <span
                              className="usage-pool-pace"
                              style={{ left: `${pace}%` }}
                              aria-hidden
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <div className="usage-pool-reset">
                    {[...group.members]
                      .filter(
                        (member) =>
                          member.window.resetsAt &&
                          member.window.resetsAt > now,
                      )
                      .sort((a, b) => a.window.resetsAt! - b.window.resetsAt!)
                      .slice(0, 1)
                      .map((member) => (
                        <span key={member.account.id}>
                          {t("Next refill")}:{" "}
                          {new Date(member.window.resetsAt!).toLocaleString(
                            language,
                          )}
                        </span>
                      ))}
                  </div>
                </div>
              );
            })}
            <div className="usage-pool-accounts">
              <ListMotion>
                {pool.accounts.map((account, index) => (
                  <ListMotionButton
                    key={`${account.environmentKey}:${account.id}`}
                    type="button"
                    onClick={() => setSelected(account)}
                    className="hover:opacity-80 active:opacity-70"
                  >
                    <b>{index + 1}</b>
                    <span>
                      {account.label || HARNESS_TITLE[account.provider]}
                    </span>
                    <small>{account.environmentLabel}</small>
                    {account.status !== "ok" ? (
                      <small>{t("Unavailable")}</small>
                    ) : null}
                  </ListMotionButton>
                ))}
              </ListMotion>
            </div>
            {!pool.windows.length ? (
              <p className="usage-muted">
                {t(
                  pool.accounts[0]?.message ||
                    "This provider does not report subscription limits.",
                )}
              </p>
            ) : null}
            {pool.provider === "cursor" &&
            !pool.windows.length &&
            pool.accounts.some((account) =>
              account.message?.startsWith("Enable Cursor"),
            ) &&
            onEnableCursor ? (
              <Button variant="secondary" onClick={onEnableCursor}>
                {t("Enable Cursor Keychain access")}
              </Button>
            ) : null}
          </ListMotionItem>
        ))}
      </ListMotion>
      {dialog(
        selected
          ? {
              title: [HARNESS_TITLE[selected.provider], selected.label]
                .filter(Boolean)
                .join(" · "),
              onClose: () => setSelected(null),
              children: (
                <div className="usage-account-detail">
                  {selected.email ? (
                    <PrivateEmail email={selected.email} masked={masked} />
                  ) : null}
                  {selected.plan ? (
                    <p>
                      {t("Plan")}: {selected.plan}
                    </p>
                  ) : null}
                  {selected.environmentLabel ? (
                    <p>
                      {t("Login location")}: {selected.environmentLabel}
                    </p>
                  ) : null}
                  {selected.windows.map((window) => (
                    <div key={window.id}>
                      <strong>
                        {usageLimitLabel(window, t)} ·{" "}
                        {window.usedPercent.toFixed(1)}% {t("used")}
                      </strong>
                      <progress
                        max={100}
                        value={window.usedPercent}
                        aria-label={usageLimitLabel(window, t)}
                      />
                      {window.resetsAt ? (
                        <small>
                          {t("Resets")}:{" "}
                          {new Date(window.resetsAt).toLocaleString(language)}
                        </small>
                      ) : null}
                    </div>
                  ))}
                  {selected.message ? (
                    <p className="usage-muted">{t(selected.message)}</p>
                  ) : null}
                  {selected.resetCreditsAvailable !== undefined ? (
                    <p>
                      {t("Rate limit reset credits")}:{" "}
                      {selected.resetCreditsAvailable}
                    </p>
                  ) : null}
                  {selected.resetCreditsAvailable &&
                  onReset &&
                  selected.provider === "codex" ? (
                    <Button
                      onClick={() => {
                        onReset(selected);
                        setSelected(null);
                      }}
                    >
                      {t("Use reset")}
                    </Button>
                  ) : null}
                </div>
              ),
            }
          : null,
      )}
    </div>
  );
}
