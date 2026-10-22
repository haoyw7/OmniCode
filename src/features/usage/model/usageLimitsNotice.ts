import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { BuiltinSkill } from "../../skills/model/skills";
import type { UsageTransport } from "./usageTransport";
import { queryClient } from "../../../shared/lib/queryClient";
import { translate } from "../../../shared/i18n/language";
export const USAGE_LIMITS_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "usage-limits",
  invocation: "usage-limits",
  description:
    "Show subscription limits without sending a message to the agent.",
  scope: "builtin",
  source: "omnicode",
};
export const isUsageLimitsCommand = (text: string) =>
  text.trim().toLowerCase() === "/usage-limits";
export type UsageLimitsNoticeSource = Pick<
  UsageTransport,
  "sourceKey" | "limits"
>;
export function useUsageLimitsNotice(
  source: UsageLimitsNoticeSource | undefined,
  sessionKey: string | undefined,
  provider: string,
  messageKey?: string | number,
) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [source?.sourceKey, sessionKey, messageKey]);
  const query = useQuery(
    {
      queryKey: ["usage", source?.sourceKey ?? "disconnected", "limits"],
      enabled: open && !!source && !!sessionKey,
      staleTime: 300_000,
      queryFn: async ({ signal }) => {
        const value = await source!.limits(false);
        signal.throwIfAborted();
        return value;
      },
    },
    queryClient,
  );
  return {
    open,
    loading: query.isPending,
    error: query.error?.message,
    sources:
      query.data?.filter((account) => account.provider === provider) ?? [],
    close: () => setOpen(false),
    show: () => {
      if (!sessionKey) {
        toast.message(
          translate(
            "Send /usage-limits in an existing conversation, or open Settings → Usage → Limits.",
          ),
        );
        return;
      }
      if (!source) {
        toast.error(translate("Connect to a Host to view usage."));
        return;
      }
      setOpen(true);
    },
  };
}
