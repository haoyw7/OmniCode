import { IS_WIN } from "../../../platform/tauri/platform";
import { parseWslPath, WSL_PATH_PREFIX } from "../../../shared/lib/wslPaths";
import { isLocalProject } from "../../projects/model/recents";

/** Desktop PTYs support native projects and Windows-hosted WSL projects. */
export function supportsProjectTerminal(path: string): boolean {
  return path.startsWith(WSL_PATH_PREFIX)
    ? IS_WIN && !!parseWslPath(path)
    : isLocalProject(path);
}
