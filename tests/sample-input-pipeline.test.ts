import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeAndValidateImportBundle, validateSampleInput, type CoffeeFoundationGateway } from "../app/core/sample-input-pipeline";

const gateway: CoffeeFoundationGateway = {
  resolve(field, value) {
    return { field, rawValue: value, normalizedValue: value, status: value === "Unknown" ? "unknown" : "confirmed", reason: value === "Unknown" ? "no-match" : "unique-core-match", selected: { canonicalId: `${field}:${value}` } };
  },
  async enrichBatch() {
    return { ok: true, result: {
      schemaVersion: "ai-enrichment-result/1.0",
      candidates: [{ field: "country", value: "Ethiopia", confidence: 0.9, status: "candidate", evidenceRefs: ["sample:1"] }],
      policy: { authority: "advisory", mayOverwriteFact: false }
    } };
  }
};

test("two manual samples use advisory AI only for missing fields and then canonicalize", async () => {
  const result = await canonicalizeAndValidateImportBundle({
    schema: "aromasense-import/1", source: { kind: "text" }, warnings: [],
    sessions: [{ sourceGroup: "manual", metadata: {}, samples: [
      { label: "A", metadata: { variety: "Gesha" }, rawText: "A Gesha", requiresReview: true },
      { label: "B", metadata: { country: "Kenya" }, rawText: "B Kenya", requiresReview: true }
    ] }]
  }, gateway);
  assert.equal(result.sessions[0].samples[0].metadata.country, "Ethiopia");
  assert.equal(result.sessions[0].samples[1].metadata.country, "Kenya");
  assert.equal((result.sessions[0].samples[0].metadata.canonical as { schemaVersion: string }).schemaVersion, "coffee-canonical-record/1.0");
});

test("validation exposes ! for invalid labels and ? for unresolved canonical fields", () => {
  assert.equal(validateSampleInput({ label: "", metadata: {} }).marker, "!");
  assert.equal(validateSampleInput({ label: "A", metadata: { canonical: { decisions: [{ field: "country", status: "unknown", reason: "no-match" }] } } }).marker, "?");
  assert.equal(validateSampleInput({ label: "A", metadata: {} }).marker, "");
});
