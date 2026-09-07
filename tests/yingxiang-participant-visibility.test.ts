import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildYingxiangManifest, defaultYingxiangEventPolicy, type YingxiangCuppingMode } from "../app/core/yingxiang-event";
import { YingxiangParticipationService } from "../app/core/yingxiang-participation-service";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";

function openDb(): { dir: string; db: NodeSQLiteDriver } {
  const dir = mkdtempSync(join(tmpdir(), "yingxiang-visibility-"));
  const db = NodeSQLiteDriver.open(join(dir, "test.sqlite"));
  for (const file of [
    "0001_local_schema.sql",
    "0002_session_metadata.sql",
    "0003_workflow_event_comparison.sql",
    "0004_submission_revisions.sql",
    "0005_session_timing.sql",
    "0006_yingxiang_event_context.sql"
  ]) db.exec(readFileSync(`app/storage/${file}`, "utf8"));
  return { dir, db };
}

function event(mode: YingxiangCuppingMode) {
  return {
    schemaVersion: "yingxiang-event/0.1" as const,
    eventId: `event-${mode}`,
    eventRevision: 2,
    title: `visibility-${mode}`,
    status: "published" as const,
    policy: defaultYingxiangEventPolicy(),
    manifest: buildYingxiangManifest({
      organizerName: "Visibility Lab",
      cuppingMode: mode,
      sampleCodes: ["101"],
      coffees: [{
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
        notes: "Do not expose during semi-blind"
      }]
    }),
    createdAt: "2026-09-07T07:00:00.000Z",
    updatedAt: "2026-09-07T07:01:00.000Z"
  };
}

async function joinMode(mode: YingxiangCuppingMode) {
  const state = openDb();
  const remote = event(mode);
  const client = {
    async previewInvite() { return { event: remote, invite: { inviteId: "invite", expiresAt: "later", remainingUses: 1 } }; },
    async joinInvite() {
      return {
        principal: {
          schemaVersion: "yingxiang-principal/0.1" as const,
          participantId: `participant-${mode}`,
          eventId: remote.eventId,
          identityKind: "guest" as const,
          displayName: "P01",
          accountDisplayNameHidden: true as const,
          status: "active" as const,
          boundAt: "2026-09-07T07:02:00.000Z"
        },
        event: remote,
        replayed: false
      };
    }
  };
  const service = new YingxiangParticipationService(state.db, client, {
    now: () => "2026-09-07T07:02:00.000Z",
    createSessionId: () => `session-${mode}`,
    createSampleId: () => `sample-${mode}`
  });
  const joined = await service.join({ token: "a".repeat(48), joinRequestId: `join-${mode}-visibility`, displayName: "P01" });
  const sample = await state.db.get<{ label: string; metadata_json: string }>(
    "SELECT label, metadata_json FROM samples WHERE session_id = ?",
    [joined.sessionId]
  );
  return { state, sample: { label: sample!.label, metadata: JSON.parse(sample!.metadata_json) as Record<string, unknown> } };
}

test("open Yingxiang sessions persist full coffee metadata received from the event", async () => {
  const { state, sample } = await joinMode("open");
  try {
    assert.equal(sample.label, "Secret Gesha");
    assert.equal(sample.metadata.productName, "Secret Gesha");
    assert.equal(sample.metadata.country, "Panama");
    assert.equal(sample.metadata.region, "Boquete");
    assert.equal(sample.metadata.farm, "Secret Estate");
    assert.equal(sample.metadata.variety, "Gesha");
    assert.equal(sample.metadata.notes, "Do not expose during semi-blind");
  } finally { state.db.close(); rmSync(state.dir, { recursive: true, force: true }); }
});

test("semi-blind Yingxiang sessions persist only the participant-safe coffee whitelist", async () => {
  const { state, sample } = await joinMode("semi_blind");
  try {
    assert.equal(sample.label, "101");
    assert.deepEqual(
      Object.fromEntries(["country", "region", "process", "roast"].map((key) => [key, sample.metadata[key]])),
      { country: "Panama", region: "Boquete", process: "Washed", roast: "Light" }
    );
    for (const hidden of ["productName", "farm", "station", "variety", "roaster", "altitude", "roastDate", "notes"]) {
      assert.equal(sample.metadata[hidden], undefined, `${hidden} must not be persisted in active semi-blind participant metadata`);
    }
  } finally { state.db.close(); rmSync(state.dir, { recursive: true, force: true }); }
});

test("blind Yingxiang sessions persist no coffee identity metadata", async () => {
  const { state, sample } = await joinMode("blind");
  try {
    assert.equal(sample.label, "101");
    for (const hidden of ["productName", "country", "region", "farm", "station", "variety", "process", "roast", "roaster", "altitude", "roastDate", "notes"]) {
      assert.equal(sample.metadata[hidden], undefined, `${hidden} must not be persisted in active blind participant metadata`);
    }
    assert.equal(sample.metadata.eventSampleId, "slot-001");
    assert.equal(sample.metadata.sampleCode, "101");
  } finally { state.db.close(); rmSync(state.dir, { recursive: true, force: true }); }
});
