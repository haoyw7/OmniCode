import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { BackgroundTaskItem } from "./backgroundTasks";

type PanelState = {
  tasks: BackgroundTaskItem[];
  cleared: ReadonlySet<string>;
  onStop?: (taskId: string) => Promise<void>;
  clockOffsetMs: number;
  source?: symbol;
  selectedTaskId?: string;
  request: number;
};
const empty: PanelState = { tasks: [], cleared: new Set(), clockOffsetMs: 0, request: 0 };
export const backgroundTaskPanels = createStore<Record<string, PanelState>>(() => ({}));

export function useBackgroundTaskPanel(sessionId: string) {
  return useStore(backgroundTaskPanels, state => state[sessionId] ?? empty);
}

export function publishBackgroundTaskPanel(sessionId: string, source: symbol, tasks: BackgroundTaskItem[], onStop: PanelState["onStop"], clockOffsetMs: number) {
  backgroundTaskPanels.setState(state => ({ [sessionId]: { ...(state[sessionId] ?? empty), source, tasks, onStop, clockOffsetMs } }));
}

export function releaseBackgroundTaskPanel(sessionId: string, source: symbol) {
  const state = backgroundTaskPanels.getState()[sessionId];
  if (state?.source === source) backgroundTaskPanels.setState({ [sessionId]: { ...state, source: undefined, onStop: undefined } });
}

export function requestBackgroundTaskPanel(sessionId: string, selectedTaskId?: string) {
  backgroundTaskPanels.setState(state => {
    const current = state[sessionId] ?? empty;
    return { [sessionId]: { ...current, selectedTaskId, request: current.request + 1 } };
  });
}

export function clearFinishedBackgroundTasks(sessionId: string) {
  backgroundTaskPanels.setState(state => {
    const current = state[sessionId] ?? empty;
    return { [sessionId]: { ...current, cleared: new Set([...current.cleared, ...current.tasks.filter(task => task.state !== "running").map(task => task.id)]) } };
  });
}

export function visibleBackgroundTasks(state: PanelState) {
  return state.tasks.filter(task => task.state === "running" || !state.cleared.has(task.id));
}
