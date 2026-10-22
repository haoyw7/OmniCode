import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import {
  UsageDashboard,
  type UsageSelectProps,
} from "../features/usage/ui/UsageDashboard";
import type { UsageTransport } from "../features/usage/model/usageTransport";
import { HarnessIcon } from "../shared/ui/branding/HarnessIcon";
import { queryClient } from "../shared/lib/queryClient";
import { MobileSelect } from "./MobileSelect";
import { MobileSheet, SHEET_WIDTH } from "./MobileSheet";
import { MobileSheetPresence } from "./MobileSheetPresence";
import { mobileSourceKey } from "./mobileQueries";
import type { MobileClient } from "./client";
import "./styles/usage.css";
function UsageSelect(props: UsageSelectProps) {
  const [open, setOpen] = useState(false);
  return (
    <MobileSelect
      {...props}
      id={`mobile-usage-${props.label}`}
      open={open}
      onOpenChange={setOpen}
    />
  );
}
export function MobileUsage({
  client,
  enabled,
}: {
  client: MobileClient;
  enabled: boolean;
}) {
  const saved = useQuery(
    {
      queryKey: [
        "mobile",
        "usageConnections",
        mobileSourceKey(client),
        client.connection?.environmentId,
        enabled,
      ],
      queryFn: () => client.savedConnections(),
      staleTime: 60_000,
    },
    queryClient,
  );
  const refresh = useRef<() => void>(() => {}),
    touch = useRef<number | null>(null);
  const environments = useMemo<UsageTransport[]>(() => {
    const unique = new Map(
      [
        ...(saved.data ?? []),
        ...(client.connection ? [client.connection] : []),
      ].map((connection) => [connection.environmentId, connection]),
    );
    return [...unique.values()].map((connection) => ({
      sourceKey: JSON.stringify([
        "mobile",
        mobileSourceKey(client),
        connection.environmentId,
        connection.endpoint,
      ]),
      label: connection.name,
      enabled: !connection.disabled,
      summary: (input) =>
        client.usageRequest(connection, "usage.summary", input),
      limits: (force) =>
        client.usageRequest(connection, "usage.limits", { refresh: force }),
      progress: () => client.usageRequest(connection, "usage.progress", {}),
      update: (patch) =>
        client.usageRequest(connection, "usage.settings.update", patch),
      reset: (accountId, creditId) =>
        client.usageRequest(connection, "usage.limits.reset", {
          accountId,
          creditId,
          idempotencyKey: crypto.randomUUID(),
        }),
    }));
  }, [client, saved.data, client.connection, enabled]);
  return (
    <div
      data-platform={Capacitor.getPlatform()}
      onTouchStart={(event) => {
        const scroller =
          event.currentTarget.closest<HTMLElement>(".mobile-content");
        touch.current =
          scroller?.scrollTop === 0 &&
          !(
            event.target instanceof Element &&
            event.target.closest("button, input, a, [role=tab]")
          )
            ? (event.touches[0]?.clientY ?? null)
            : null;
      }}
      onTouchEnd={(event) => {
        if (
          touch.current !== null &&
          event.changedTouches[0]?.clientY - touch.current > 80
        )
          refresh.current();
        touch.current = null;
      }}
      onTouchCancel={() => {
        touch.current = null;
      }}
    >
      <UsageDashboard
        environments={environments}
        mobile
        icon={(provider) => <HarnessIcon harness={provider} />}
        select={(props) => <UsageSelect {...props} />}
        onRefreshReady={(next) => {
          refresh.current = next;
        }}
        toolbar={(controls) => {
          const host = document.getElementById("mobile-usage-actions");
          return host ? (
            createPortal(controls, host)
          ) : (
            <div className="usage-mobile-actions">{controls}</div>
          );
        }}
        dialog={(props) => (
          <MobileSheetPresence open={!!props}>
            {props ? (
              <MobileSheet
                title={props.title}
                header={{ title: props.title }}
                onClose={props.onClose}
                placement="bottom"
                width={SHEET_WIDTH.form}
                surface="solid"
              >
                <div className="usage-dialog-content">{props.children}</div>
              </MobileSheet>
            ) : null}
          </MobileSheetPresence>
        )}
      />
    </div>
  );
}
