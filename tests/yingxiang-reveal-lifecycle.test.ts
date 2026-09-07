import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { YingxiangDeliveryService } from "../app/core/yingxiang-delivery-service";
import { YingxiangParticipationService } from "../app/core/yingxiang-participation-service";
import { buildYingxiangManifest, defaultYingxiangEventPolicy } from "../app/core/yingxiang-event";
import type { YingxiangParticipantStatus, YingxiangRemoteEvent } from "../app/core/yingxiang-client";
import type { SubmissionBundle } from "../app/core/submission-bundle";
import { LocalCuppingRepository } from "../app/storage/local-cupping-repository";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { YingxiangEventStore, type YingxiangEventContext } from "../app/storage/yingxiang-event-store";
import { YingxiangParticipantEventRefresher } from "../app/storage/yingxiang-participant-event-refresh";

function openDb(): { dir: string; db: NodeSQLiteDriver } {
  const dir = mkdtempSync(join(tmpdir(), "yingxiang-reveal-"));
  const db = NodeSQLiteDriver.open(join(dir, "test.sqlite"));
  for (const file of readdirSync("app/storage").filter((name) => /^\d{4}.*\.sql$/u.test(name)).sort()) {
    db.exec(readFileSync(`app/storage/${file}`, "utf8"));
  }
  return { dir, db };
}

function context(event: YingxiangRemoteEvent): YingxiangEventContext {
  return {
    eventId: event.eventId,
    eventRevision: event.eventRevision,
    title: event.title,
    status: event.status,
    policy: event.policy,
    manifest: event.manifest,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  };
}

function events() {
  const createdAt = "2026-09-07T06:00:00.000Z";
  const policy = defaultYingxiangEventPolicy();
  const published: YingxiangRemoteEvent = {
    schemaVersion: "yingxiang-event/0.1",
    eventId: "event-reveal-1",
    eventRevision: 4,
    title: "迎香半盲揭盲测试",
    status: "published",
    policy,
    manifest: buildYingxiangManifest({ organizerName: "Lab", cuppingMode: "semi_blind", sampleCodes: ["101", "205"] }),
    createdAt,
    updatedAt: createdAt
  };
  const completed: YingxiangRemoteEvent = {
    ...published,
    status: "completed",
    manifest: buildYingxiangManifest({
      organizerName: "Lab",
      cuppingMode: "semi_blind",
      sampleCodes: ["101", "205"],
      coffees: [
        { productName: "Guji 74158", country: "Ethiopia", region: "Guji", farm: "Alo", variety: "74158", process: "Natural", roast: "Light", notes: "Lot A" },
        { productName: "Boquete Gesha", country: "Panama", region: "Boquete", farm: "Estate", variety: "Gesha", process: "Washed", roast: "Light", notes: "Lot B" }
      ]
    }),
    updatedAt: "2026-09-07T08:00:00.000Z"
  };
  return { published, completed };
}

async function joinSession(db: NodeSQLiteDriver, published: YingxiangRemoteEvent, token = "b".repeat(64)): Promise<void> {
  const principal = {
    schemaVersion: "yingxiang-principal/0.1" as const,
    participantId: "participant-1",
    eventId: published.eventId,
    identityKind: "guest" as const,
    displayName: "评委01",
    accountDisplayNameHidden: true as const,
    status: "active" as const,
    boundAt: "2026-09-07T06:10:00.000Z"
  };
  const service = new YingxiangParticipationService(db, {
    async previewInvite() { return { event: published, invite: { inviteId: "invite-1", expiresAt: "later", remainingUses: 1 } }; },
    async joinInvite() { return { event: published, principal, replayed: false, accessToken: token }; }
  }, {
    now: () => "2026-09-07T06:10:00.000Z",
    createSessionId: () => "session-1",
    createSampleId: (index) => `sample-${index + 1}`
  });
  await service.join({ token: "a".repeat(48), joinRequestId: `join:${crypto.randomUUID()}`, displayName: "评委01" });
}

test("same participant revision may advance to completed and enrich identity, but cannot mutate sample structure", async () => {
  const state = openDb();
  try {
    const { published, completed } = events();
    const refresher = new YingxiangParticipantEventRefresher(state.db);
    assert.equal(await refresher.refresh(context(published), "cache-1"), "created");
    assert.equal(await refresher.refresh(context(completed), "cache-2"), "updated");
    const saved = await new YingxiangEventStore(state.db).getEventContext(published.eventId);
    assert.equal(saved?.status, "completed");
    assert.equal(saved?.manifest.samples[0].coffee?.farm, "Alo");

    const illegal: YingxiangRemoteEvent = {
      ...completed,
      manifest: { ...completed.manifest, samples: completed.manifest.samples.map((sample, index) => index === 0 ? { ...sample, sampleCode: "999" } : sample) }
    };
    await assert.rejects(() => refresher.refresh(context(illegal), "cache-3"), /YINGXIANG_EVENT_REVISION_CONFLICT/);
  } finally {
    state.db.close();
    rmSync(state.dir, { recursive: true, force: true });
  }
});

test("completed Yingxiang event reveals local samples by eventSampleId even after local reorder", async () => {
  const state = openDb();
  try {
    const { published, completed } = events();
    await joinSession(state.db, published);
    const repository = new LocalCuppingRepository(state.db);
    const before = await repository.listSamples("session-1");
    await repository.replaceSampleOrder("session-1", [
      { ...before[1], sortOrder: 1, updatedAt: "2026-09-07T06:20:00.000Z" },
      { ...before[0], sortOrder: 2, updatedAt: "2026-09-07T06:20:00.000Z" }
    ]);
    await repository.saveObservation({
      observationId: "obs-1", sessionId: "session-1", sampleId: "sample-1", stageId: "scoring",
      fieldKey: "score_confirmed", value: true, dictionaryVersion: "v1", updatedAt: "2026-09-07T06:30:00.000Z"
    });

    let submitCalls = 0;
    let progressCalls = 0;
    const status: YingxiangParticipantStatus = {
      event: completed,
      participant: { participantId: "participant-1", displayName: "评委01", status: "released", releasedAt: "2026-09-07T08:00:00.000Z" },
      ack: null
    };
    const remote = {
      async participantStatus() { return status; },
      async sendProgress() { progressCalls += 1; return {}; },
      async submit(_participantId: string, _token: string, _bundle: SubmissionBundle) { submitCalls += 1; throw new Error("submit must not run for active local session after remote completion"); },
      async leave() { return {}; }
    };
    await new YingxiangDeliveryService(state.db, remote, () => "2026-09-07T08:01:00.000Z").sync();
    assert.equal(submitCalls, 0);
    assert.equal(progressCalls, 0);

    const samples = await repository.listSamples("session-1");
    const byId = new Map(samples.map((sample) => [sample.sampleId, sample] as const));
    assert.equal(byId.get("sample-1")?.label, "Guji 74158");
    assert.equal(byId.get("sample-1")?.metadata.eventSampleId, "slot-001");
    assert.equal(byId.get("sample-1")?.metadata.farm, "Alo");
    assert.equal(byId.get("sample-1")?.metadata.variety, "74158");
    assert.equal(byId.get("sample-2")?.label, "Boquete Gesha");
    assert.equal(byId.get("sample-2")?.metadata.eventSampleId, "slot-002");
    assert.equal(byId.get("sample-2")?.metadata.farm, "Estate");
    assert.equal((await repository.getSession("session-1")).metadata.revealedAt, "2026-09-07T08:01:00.000Z");
    assert.equal((await new YingxiangEventStore(state.db).getEventContext(completed.eventId))?.manifest.samples[1].coffee?.notes, "Lot B");
    assert.equal(await new YingxiangEventStore(state.db).getActivePrincipal(completed.eventId, "participant-1"), undefined);
    assert.equal((await repository.listObservationsForSession("session-1")).length, 1);
  } finally {
    state.db.close();
    rmSync(state.dir, { recursive: true, force: true });
  }
});

test("post-ACK reveal never creates a second submission revision", async () => {
  const state = openDb();
  try {
    const { published, completed } = events();
    await joinSession(state.db, published);
    const repository = new LocalCuppingRepository(state.db);
    const session = await repository.getSession("session-1");
    await repository.saveObservation({
      observationId: "obs-final", sessionId: "session-1", sampleId: "sample-1", stageId: "scoring",
      fieldKey: "score_confirmed", value: true, dictionaryVersion: "v1", updatedAt: "2026-09-07T07:00:00.000Z"
    });
    await repository.saveSession({ ...session, status: "completed", completedAt: "2026-09-07T07:05:00.000Z", updatedAt: "2026-09-07T07:05:00.000Z" });

    let currentEvent = published;
    let released = false;
    const submissions: SubmissionBundle[] = [];
    const remote = {
      async participantStatus(): Promise<YingxiangParticipantStatus> {
        return {
          event: currentEvent,
          participant: { participantId: "participant-1", displayName: "评委01", status: released ? "released" : "active", releasedAt: released ? "2026-09-07T08:00:00.000Z" : undefined },
          ack: submissions.length ? { revision: submissions.at(-1)!.revision, contentHash: submissions.at(-1)!.contentHash, receivedAt: "2026-09-07T07:10:00.000Z" } : null
        };
      },
      async sendProgress() { return {}; },
      async submit(_participantId: string, _token: string, bundle: SubmissionBundle) { submissions.push(bundle); return { revision: bundle.revision, contentHash: bundle.contentHash }; },
      async leave() { return {}; }
    };

    const delivery = new YingxiangDeliveryService(state.db, remote, () => "2026-09-07T07:10:00.000Z");
    await delivery.sync();
    assert.equal(submissions.length, 1);
    const ackBefore = (await delivery.list())[0];
    assert.ok(ackBefore.ack_hash);
    assert.equal(ackBefore.ack_revision, 1);
    assert.equal(Number((await state.db.get<{ count: bigint }>("SELECT COUNT(*) AS count FROM submission_revisions"))?.count ?? 0n), 1);

    currentEvent = completed;
    released = true;
    await new YingxiangDeliveryService(state.db, remote, () => "2026-09-07T08:01:00.000Z").sync();
    assert.equal(submissions.length, 1);
    const ackAfter = (await new YingxiangDeliveryService(state.db, remote, () => "2026-09-07T08:02:00.000Z").list())[0];
    assert.equal(ackAfter.ack_revision, ackBefore.ack_revision);
    assert.equal(ackAfter.ack_hash, ackBefore.ack_hash);
    assert.equal(ackAfter.last_error, null);
    assert.equal(Number((await state.db.get<{ count: bigint }>("SELECT COUNT(*) AS count FROM submission_revisions"))?.count ?? 0n), 1);
    assert.equal((await repository.getSession("session-1")).metadata.revealedAt, "2026-09-07T08:01:00.000Z");
  } finally {
    state.db.close();
    rmSync(state.dir, { recursive: true, force: true });
  }
});
