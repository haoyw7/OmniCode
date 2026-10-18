import { useMaskEmails } from "../../settings/model/displayPrefs";
import type { ProviderAccountIdentity } from "../model/providerAccountIdentity";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";

export function ProviderAccountSubtitle({
  identity,
  fallback,
  className = "",
}: {
  identity: ProviderAccountIdentity | null | undefined;
  fallback?: string;
  className?: string;
}) {
  const masked = useMaskEmails();
  const name = identity?.name?.trim();
  const account = identity?.email || name || fallback;
  if (!identity?.plan && !identity?.email && !name) {
    return fallback ? (
      <span className={`min-w-0 ${className}`}>{fallback}</span>
    ) : null;
  }

  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1 ${className}`}>
      {identity?.email ? (
        <PrivateEmail masked={masked} key={identity.email} email={identity.email} />
      ) : account ? (
        <span className="min-w-0 truncate" title={account}>{account}</span>
      ) : null}
      {identity?.plan && account ? <span aria-hidden>·</span> : null}
      {identity?.plan ? <span className="shrink-0">{identity.plan}</span> : null}
    </span>
  );
}
