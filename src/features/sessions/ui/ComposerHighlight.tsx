import { StickyNote } from "../../../shared/ui/icons";
import { fileMentionParts } from "../../connections/files/model/fileMentions";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { skillTextParts } from "../../skills/model/skills";
import { FileTypeIcon } from "../../connections/files/ui/FileTypeIcon";
import { isNoteMentionPath } from "../../notes";
import { ModeCommandText, type ModeCommandToken } from "./modeCommands";
import { mcpTagParts, type McpTag } from "../model/mcpPicker";

export function ComposerHighlight({
  text,
  mode,
  names,
  mentions,
  mcpTags,
}: {
  text: string;
  mode: ModeCommandToken | null;
  names: ReadonlySet<string>;
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags: McpTag[];
}) {
  const rest = mode ? text.slice(mode.end) : text;
  const parts = skillTextParts(rest, names);
  return (
    <>
      {mode ? <ModeCommandText text={text} mode={mode} /> : null}
      {parts.map((part, index) =>
        part.skill ? (
          <span key={index} className="text-skill">
            {part.text}
          </span>
        ) : (
          // Skill tokens always end on whitespace, so each remaining run still
          // starts on a boundary `@mention` matching can rely on.
          <MentionRuns
            key={index}
            text={part.text}
            mentions={mentions}
            mcpTags={mcpTags}
          />
        ),
      )}
      {text.endsWith("\n") ? "\n" : null}
    </>
  );
}

function MentionRuns({
  text,
  mentions,
  mcpTags,
}: {
  text: string;
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags: McpTag[];
}) {
  return (
    <>
      {mcpTagParts(text, mcpTags).map((part, index) =>
        part.tag ? (
          <span
            key={index}
            className="text-mention"
            data-mcp-tag={part.tag.token}
          >
            {part.text}
          </span>
        ) : (
          <FileMentionRuns key={index} text={part.text} mentions={mentions} />
        ),
      )}
    </>
  );
}

function FileMentionRuns({
  text,
  mentions,
}: {
  text: string;
  mentions: ReadonlyMap<string, ProjectFile>;
}) {
  const parts = fileMentionParts(text, mentions);
  return (
    <>
      {parts.map((part, index) =>
        part.file ? (
          <span key={index} className="text-mention">
            {/* The `@` keeps its width so the textarea underneath stays in
                lockstep; the file icon sits on top of it. */}
            <span className="relative text-transparent">
              {"@"}
              {/* `indent-0`: a leading mode command indents the first line,
                  and this box would otherwise inherit that indent. */}
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 indent-0">
                {part.file && isNoteMentionPath(part.file.path) ? (
                  <StickyNote className="size-3.5" />
                ) : (
                  <FileTypeIcon
                    name={part.file.name}
                    isDir={Boolean(part.file.isDir)}
                    size={13}
                  />
                )}
              </span>
            </span>
            {part.text.slice(1)}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
