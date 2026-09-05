import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

function sql(path: string): string {
  return readFileSync(path, "utf8");
}

function policy(uniqueWithinEvent = true): string {
  return JSON.stringify({
    schemaVersion: "yingxiang-event-policy/0.1",
    allowGuestParticipants: true,
    participantName: {
      mode: "participant_choice",
      allowAccountDisplayName: true,
      uniqueWithinEvent,
      minLength: 1,
      maxLength: 24
    },
    revealSampleIdentity: "on_event_complete",
    calibrationRepeatEnabled: true
  });
}

function manifest(): string {
  return JSON.stringify({
    schemaVersion: "yingxiang-event-manifest/0.1",
    organizerName: "测试组织方",
    cuppingMode: "blind",
    samples: [
      { eventSampleId: "slot-001", sampleCode: "101", order: 1 },
      { eventSampleId: "slot-002", sampleCode: "205", order: 2 }
    ]
  });
}

test("Yingxiang D1 migrations execute and enforce invite/calibration guards", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON; CREATE TABLE users (user_id TEXT PRIMARY KEY);");
    db.exec(sql("cloud/worker/migrations/0007_yingxiang_events.sql"));
    db.exec(sql("cloud/worker/migrations/0008_account_display_name.sql"));

    db.prepare("INSERT INTO users (user_id, display_name) VALUES (?, ?)").run("host-1", "主办方账户");
    db.prepare(`INSERT INTO yingxiang_events
      (event_id, owner_user_id, event_revision, title, status, policy_json, manifest_json, created_at, updated_at)
      VALUES (?, ?, 1, ?, 'published', ?, ?, ?, ?)`)
      .run("event-1", "host-1", "现场测试", policy(), manifest(), "2026-09-06T00:00:00.000Z", "2026-09-06T00:00:00.000Z");

    db.prepare(`INSERT INTO yingxiang_invites
      (invite_id, event_id, event_revision, token_hash, expires_at, max_uses, use_count, created_at)
      VALUES (?, ?, 1, ?, ?, 1, 0, ?)`)
      .run("invite-1", "event-1", "hash-1", "2099-01-01T00:00:00.000Z", "2026-09-06T00:01:00.000Z");

    db.prepare(`INSERT INTO yingxiang_participants
      (participant_id, join_request_id, event_id, invite_id, account_user_id, identity_kind, display_name, status, joined_at)
      VALUES (?, ?, ?, ?, NULL, 'guest', ?, 'active', ?)`)
      .run("participant-1", "join-request-0001", "event-1", "invite-1", "P01", "2026-09-06T00:02:00.000Z");

    const invite = db.prepare("SELECT use_count FROM yingxiang_invites WHERE invite_id = ?").get("invite-1") as { use_count: number };
    assert.equal(Number(invite.use_count), 1);

    assert.throws(() => db.prepare(`INSERT INTO yingxiang_participants
      (participant_id, join_request_id, event_id, invite_id, account_user_id, identity_kind, display_name, status, joined_at)
      VALUES (?, ?, ?, ?, NULL, 'guest', ?, 'active', ?)`)
      .run("participant-2", "join-request-0002", "event-1", "invite-1", "P02", "2026-09-06T00:03:00.000Z"), /YINGXIANG_INVITE_UNAVAILABLE/);

    db.prepare(`INSERT INTO yingxiang_calibration_groups
      (group_id, event_id, canonical_sample_id, event_sample_ids_json, reveal_policy, created_at)
      VALUES (?, ?, ?, ?, 'after_event', ?)`)
      .run("cal-1", "event-1", "coffee-1", JSON.stringify(["slot-001", "slot-002"]), "2026-09-06T00:04:00.000Z");

    assert.throws(() => db.prepare(`INSERT INTO yingxiang_calibration_groups
      (group_id, event_id, canonical_sample_id, event_sample_ids_json, reveal_policy, created_at)
      VALUES (?, ?, ?, ?, 'after_event', ?)`)
      .run("cal-2", "event-1", "coffee-2", JSON.stringify(["slot-001", "missing-slot"]), "2026-09-06T00:05:00.000Z"), /YINGXIANG_CALIBRATION_UNKNOWN_EVENT_SAMPLE/);

    const account = db.prepare("SELECT display_name FROM users WHERE user_id = ?").get("host-1") as { display_name: string };
    assert.equal(account.display_name, "主办方账户");
  } finally {
    db.close();
  }
});
