import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeAndValidateImportBundle, canonicalizeSampleInput, validateSampleInput, type CoffeeFoundationGateway } from "../app/core/sample-input-pipeline";

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

test("editing a sample replaces stale canonical conflicts with current Foundation decisions", () => {
  const edited = canonicalizeSampleInput({ label: "A", requiresReview: true, metadata: {
    country: "Ethiopia", canonical: { decisions: [{ field: "country", status: "conflict", reason: "old-conflict" }] },
    inputValidation: { state: "invalid", marker: "!" }
  } }, gateway, "sample:1");
  assert.equal(validateSampleInput(edited).state, "valid");
  assert.equal(edited.requiresReview, false);
  assert.equal((edited.metadata.inputValidation as { marker: string }).marker, "");
});

test("removing a field clears its obsolete decision without inventing a canonical identity", () => {
  const edited = canonicalizeSampleInput({ label: "A", requiresReview: true, metadata: {
    canonical: { decisions: [{ field: "country", status: "conflict", reason: "old-conflict" }] }
  } }, gateway, "sample:1");
  assert.deepEqual((edited.metadata.canonical as { decisions: unknown[] }).decisions, []);
  assert.equal(validateSampleInput(edited).state, "valid");
});

test("current Foundation conflicts and unavailable Foundation both remain reviewable", () => {
  const original = { label: "A", metadata: { country: "Unknown" }, requiresReview: false };
  const conflict = canonicalizeSampleInput(original, { resolve: (field, value) => ({ field, rawValue: value, normalizedValue: value, status: "conflict", reason: "ambiguous-country" }) }, "sample:1");
  assert.equal(validateSampleInput(conflict).state, "review");
  const offline = canonicalizeSampleInput(original, undefined, "sample:1");
  assert.equal(offline.metadata.country, "Unknown");
  assert.equal(validateSampleInput(offline).state, "review");
});
