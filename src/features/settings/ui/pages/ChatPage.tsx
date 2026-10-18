import { usePreferenceState } from "../../model/usePreferenceState";
import { useTranslation } from "../../../../shared/i18n/useTranslation";
import { useContext, useEffect } from "react";
import { TitleModelSettings } from "../TitleModelSettings";
import {
  loadTranscriptLayout,
  loadTranscriptAnchor,
  saveTranscriptLayout,
  saveTranscriptAnchor,
  TRANSCRIPT_ANCHOR_CHANGE_EVENT,
  type TranscriptLayout,
} from "../../model/appearance";
import {
  loadDiffViewer,
  loadFollowUpBehavior,
  loadFormatOnSave,
  loadModelControls,
  saveDiffViewer,
  saveFollowUpBehavior,
  saveFormatOnSave,
  saveModelControls,
  type DiffViewer,
  type FollowUpBehavior,
  type ModelControls,
} from "../../model/settings";
import { Group, RevealedSetting, Row, Segmented, Toggle } from "../settingsLayout";



export function ChatPage() {
  const { t: uiT } = useTranslation();
  const revealed = useContext(RevealedSetting);
  const [transcriptLayout, setTranscriptLayout] =
    usePreferenceState<TranscriptLayout>(loadTranscriptLayout);
  const [transcriptAnchor, setTranscriptAnchor] =
    usePreferenceState(loadTranscriptAnchor);
  const [followUpBehavior, setFollowUpBehavior] =
    usePreferenceState<FollowUpBehavior>(loadFollowUpBehavior);
  const [modelControls, setModelControls] =
    usePreferenceState<ModelControls>(loadModelControls);
  const [diffViewer, setDiffViewer] = usePreferenceState<DiffViewer>(loadDiffViewer);
  const [formatOnSave, setFormatOnSave] = usePreferenceState(loadFormatOnSave);

  useEffect(() => {
    const onAnchor = (event: Event) => {
      setTranscriptAnchor((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener(TRANSCRIPT_ANCHOR_CHANGE_EVENT, onAnchor);
    return () => {
      window.removeEventListener(TRANSCRIPT_ANCHOR_CHANGE_EVENT, onAnchor);
    };
  }, []);

  const onTranscriptLayout = (next: TranscriptLayout) => {
    saveTranscriptLayout(next);
    setTranscriptLayout(next);
  };

  const onTranscriptAnchor = (next: boolean) => {
    saveTranscriptAnchor(next);
    setTranscriptAnchor(next);
  };

  const onFollowUpBehavior = (next: FollowUpBehavior) => {
    saveFollowUpBehavior(next);
    setFollowUpBehavior(next);
  };

  const onModelControls = (next: ModelControls) => {
    saveModelControls(next);
    setModelControls(next);
  };

  const onDiffViewer = (next: DiffViewer) => {
    saveDiffViewer(next);
    setDiffViewer(next);
  };

  const onFormatOnSave = (next: boolean) => {
    saveFormatOnSave(next);
    setFormatOnSave(next);
  };

  return (
    <>
      <Group id="title-model" title={uiT("Session titles")} description={uiT("Choose a separate API for automatic title generation.")}>
        <TitleModelSettings revealed={revealed === "title-model"} />
      </Group>
      <Group
        title={uiT("Transcript")}
        description={uiT("How a conversation reads as it grows.")}
      >
        <Row
          id="transcript-layout"
          label={uiT("Transcript layout")}
          description={uiT(
            "User messages appear as right-aligned bubbles. Full width lets longer messages use more space; Chat limits their width like a messaging app.",
          )}
        >
          <Segmented
            label={uiT("Transcript layout")}
            value={transcriptLayout}
            options={[
              { value: "full", label: uiT("Full width") },
              { value: "chat", label: uiT("Chat") },
            ]}
            onChange={onTranscriptLayout}
          />
        </Row>
        <Row
          id="anchor-prompts"
          label={uiT("Anchor prompts to top")}
          description={uiT(
            "When you send, the new prompt sits at the top of the transcript and the reply grows into the space below. Turn this off to keep the classic layout, with the latest message resting on the composer.",
          )}
        >
          <Toggle
            label={uiT("Anchor prompts to top")}
            on={transcriptAnchor}
            onChange={onTranscriptAnchor}
          />
        </Row>
      </Group>

      <Group
        title={uiT("Composer")}
        description={uiT("What the composer does with what you type.")}
      >
        <Row
          id="follow-up"
          label={uiT("Follow-up behavior")}
          description={uiT(
            "Queue follow-ups until the active turn finishes, or steer the active turn immediately.",
          )}
        >
          <Segmented
            label={uiT("Follow-up behavior")}
            value={followUpBehavior}
            options={[
              { value: "queue", label: uiT("Queue") },
              { value: "steer", label: uiT("Steer") },
            ]}
            onChange={onFollowUpBehavior}
          />
        </Row>
        <Row
          id="model-controls"
          label={uiT("Model controls")}
          description={uiT(
            "Show model options beside the picker instead of inside the model menu.",
          )}
        >
          <Segmented
            label={uiT("Model controls")}
            value={modelControls}
            options={[
              { value: "menu", label: uiT("Menu") },
              { value: "beside", label: uiT("Beside") },
            ]}
            onChange={onModelControls}
          />
        </Row>
      </Group>

      <Group
        title={uiT("Editor")}
        description={uiT(
          "What happens when you save a file in the workspace editor.",
        )}
      >
        <Row
          id="format-on-save"
          label={uiT("Format on save")}
          description={uiT(
            "Run Prettier on supported files before writing. Off keeps the text you typed, including quote style.",
          )}
        >
          <Toggle
            label={uiT("Format on save")}
            on={formatOnSave}
            onChange={onFormatOnSave}
          />
        </Row>
      </Group>

      <Group
        title={uiT("Code review")}
        description={uiT(
          "Where a turn's changes open when you go to read them.",
        )}
      >
        <Row
          id="diff-view"
          label={uiT("Diff view")}
          description={uiT(
            "Editor keeps working-tree changes in the file. Unified stacks every changed file in one review, with sticky headers and collapsed unchanged lines.",
          )}
        >
          <Segmented
            label={uiT("Diff view")}
            value={diffViewer}
            options={[
              { value: "editor", label: uiT("Editor") },
              { value: "unified", label: uiT("Unified") },
            ]}
            onChange={onDiffViewer}
          />
        </Row>
      </Group>
    </>
  );
}
