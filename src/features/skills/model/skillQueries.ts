import { queryOptions } from "@tanstack/react-query";
import { listSkills } from "../../../platform/tauri/fs";

export const skillKeys = {
  all: ["skills"] as const,
  list: (cwd: string) => ["skills", "list", cwd] as const,
  document: (path: string) => ["skills", "document", path] as const,
};
export const skillsQuery = (cwd: string) => queryOptions({ queryKey: skillKeys.list(cwd), queryFn: () => listSkills(cwd) });
