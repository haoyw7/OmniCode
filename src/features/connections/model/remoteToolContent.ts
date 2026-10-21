import type { ToolContentSource, ToolContentPage, ToolContentSearchPage } from "../../../integrations/harness/core/toolContent";
import { remoteRequest } from "./connections";

export function remoteToolContentSource(machineId: string, environmentId: string, sessionId: string): ToolContentSource {
  return {
    key: ["desktop", machineId, environmentId, sessionId],
    async read(request, signal) {
      signal?.throwIfAborted();
      if (request.sessionId !== sessionId) throw new Error("Invalid tool content session");
      const page = await remoteRequest<ToolContentPage>(machineId, "sessions.toolContent.read", request);
      signal?.throwIfAborted();
      return page;
    },
    async search(query, offset, signal) {
      signal?.throwIfAborted();
      const page = await remoteRequest<ToolContentSearchPage>(machineId, "sessions.toolContent.search", { sessionId, query, offset });
      signal?.throwIfAborted();
      return page;
    },
  };
}
