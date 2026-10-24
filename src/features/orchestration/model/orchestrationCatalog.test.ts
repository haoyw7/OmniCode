import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../providers/model/harnessAvailability", () => ({
  isHarnessAvailable: vi.fn((id: string) => id === "codex" || id === "claude"),
  probeHarnessAvailability: vi.fn(async () => {}),
}));
vi.mock("../../providers/model/hostModelCatalog", () => ({
  refreshHostModelCatalogs: vi.fn(async () => {}),
}));
import { discoverOrchestrationSettings } from "./orchestrationCatalog";
import { isHarnessAvailable, probeHarnessAvailability } from "../../providers/model/harnessAvailability";
import { refreshHostModelCatalogs } from "../../providers/model/hostModelCatalog";
import { resetHarnessModelOverlays, setHarnessModels } from "../../../integrations/harness/core/modelCatalog";

afterEach(() => {
  resetHarnessModelOverlays();
  vi.clearAllMocks();
  vi.mocked(isHarnessAvailable).mockImplementation(
    (id) => id === "codex" || id === "claude",
  );
});

describe("automatic orchestration catalog", () => {
  it("discovers every installed harness and reads its refreshed models without a user-selected pool", async () => {
    vi.mocked(refreshHostModelCatalogs).mockImplementationOnce(async () => {
      setHarnessModels("codex", [
        { id: "codex:live", harness: "codex", name: "Live Codex" },
      ]);
    });
    const settings = await discoverOrchestrationSettings();
    expect(probeHarnessAvailability).toHaveBeenCalledOnce();
    expect(refreshHostModelCatalogs).toHaveBeenCalledWith(["claude", "codex"]);
    expect(settings.choices).toContainEqual({
      harness: "codex",
      model: "codex:live",
      name: "Live Codex",
    });
    expect(settings.choices.some((choice) => choice.harness === "claude")).toBe(
      true,
    );
    expect(settings.choices.some((choice) => choice.harness === "cursor")).toBe(
      false,
    );
    expect(settings.maxWorkers).toBe(2);
  });
  it("does not truncate catalogs at the former manual-selection limit", async () => {
    setHarnessModels(
      "codex",
      Array.from({ length: 80 }, (_, i) => ({
        id: `codex:${i}`,
        harness: "codex",
        name: `Model ${i}`,
      })),
    );
    const settings = await discoverOrchestrationSettings();
    expect(
      settings.choices.filter((choice) => choice.harness === "codex"),
    ).toHaveLength(80);
  });
  it("fails planning clearly when no harness is available", async () => {
    vi.mocked(isHarnessAvailable).mockReturnValue(false);
    await expect(discoverOrchestrationSettings()).rejects.toThrow(
      "No worker models are available",
    );
  });
});
