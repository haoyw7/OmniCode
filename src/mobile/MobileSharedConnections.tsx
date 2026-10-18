import { Button } from "../shared/ui/forms/Button";
import { useEffect, useState } from "react";
import { useHostConnections } from "../features/connections/model/hostConnections";
import type { HostConnectionDefinition } from "../features/connections/model/hostState";
import { useTranslation } from "../shared/i18n/useTranslation";
import type { MobileClient } from "./client";

/** Directory entries are hints: this phone still pairs using its own URL and token. */
export function MobileSharedConnections({ client, onPair }: {
  client: MobileClient;
  onPair: (definition: HostConnectionDefinition) => void;
}) {
  const { t } = useTranslation();
  const directory = useHostConnections();
  const [paired, setPaired] = useState<string[]>([]);
  const environmentId = client.connection?.environmentId;
  useEffect(() => {
    let live = true;
    void client.savedConnections().then((connections) => {
      if (live) setPaired(connections.map((entry) => entry.environmentId));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [client, environmentId, directory.connections]);
  const unpaired = directory.connections.filter((entry) => entry.environmentId !== environmentId && !paired.includes(entry.environmentId ?? ""));
  if (!unpaired.length && !directory.pending) return null;
  return <section className="mobile-settings-group" aria-label={t("Shared connections")}>
    <h2>{t("Shared connections")}</h2>
    <ul className="mobile-connection-list">
      {unpaired.map((entry) => <li key={entry.id} className="mobile-settings-row">
        <div className="mobile-connection-details">
          <span>{entry.name}</span>
          <span className="mobile-muted">{t("Not paired on this device")}</span>
        </div>
        <Button variant="secondary" type="button" onClick={() => onPair(entry)}>{t("Pair this device")}</Button>
      </li>)}
    </ul>
    {directory.pending && <p className="mobile-muted" role="status">{t("Not yet synced")}</p>}
  </section>;
}
