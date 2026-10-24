import type { ComponentProps } from "react";
import { NotesView } from "../../features/notes/ui/NotesView";
import { SearchableProjectPicker } from "../../features/projects/ui/SearchableProjectPicker";
import { BotTopicNote } from "../../features/bots/ui/BotTopicNote";

export function NotesPage(props: Omit<ComponentProps<typeof NotesView>, "ProjectPicker" | "TopicNote">) {
  return <NotesView {...props} ProjectPicker={SearchableProjectPicker} TopicNote={BotTopicNote} />;
}
