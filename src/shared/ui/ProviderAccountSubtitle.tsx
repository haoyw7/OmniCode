import { PrivateEmail } from "./PrivateEmail";

export function ProviderAccountSubtitle({
  identity,
  masked,
  fallback,
  className = "",
}: {
  identity: { email?: string | null; name?: string | null; plan?: string | null } | null | undefined;
  masked: boolean;
  fallback?: string;
  className?: string;
}) {
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
