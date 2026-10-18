import type { HostSession } from "../features/connections/model/protocol";
import type { Block } from "../features/sessions/model/session";

/** Retain the transcript and attachment metadata for fast navigation, while
 * releasing downloaded image bytes from older cached conversations. */
export function withoutSessionPreviewData(snapshot: HostSession): HostSession {
  const visit = (rows: Block[]): Block[] => {
    let changed = false;
    const next = rows.map((original) => {
      let block = original;
      if (block.agentRun?.transcript) {
        const transcript = visit(block.agentRun.transcript);
        if (transcript !== block.agentRun.transcript)
          block = { ...block, agentRun: { ...block.agentRun, transcript } };
      }
      if (block.attachments?.some((file) => file.kind === "image" && file.data !== undefined)) {
        block = { ...block, attachments: block.attachments.map((file) => {
          if (file.kind !== "image" || file.data === undefined) return file;
          const { data: _data, ...metadata } = file;
          return metadata;
        }) };
      }
      if (block !== original) changed = true;
      return block;
    });
    return changed ? next : rows;
  };
  const blocks = visit(snapshot.session.blocks);
  return blocks === snapshot.session.blocks ? snapshot
    : { ...snapshot, session: { ...snapshot.session, blocks } };
}
