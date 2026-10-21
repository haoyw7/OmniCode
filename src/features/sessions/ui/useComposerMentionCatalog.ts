import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import {
  projectFilesQuery,
  recentOpenedFiles,
} from "../../connections/files/model/fileIndex";
import {
  buildMentionIndex,
  rankMentionFiles,
  type MentionIndex,
} from "../../connections/files/model/fileMentions";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { looksLikeProject } from "../../projects/model/recents";
import { rankNoteFiles, notesAsProjectFiles, notesQuery, type Note } from "../../notes";

const EMPTY_FILES: ProjectFile[] = [];
const EMPTY_NOTES: Note[] = [];

/** Project files and notes offered by an open `@` mention, ranked for its query. */
export function useComposerMentionCatalog({
  localCwd,
  executionCwd,
  cwd,
  mentionOpen,
  mentionQuery,
  notesEnabled,
}: {
  localCwd: string;
  executionCwd: string;
  cwd: string;
  mentionOpen: boolean;
  mentionQuery: string | undefined;
  notesEnabled: boolean;
}) {
  const fileQuery = useQuery({
    ...projectFilesQuery(localCwd),
    enabled: looksLikeProject(localCwd),
  }, queryClient);
  const { refetch: refreshFiles } = fileQuery;
  useEffect(() => {
    if (mentionOpen && looksLikeProject(localCwd)) void refreshFiles({ cancelRefetch: false });
  }, [mentionOpen, localCwd, refreshFiles]);
  const noteQuery = useQuery({ ...notesQuery(), enabled: mentionOpen && notesEnabled }, queryClient);
  const files = fileQuery.data ?? EMPTY_FILES;
  const notes = noteQuery.data ?? EMPTY_NOTES;
  const [mentionActive, setMentionActive] = useState(0);
  const mentionFiles = useMemo(
    () => (notesEnabled ? [...files, ...notesAsProjectFiles(notes)] : files),
    [files, notes, notesEnabled],
  );
  const mentionIndex = useMemo(
    () => buildMentionIndex(mentionFiles),
    [mentionFiles],
  );
  const mentionIndexRef = useRef<MentionIndex>(mentionIndex);
  mentionIndexRef.current = mentionIndex;
  const rankedFiles = useMemo(() => {
    if (!mentionOpen) return [];
    const fileHits = looksLikeProject(executionCwd)
      ? rankMentionFiles(
          files,
          mentionQuery ?? "",
          recentOpenedFiles(executionCwd),
        )
      : [];
    const noteHits = notesEnabled
      ? rankNoteFiles(notes, mentionQuery ?? "")
      : [];
    const seen = new Set(noteHits.map((file) => file.path));
    return [...noteHits, ...fileHits.filter((file) => !seen.has(file.path))];
  }, [executionCwd, files, mentionQuery, mentionOpen, notes, notesEnabled]);

  useEffect(() => {
    setMentionActive(0);
  }, [mentionQuery, cwd]);

  useEffect(() => {
    setMentionActive((index) =>
      rankedFiles.length === 0 ? 0 : Math.min(index, rankedFiles.length - 1),
    );
  }, [rankedFiles.length]);

  return { mentionIndex, mentionIndexRef, rankedFiles, mentionActive, setMentionActive, filesLoading: fileQuery.isLoading };
}
