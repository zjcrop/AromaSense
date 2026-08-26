import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  anonymousSampleLabel,
  visibleSampleLabel,
  visibleSampleMetadata
} from "../app/core/blind-session";
import { normalizeBatchSetupDraft } from "../app/core/batch-setup-draft";
import { buildSampleBatch } from "../app/core/sample-batch-service";
import { activateSession, completeSession, createSession } from "../app/core/session-lifecycle";
import { normalizeSessionMetadata } from "../app/core/session-metadata";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { buildSampleRailViewState } from "../app/ui/cupping-view-model";

const schema = readFileSync("app/storage/0001_local_schema.sql", "utf8");
const metadataMigration = readFileSync("app/storage/0002_session_metadata.sql", "utf8");
const now = "2026-08-26T20:50:00+08:00";

function metadata(blindMode: "open" | "semi_blind" | "full_blind") {
  return normalizeSessionMetadata({
    date: "2026-08-26",
    time: "20:50",
    organizer: "AromaSense test",
    blindMode
  });
}

const sampleMetadata = {
  country: "Ethiopia",
  region: "Guji",
  farm: "Example Farm",
  station: "Example Station",
  variety: "74110",
  process: "Washed",
  roast: "Light",
  lot: "LOT-SECRET",
  roaster: "Example Roaster",
  flavorNotes: "Jasmine / bergamot"
};

test("full blind exposes only anonymous sample code until session completion", () => {
  const sessionMetadata = metadata("full_blind");
  assert.equal(anonymousSampleLabel(7), "Sample 07");
  assert.equal(visibleSampleLabel("Guji Lot 12", 7, sessionMetadata, "active"), "Sample 07");
  assert.deepEqual(visibleSampleMetadata(sampleMetadata, sessionMetadata, "active"), {});

  const completed = completeSession(
    activateSession(createSession({ sessionId: "full-blind", metadata: sessionMetadata, now }), now),
    "2026-08-26T21:30:00+08:00"
  );
  assert.equal(completed.metadata.revealedAt, "2026-08-26T21:30:00+08:00");
  assert.equal(visibleSampleLabel("Guji Lot 12", 7, completed.metadata, completed.status), "Guji Lot 12");
  assert.deepEqual(visibleSampleMetadata(sampleMetadata, completed.metadata, completed.status), sampleMetadata);
});

test("semi blind masks direct identity and exposes only the default low-identification whitelist", () => {
  const sessionMetadata = metadata("semi_blind");
  assert.equal(visibleSampleLabel("Secret auction lot", 1, sessionMetadata, "draft"), "Sample 01");
  assert.deepEqual(visibleSampleMetadata(sampleMetadata, sessionMetadata, "active"), {
    country: "Ethiopia",
    region: "Guji",
    process: "Washed",
    roast: "Light"
  });
});

test("open mode and legacy metadata remain fully visible", () => {
  const open = metadata("open");
  assert.equal(visibleSampleLabel("Known sample", 2, open, "active"), "Known sample");
  assert.deepEqual(visibleSampleMetadata(sampleMetadata, open, "active"), sampleMetadata);

  const legacy = normalizeSessionMetadata({ date: "2026-08-26", time: "20:50", organizer: "Legacy" });
  assert.equal(legacy.blindMode, "open");
});

test("blind mode survives setup draft normalization", () => {
  const draft = normalizeBatchSetupDraft({
    version: 2,
    title: "Blind flight",
    sessionMetadata: {
      date: "2026-08-26",
      time: "20:50",
      organizer: "Lab",
      blindMode: "full_blind"
    },
    items: [{ id: "row-1", label: "A", metadata: {}, requiresReview: false, confirmed: true }],
    updatedAt: now
  });
  assert.equal(draft?.sessionMetadata.blindMode, "full_blind");
});

test("repository persists blind mode and reveal timestamp in existing session metadata JSON", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aromasense-blind-"));
  const db = NodeSQLiteDriver.open(join(dir, "blind.sqlite"));
  db.exec(schema);
  db.exec(metadataMigration);

  try {
    const repository = new LocalCuppingRepository(db);
    const session = createSession({ sessionId: "blind-persist", metadata: metadata("full_blind"), now });
    const samples = buildSampleBatch(
      session.sessionId,
      [{ label: "Secret lot", metadata: sampleMetadata }],
      now,
      () => "sample-1"
    );
    await repository.createSessionWithSamples(session, samples);

    const stored = await repository.getSession(session.sessionId);
    assert.equal(stored.metadata.blindMode, "full_blind");
    const rail = buildSampleRailViewState(samples, [], undefined, { metadata: stored.metadata, status: stored.status });
    assert.equal(rail[0]?.label, "Sample 01");

    const completed = completeSession(activateSession(stored, now), "2026-08-26T21:35:00+08:00");
    await repository.saveSession(completed);
    const restored = await repository.getSession(session.sessionId);
    assert.equal(restored.metadata.blindMode, "full_blind");
    assert.equal(restored.metadata.revealedAt, "2026-08-26T21:35:00+08:00");
    const revealedRail = buildSampleRailViewState(samples, [], undefined, { metadata: restored.metadata, status: restored.status });
    assert.equal(revealedRail[0]?.label, "Secret lot");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("creating a new session from previously revealed metadata clears stale reveal state", () => {
  const source = normalizeSessionMetadata({
    date: "2026-08-26",
    time: "20:50",
    organizer: "Imported",
    blindMode: "full_blind",
    revealedAt: "2026-08-20T10:00:00+08:00"
  });
  const created = createSession({ sessionId: "reused", metadata: source, now });
  assert.equal(created.status, "draft");
  assert.equal(created.metadata.blindMode, "full_blind");
  assert.equal(created.metadata.revealedAt, undefined);
  assert.equal(visibleSampleLabel("Still secret", 1, created.metadata, created.status), "Sample 01");
});
