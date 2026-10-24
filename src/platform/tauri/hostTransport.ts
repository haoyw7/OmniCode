import { invoke } from "@tauri-apps/api/core";
import type { HttpPort } from "../../client/ports";

export const desktopHostHttp: HttpPort<string> = {
  key: (machineId) => machineId,
  request: (machineId, method, params) => invoke("remote_request", { machineId, method, params }),
};
