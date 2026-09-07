import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildYingxiangManifest, defaultYingxiangEventPolicy } from "../app/core/yingxiang-event";

const dir = mkdtempSync(join(tmpdir(), "yingxiang-public-visibility-"));
buildSync({ entryPoints: ["cloud/worker/src/yingxiang-api.ts"], bundle: true, platform: "node", format: "cjs", outfile: join(dir, "api.cjs") });
const api = require(join(dir, "api.cjs"));
rmSync(dir, { recursive: true, force: true });

const COFFEE = {
  productName: "Secret Gesha",
  country: "Panama",
  region: "Boquete",
  farm: "Secret Estate",
  station: "Private Mill",
  variety: "Gesha",
  process: "Washed",
  roast: "Light",
  roaster: "Private Roaster",
  altitude: "1800m",
  roastDate: "2026-09-01",
  notes: "Hidden note"
};

function publicManifest(mode: "open" | "semi_blind" | "blind", status: "published" | "completed" = "published") {
  const policy = defaultYingxiangEventPolicy();
  const manifest = buildYingxiangManifest({ organizerName: "Visibility Lab", cuppingMode: mode, sampleCodes: ["101"], coffees: [COFFEE] });
  const row = {
    event_id: `event-${mode}`,
    owner_user_id: "owner",
    event_revision: 1,
    title: "Visibility",
    status,
    policy_json: JSON.stringify(policy),
    manifest_json: JSON.stringify(manifest),
    created_at: "2026-09-07T07:00:00Z",
    updated_at: "2026-09-07T07:00:00Z"
  };
  return (api.publicEvent(row, policy, manifest) as { manifest: { samples: Array<{ label?: string; coffee?: Record<string, string> }> } }).manifest;
}

test("open Yingxiang participant event includes full coffee metadata", () => {
  const manifest = publicManifest("open");
  assert.deepEqual(manifest.samples[0]?.coffee, COFFEE);
});

test("active semi-blind event exposes only the four participant-safe coffee fields", () => {
  const manifest = publicManifest("semi_blind");
  assert.equal(manifest.samples[0]?.label, undefined);
  assert.deepEqual(manifest.samples[0]?.coffee, {
    country: "Panama",
    region: "Boquete",
    process: "Washed",
    roast: "Light"
  });
});

test("active blind event exposes no coffee identity metadata", () => {
  const manifest = publicManifest("blind");
  assert.equal(manifest.samples[0]?.label, undefined);
  assert.equal(manifest.samples[0]?.coffee, undefined);
});

test("completed reveal-on-complete event returns full identity to participants", () => {
  const manifest = publicManifest("semi_blind", "completed");
  assert.deepEqual(manifest.samples[0]?.coffee, COFFEE);
});
