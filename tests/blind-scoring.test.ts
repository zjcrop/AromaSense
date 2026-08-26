import assert from "node:assert/strict";
import test from "node:test";
import {
  blindIdentificationFieldsForMode,
  blindIdentityMatches,
  calculateBlindIdentificationScore
} from "../app/core/blind-scoring";

const metadata = {
  country: "Ethiopia / 埃塞俄比亚",
  region: "Guji",
  farm: "Hambela",
  variety: "74110",
  process: "Washed / 水洗",
  roast: "Light / 浅烘",
  roaster: "Example Roaster"
};

test("identity matching accepts normalized multilingual aliases but remains deterministic", () => {
  assert.equal(blindIdentityMatches("Washed / 水洗", "水洗"), true);
  assert.equal(blindIdentityMatches("Ethiopia / 埃塞俄比亚", "ethiopia"), true);
  assert.equal(blindIdentityMatches("Example-Roaster", "example roaster"), true);
  assert.equal(blindIdentityMatches("Guji", "Yirgacheffe"), false);
});

test("full blind scores every available hidden identity field", () => {
  const result = calculateBlindIdentificationScore(metadata, [
    { fieldKey: "blind_guess_country", value: "埃塞俄比亚" },
    { fieldKey: "blind_guess_region", value: "Guji" },
    { fieldKey: "blind_guess_farm", value: "Hambela" },
    { fieldKey: "blind_guess_variety", value: "74110" },
    { fieldKey: "blind_guess_process", value: "水洗" },
    { fieldKey: "blind_guess_roast", value: "浅烘" },
    { fieldKey: "blind_guess_roaster", value: "Wrong" }
  ], "full_blind");
  assert.equal(result.total, 7);
  assert.equal(result.correct, 6);
  assert.equal(result.percent, 85.7);
});

test("semi blind excludes disclosed fields from identification scoring", () => {
  const fields = blindIdentificationFieldsForMode("semi_blind");
  assert.deepEqual(fields.map((field) => field.key), ["farm", "variety", "roaster"]);
  const result = calculateBlindIdentificationScore(metadata, [
    { fieldKey: "blind_guess_farm", value: "Hambela" },
    { fieldKey: "blind_guess_variety", value: "74110" },
    { fieldKey: "blind_guess_roaster", value: "Other" }
  ], "semi_blind");
  assert.equal(result.total, 3);
  assert.equal(result.correct, 2);
  assert.equal(result.percent, 66.7);
});

test("missing truth is excluded from denominator rather than counted wrong", () => {
  const result = calculateBlindIdentificationScore({ country: "Kenya" }, [], "full_blind");
  assert.equal(result.total, 1);
  assert.equal(result.correct, 0);
  assert.equal(result.percent, 0);
  assert.equal(result.items.find((item) => item.key === "variety")?.scorable, false);
});

test("open/custom cupping has no identification score layer", () => {
  const result = calculateBlindIdentificationScore(metadata, [], "open");
  assert.equal(result.total, 0);
  assert.equal(result.percent, undefined);
  assert.deepEqual(result.items, []);
});
