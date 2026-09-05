import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bindEventPrincipal, defaultYingxiangEventPolicy, type YingxiangEvent } from "../app/core/yingxiang-event";
import { NodeSQLiteDriver } from "../app/storage/node-sqlite-driver";
import { YingxiangEventStore } from "../app/storage/yingxiang-event-store";

function makeEvent(): YingxiangEvent {
  return {
    schemaVersion: "yingxiang-event/0.1",
    eventId: "event-a",
    eventRevision: 1,
    hostUserId: "registered-host",
    title: "迎香测试活动",
    status: "published",
    policy: defaultYingxiangEventPolicy(),
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z"
  };
}

test("yingxiang local store persists scoped principals and releases them without touching personal account identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yingxiang-store-"));
  const db = NodeSQLiteDriver.open(join(dir, "yingxiang.sqlite"));
  db.exec(readFileSync("app/storage/0006_yingxiang_event_context.sql", "utf8"));
  const store = new YingxiangEventStore(db);
  try {
    const event = makeEvent();
    assert.equal(await store.putEvent(event), "created");
    assert.equal(await store.putEvent(event), "already_present");

    const principal = bindEventPrincipal(event, {
      participantId: "participant-1",
      accountUserId: "account-1",
      accountDisplayName: "账户昵称",
      requestedName: "杯测员09"
    }, "principal-1", "2026-09-06T00:01:00.000Z");
    await store.putPrincipal(principal);
    assert.equal((await store.getActivePrincipal("event-a", "participant-1"))?.displayName, "杯测员09");

    await store.releasePrincipal("event-a", "participant-1", "2026-09-06T02:00:00.000Z");
    assert.equal(await store.getActivePrincipal("event-a", "participant-1"), undefined);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("event names are unique when organizer policy requires it and repeated calibration is stored separately", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yingxiang-store-"));
  const db = NodeSQLiteDriver.open(join(dir, "yingxiang.sqlite"));
  db.exec(readFileSync("app/storage/0006_yingxiang_event_context.sql", "utf8"));
  const store = new YingxiangEventStore(db);
  try {
    const event = makeEvent();
    await store.putEvent(event);
    await store.putPrincipal(bindEventPrincipal(event, { participantId: "p1", requestedName: "P01" }, "principal-1", "t1"));
    await assert.rejects(() => store.putPrincipal(bindEventPrincipal(event, { participantId: "p2", requestedName: "P01" }, "principal-2", "t2")), /YINGXIANG_PARTICIPANT_NAME_CONFLICT/);

    await store.putCalibrationGroup({
      schemaVersion: "yingxiang-calibration-group/0.1",
      groupId: "cal-a",
      eventId: "event-a",
      canonicalSampleId: "coffee-a",
      eventSampleIds: ["event-a:s03", "event-a:s10"],
      revealPolicy: "after_event",
      createdAt: "2026-09-06T00:00:00.000Z"
    });
    const groups = await store.listCalibrationGroups("event-a");
    assert.deepEqual(groups[0]?.eventSampleIds, ["event-a:s03", "event-a:s10"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("same event revision cannot silently overwrite different event content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yingxiang-store-"));
  const db = NodeSQLiteDriver.open(join(dir, "yingxiang.sqlite"));
  db.exec(readFileSync("app/storage/0006_yingxiang_event_context.sql", "utf8"));
  const store = new YingxiangEventStore(db);
  try {
    const event = makeEvent();
    await store.putEvent(event);
    await assert.rejects(() => store.putEvent({ ...event, title: "无 revision 的覆盖" }), /YINGXIANG_EVENT_REVISION_CONFLICT/);
    assert.equal(await store.putEvent({ ...event, eventRevision: 2, title: "合法更新", updatedAt: "2026-09-06T00:10:00.000Z" }), "updated");
    assert.equal((await store.getEvent("event-a"))?.title, "合法更新");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
