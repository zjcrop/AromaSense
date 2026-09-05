import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildYingxiangManifest, defaultYingxiangEventPolicy } from "../app/core/yingxiang-event";
import { YingxiangParticipationService } from "../app/core/yingxiang-participation-service";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";

function openDb(): { dir: string; db: NodeSQLiteDriver } {
  const dir = mkdtempSync(join(tmpdir(), "yingxiang-participation-"));
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

function remoteEvent() {
  return {
    schemaVersion: "yingxiang-event/0.1" as const,
    eventId: "event-live-1",
    eventRevision: 3,
    title: "迎香现场盲测",
    status: "published" as const,
    policy: defaultYingxiangEventPolicy(),
    manifest: buildYingxiangManifest({ organizerName: "测试咖啡馆", cuppingMode: "blind", sampleCodes: ["101", "205", "309"] }),
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:05:00.000Z"
  };
}

test("joined invite becomes one recoverable AromaSense session with event-safe sample metadata", async () => {
  const state = openDb();
  let joinCalls = 0;
  try {
    const event = remoteEvent();
    const client = {
      async previewInvite() { return { event, invite: { inviteId: "invite-1", expiresAt: "later", remainingUses: 5 } }; },
      async joinInvite(_token: string, input: { joinRequestId: string; displayName?: string; nameSource?: "custom" | "account" }) {
        joinCalls += 1;
        return {
          principal: {
            schemaVersion: "yingxiang-principal/0.1" as const,
            participantId: "participant-7",
            eventId: event.eventId,
            identityKind: "guest" as const,
            displayName: input.displayName || "P07",
            accountDisplayNameHidden: true as const,
            status: "active" as const,
            boundAt: "2026-09-06T08:10:00.000Z"
          },
          event,
          replayed: joinCalls > 1
        };
      }
    };
    let sessionSeq = 0;
    const service = new YingxiangParticipationService(state.db, client, {
      now: () => "2026-09-06T08:10:00.000Z",
      createSessionId: () => `session-${++sessionSeq}`,
      createSampleId: (index) => `sample-${index + 1}`
    });

    const first = await service.join({
      token: "a".repeat(48),
      joinRequestId: "join-request-0007",
      displayName: "P07",
      nameSource: "custom"
    });
    assert.equal(first.sessionId, "session-1");
    assert.equal(first.displayName, "P07");

    const session = await state.db.get<{ title: string; metadata_json: string }>(
      "SELECT title, metadata_json FROM sessions WHERE session_id = ?",
      [first.sessionId]
    );
    assert.equal(session?.title, "迎香现场盲测");
    const metadata = JSON.parse(session!.metadata_json) as Record<string, unknown>;
    assert.equal(metadata.organizer, "测试咖啡馆");
    assert.equal(metadata.participants, "P07");
    assert.equal(metadata.cuppingMode, "blind");
    assert.equal(metadata.eventId, "event-live-1");
    assert.equal(metadata.eventRevision, 3);

    const samples = await state.db.all<{ label: string; metadata_json: string; sort_order: number }>(
      "SELECT label, metadata_json, sort_order FROM samples WHERE session_id = ? ORDER BY sort_order",
      [first.sessionId]
    );
    assert.deepEqual(samples.map((row) => row.label), ["101", "205", "309"]);
    assert.deepEqual(samples.map((row) => (JSON.parse(row.metadata_json) as Record<string, unknown>).eventSampleId), ["slot-001", "slot-002", "slot-003"]);

    const second = await service.join({
      token: "a".repeat(48),
      joinRequestId: "join-request-0007",
      displayName: "P07",
      nameSource: "custom"
    });
    assert.equal(second.sessionId, first.sessionId);
    assert.equal(second.resumed, true);
    const countRow = await state.db.get<{ count: bigint }>("SELECT COUNT(*) AS count FROM sessions");
    assert.equal(Number(countRow?.count ?? 0n), 1);

    const binding = await state.db.get<{ session_id: string }>(
      "SELECT session_id FROM yingxiang_session_bindings WHERE event_id = ? AND participant_id = ?",
      [event.eventId, "participant-7"]
    );
    assert.equal(binding?.session_id, first.sessionId);
  } finally {
    state.db.close();
    rmSync(state.dir, { recursive: true, force: true });
  }
});
