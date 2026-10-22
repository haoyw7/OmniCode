import { create } from "zustand";
import { persist } from "zustand/middleware";
export type UsageMetric = "cost" | "tokens" | "limits";
export const useUsagePreferences = create(
  persist<{
    metric: UsageMetric;
    days: number;
    hidden: string[];
    save: (
      patch: Partial<{ metric: UsageMetric; days: number; hidden: string[] }>,
    ) => void;
  }>(
    (set) => ({
      metric: "limits",
      days: 30,
      hidden: [],
      save: (patch) => set(patch),
    }),
    { name: "omnicode.usage.preferences.v1" },
  ),
);
