import assert from "node:assert/strict";
import test from "node:test";
import { buildRadarSummary, collectFlavorTags } from "../app/ui/sample-summary-model";

test("radar summary averages temperature-stage observations", () => {
  const observations = [
    { stageId: "high_temp" as const, fieldKey: "acidity_intensity", value: 8 },
    { stageId: "mid_temp" as const, fieldKey: "acidity_intensity", value: 6 },
    { stageId: "low_temp" as const, fieldKey: "sweetness_intensity", value: 7 },
    { stageId: "mid_temp" as const, fieldKey: "flavor_tags", value: ["jasmine", "citrus"] },
    { stageId: "low_temp" as const, fieldKey: "flavor_tags", value: ["citrus", "honey"] }
  ];

  const radar = buildRadarSummary(observations);
  assert.equal(radar.find((axis) => axis.key === "acidity_intensity")?.value, 7);
  assert.equal(radar.find((axis) => axis.key === "sweetness_intensity")?.value, 7);
  assert.deepEqual(collectFlavorTags(observations), ["jasmine", "citrus", "honey"]);
});
