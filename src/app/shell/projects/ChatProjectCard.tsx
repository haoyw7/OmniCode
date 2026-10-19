import { IconButton } from "../../../shared/ui/forms/IconButton";
import { useSidebarListPreview } from "../useSidebarListPreview";
import { AnimatedCollapse } from "../../../shared/ui/AnimatedCollapse";
import { useTranslation } from "../../../shared/i18n/useTranslation";
import { Plus } from "../../../shared/ui/icons";
import { useContext, useId, useState } from "react";
import { useAnimatedReorder } from "../../../shared/hooks/useAnimatedReorder";
import {
  loadSidebarChatOrder,
  orderSidebarChats,
  reorderSidebarChats,
  saveSidebarChatOrder,
} from "../../model/sidebarChatOrder";
import { sidebarDragPreview } from "../SidebarEntryReorder";
import {
  PROJECT_COLLAPSE_DURATION_MS,
  type ProjectListEntry,
  SidebarSectionReorderContext,
} from "./projectListShared";
import { ProjectSectionHeader } from "./ProjectSectionHeader";
import { SidebarEntry } from "./SidebarEntry";



const CHAT_PROJECT_EXPANDED_KEY = "omnicode.chatProjectExpanded.v1";

/** Projectless chats grouped above workflows and projects. */
export function ChatProjectCard({
  entries,
  searchActive,
  onNewChat,
}: {
  entries: ProjectListEntry[];
  searchActive: boolean;
  onNewChat?: () => void;
}) {
  const { t: uiT } = useTranslation();
  const contentId = useId();
  const sectionReorder = useContext(SidebarSectionReorderContext);
  const sectionDragging = sectionReorder?.sortable.draggingId === "chats";
  const [stored, setStored] = useState(
    () => localStorage.getItem(CHAT_PROJECT_EXPANDED_KEY) !== "false",
  );
  const expanded = stored || (searchActive && entries.length > 0);
  const toggle = () =>
    setStored((value) => {
      try {
        localStorage.setItem(CHAT_PROJECT_EXPANDED_KEY, String(!value));
      } catch {
        // private mode / quota
      }
      return !value;
    });
  const [order, setOrder] = useState(loadSidebarChatOrder);
  const rows = orderSidebarChats(
    entries.map((entry) => ({ id: `chat:${entry.id}`, entry })),
    order,
  );
  const preview = useSidebarListPreview(
    entries.length,
    searchActive ? "search" : "",
    searchActive,
    { expanded },
  );
  const sortable = useAnimatedReorder(
    rows.slice(0, preview.count).map((row) => row.id),
    (visible) => {
      const next = reorderSidebarChats(order, rows.map((row) => row.id), visible);
      saveSidebarChatOrder(next);
      setOrder(next);
    },
    "y",
    undefined,
    { activationDistance: 3, floatingPreview: sidebarDragPreview },
  );
  if (searchActive && entries.length === 0) return null;
  return (
    <div data-chat-project className="relative shrink-0">
      <ProjectSectionHeader
        label={uiT("Chats")}
        expanded={expanded}
        contentId={contentId}
        onToggleExpanded={toggle}
      >
        {onNewChat ? (
          <IconButton
            size="sm"
            shape="square"
            data-sidebar-toolbar-action
            label={uiT("New chat")}
            onClick={onNewChat}
            className="opacity-0 group-hover/section:opacity-100 group-has-[:focus-visible]/section:opacity-100"
          >
            <Plus />
          </IconButton>
        ) : null}
      </ProjectSectionHeader>
      <AnimatedCollapse
        keepMounted
        expanded={expanded && !sectionDragging}
        motion="height"
        className="project-tree-collapse"
        durationMs={PROJECT_COLLAPSE_DURATION_MS}
        animateContentResize
      >
        {() => (
          <div id={contentId} data-chat-project-children className="px-2">
            {entries.length === 0 ? (
              <p className="px-2 py-1 text-[11px] leading-tight text-content/40">
                {uiT("Chats you start will show up here")}
              </p>
            ) : null}
            {rows.slice(0, preview.mountedCount).map(({ id, entry }, index) => (
              <AnimatedCollapse key={id} expanded={index < preview.count}>
                {() => (
                  <SidebarEntry entry={entry} id={id} sortable={sortable} />
                )}
              </AnimatedCollapse>
            ))}
            {preview.button}
          </div>
        )}
      </AnimatedCollapse>
    </div>
  );
}
