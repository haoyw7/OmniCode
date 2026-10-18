import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadProjectFiles,
  peekProjectFiles,
  recentOpenedFiles,
  subscribeProjectFiles,
} from "../../connections/files/model/fileIndex";
import {
  buildMentionIndex,
  rankMentionFiles,
  type MentionIndex,
} from "../../connections/files/model/fileMentions";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { looksLikeProject } from "../../projects/model/recents";
import { loadNotes, peekNotes, rankNoteFiles, notesAsProjectFiles, type Note } from "../../notes";

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
  const [files, setFiles] = useState<ProjectFile[]>(
    () => peekProjectFiles(localCwd) ?? [],
  );
  const [notes, setNotes] = useState<Note[]>(() => peekNotes() ?? []);
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
    let cancelled = false;
    const apply = (next: ProjectFile[]) => {
      if (!cancelled) setFiles(next);
    };
    const cached = peekProjectFiles(localCwd);
    apply(cached ?? []);
    if (!localCwd) return;
    void loadProjectFiles(localCwd, mentionOpen)
      .then(apply)
      .catch(() => undefined);
    const unsub = subscribeProjectFiles(() => {
      const next = peekProjectFiles(localCwd);
      if (next) apply(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [localCwd, mentionOpen]);

  useEffect(() => {
    if (!mentionOpen || !notesEnabled) return;
    let cancelled = false;
    void loadNotes().then((next) => {
      if (!cancelled) setNotes(next);
    });
    return () => {
      cancelled = true;
    };
  }, [mentionOpen, notesEnabled]);

  useEffect(() => {
    setMentionActive(0);
  }, [mentionQuery, cwd]);

  useEffect(() => {
    setMentionActive((index) =>
      rankedFiles.length === 0 ? 0 : Math.min(index, rankedFiles.length - 1),
    );
  }, [rankedFiles.length]);

  return { mentionIndex, mentionIndexRef, rankedFiles, mentionActive, setMentionActive };
}
