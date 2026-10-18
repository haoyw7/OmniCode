import { useMemo, useState } from "react";
import { Button } from "../../../../../shared/ui/forms/Button";
import { ReadonlyTextView } from "../../../../../shared/ui/ReadonlyTextView";
import { useTranslation } from "../../../../../shared/i18n/useTranslation";
import { MessageResponse } from "../../components/ai-elements/message";
import { useWorkflowRunArtifactBytes } from "../../hooks/useWorkflowRunArtifactBytes";
import { useWorkflowRunArtifactData } from "../../hooks/useWorkflowRunArtifactData";
import type { WorkflowRunArtifactView } from "../../hooks/useWorkflowRunArtifacts";
import { useWorkflowIntl } from "../../i18n/IntlProvider";
import { ArtifactPresetBody } from "./ArtifactPresetBody";
import { artifactDisplayTitle, buildPresetLabels, isArtifactPresetKind } from "./artifactPresentation";

type ArtifactProps = {
  artifact: WorkflowRunArtifactView;
  sessionId: string;
  runId: string;
  storedLocally?: boolean;
  onRevealStoredFile?: (path: string) => Promise<void>;
};

export function WorkflowArtifactContent({ artifact, sessionId, runId, storedLocally, onRevealStoredFile }: ArtifactProps) {
  const { intl } = useWorkflowIntl();
  const { t } = useTranslation();
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const preset = isArtifactPresetKind(artifact.kind);
  const bytes = useWorkflowRunArtifactBytes({ sessionId, runId, artifactId: artifact.id,
    version: artifact.version, enabled: !preset });
  const data = useWorkflowRunArtifactData({ sessionId, runId, artifactId: artifact.id,
    itemCount: artifact.itemCount, enabled: preset });
  const labels = useMemo(() => buildPresetLabels((descriptor, values) => intl.formatMessage(descriptor, values)), [intl]);
  const mediaType = (bytes.mediaType ?? artifact.contentType ?? "").split(";")[0].trim().toLowerCase();
  const markdown = artifact.kind === "markdown" || mediaType === "text/markdown";
  const textual = markdown || mediaType.startsWith("text/") || /^(application\/(json|xml|javascript))$/.test(mediaType);
  const text = useMemo(() => textual && bytes.bytes ? new TextDecoder().decode(bytes.bytes) : "", [textual, bytes.bytes]);
  const message = (name: string) => intl.formatMessage({ id: `chat.toolCall.workflow.run.artifacts.${name}` });
  const error = preset ? data.error : bytes.error;
  const reveal = async () => {
    if (!bytes.storedPath || !onRevealStoredFile || revealing) return;
    setRevealError(null);
    setRevealing(true);
    try { await onRevealStoredFile(bytes.storedPath); }
    catch (cause) { setRevealError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRevealing(false); }
  };
  if (error) return <div role="alert"><p>{message("loadError")}</p><p className="whitespace-pre-wrap break-words text-ui-sm">{error}</p></div>;
  if (preset ? data.loading : bytes.loading || bytes.bytes === null) return <p role="status">{message("loading")}</p>;
  if (preset) {
    if (data.unavailable) return <p>{message("unavailable")}</p>;
    return <ArtifactPresetBody artifact={artifact} items={data.items} labels={labels}
      missingLabel={message("unavailable")} invalidLabel={message("presetInvalid")} />;
  }
  return (
    <div className="flex min-h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {bytes.objectUrl && (
          <Button asChild variant="secondary" size="sm">
            <a href={bytes.objectUrl} download={artifact.sourcePath?.split(/[\\/]/).pop() || artifact.title || artifact.id}>{t("Save as…")}</a>
          </Button>
        )}
        {storedLocally && bytes.storedPath && onRevealStoredFile && (
          <Button variant="secondary" size="sm" disabled={revealing} onClick={() => void reveal()}>
            {t("Show in folder")}
          </Button>
        )}
      </div>
      {bytes.storedPath && (
        <p className="break-all text-ui-sm text-foreground-subtle">
          {t(storedLocally ? "Saved on this computer" : "Saved on Host")}: <span className="select-text">{bytes.storedPath}</span>
        </p>
      )}
      {revealError && <p role="alert" className="text-ui-sm">{t("Could not show the artifact in its folder.")} {revealError}</p>}
      {markdown ? <MessageResponse>{text}</MessageResponse>
        : mediaType === "text/html" ? <iframe title={artifactDisplayTitle(artifact)} sandbox="" srcDoc={text} className="min-h-[60vh] w-full flex-1 border-0 bg-white" />
        : textual ? <ReadonlyTextView text={text} stateKey={`artifact:${runId}:${artifact.id}:${artifact.version}`} />
        : mediaType.startsWith("image/") && bytes.objectUrl ? <img src={bytes.objectUrl} alt={artifactDisplayTitle(artifact)} className="max-w-full self-center object-contain" />
        : mediaType === "application/pdf" && bytes.objectUrl ? <iframe title={artifactDisplayTitle(artifact)} src={bytes.objectUrl} className="min-h-[60vh] w-full flex-1 border-0" />
        : <p>{t("No preview is available for this file type.")}</p>}
    </div>
  );
}
