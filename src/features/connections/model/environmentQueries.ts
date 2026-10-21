import { queryOptions } from "@tanstack/react-query";
import { listWslDistributions } from "../../../platform/tauri/wsl";

export const wslDistributionsQuery = () => queryOptions({
  queryKey: ["environments", "wsl", "distributions"],
  queryFn: listWslDistributions,
});
