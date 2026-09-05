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

function openStore(): { dir: string; db: NodeSQLiteDriver; store: YingxiangEventStore } {
  const dir = mkdtempSync(join(tmpdir(), "yingxiang-store-"));
  const db = NodeSQLiteDriver.open(join(dir, "yingxiang.sqlite"));
  db.exec(readFileSync("app/storage/0006_yingxiang_event_context.sql", "utf8"));
  return { dir, db, store: new YingxiangEventStore(db) };
}

function closeStore(value: { dir: string; db: NodeSQLiteDriver }): void {
  value.db.close();
  rmSync(value.dir, { recursive: true, force: true });
}

test("yingxiang local store persists scoped principals and releases them without touching personal account identity", async () => {
  const state = openStore();
  try {
    const event = makeEvent();
    assert.equal(await state.store.putEvent(event), "created");
    assert.equal(await state.store.putEvent(event), "already_present");
    assert.equal((await state.store.getEventContext(event.eventId))?.title, event.title);

    const principal = bindEventPrincipal(event, {
      participantId: "participant-1",
      accountUserId: "account-1",
      accountDisplayName: "账户昵称",
      requestedName: "杯测员09"
    }, "principal-1", "2026-09-06T00:01:00.000Z");
    await state.store.putPrincipal(principal);
    assert.equal((await state.store.getActivePrincipal("event-a", "participant-1"))?.displayName, "杯测员09");

    await state.store.releasePrincipal("event-a", "participant-1", "2026-09-06T02:00:00.000Z");
    assert.equal(await state.store.getActivePrincipal("event-a", "participant-1"), undefined);
  } finally { closeStore(state); }
});

test("participant can persist a public event context and principal without receiving host account identity", async () => {
  const state = openStore();
  try {
    const event = makeEvent();
    const context = {
      eventId: event.eventId,
      eventRevision: event.eventRevision,
      title: event.title,
      status: event.status,
      policy: event.policy,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt
    };
    assert.equal(await state.store.putEventContext(context, "2026-09-06T00:02:00.000Z"), "created");
    assert.equal(await state.store.getEvent("event-a"), undefined);

    const principal = bindEventPrincipal(event, {
      participantId: "guest-1",
      requestedName: "匿名07"
    }, "principal-guest-1", "2026-09-06T00:03:00.000Z");
    await state.store.putPrincipal(principal);
    const stored = await state.store.getActivePrincipal("event-a", "guest-1");
    assert.equal(stored?.displayName, "匿名07");
    assert.equal(stored?.accountUserId, undefined);
  } finally { closeStore(state); }
});

test("event names are unique when organizer policy requires it and repeated calibration is stored separately", async () => {
  const state = openStore();
  try {
    const event = makeEvent();
    await state.store.putEvent(event);
    await state.store.putPrincipal(bindEventPrincipal(event, { participantId: "p1", requestedName: "P01" }, "principal-1", "t1"));
    await assert.rejects(() => state.store.putPrincipal(bindEventPrincipal(event, { participantId: "p2", requestedName: "P01" }, "principal-2", "t2")), /YINGXIANG_PARTICIPANT_NAME_CONFLICT/);

    await state.store.putCalibrationGroup({
      schemaVersion: "yingxiang-calibration-group/0.1",
      groupId: "cal-a",
      eventId: "event-a",
      canonicalSampleId: "coffee-a",
      eventSampleIds: ["event-a:s03", "event-a:s10"],
      revealPolicy: "after_event",
      createdAt: "2026-09-06T00:00:00.000Z"
    });
    const groups = await state.store.listCalibrationGroups("event-a");
    assert.deepEqual(groups[0]?.eventSampleIds, ["event-a:s03", "event-a:s10"]);
  } finally { closeStore(state); }
});

test("same event revision cannot silently overwrite different event content", async () => {
  const state = openStore();
  try {
    const event = makeEvent();
    await state.store.putEvent(event);
    await assert.rejects(() => state.store.putEvent({ ...event, title: "无 revision 的覆盖" }), /YINGXIANG_EVENT_REVISION_CONFLICT/);
    assert.equal(await state.store.putEvent({ ...event, eventRevision: 2, title: "合法更新", updatedAt: "2026-09-06T00:10:00.000Z" }), "updated");
    assert.equal((await state.store.getEvent("event-a"))?.title, "合法更新");
    assert.equal((await state.store.getEventContext("event-a"))?.eventRevision, 2);
  } finally { closeStore(state); }
});

test("public event context also rejects same-revision silent overwrite", async () => {
  const state = openStore();
  try {
    const event = makeEvent();
    const context = {
      eventId: event.eventId,
      eventRevision: event.eventRevision,
      title: event.title,
      status: event.status,
      policy: event.policy,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt
    };
    await state.store.putEventContext(context, "cache-1");
    assert.equal(await state.store.putEventContext(context, "cache-2"), "already_present");
    await assert.rejects(
      () => state.store.putEventContext({ ...context, title: "非法覆盖" }, "cache-3"),
      /YINGXIANG_EVENT_REVISION_CONFLICT/
    );
  } finally { closeStore(state); }
});
