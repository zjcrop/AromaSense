import assert from "node:assert/strict";
import test from "node:test";
import {
  bindEventPrincipal,
  defaultYingxiangEventPolicy,
  releaseEventPrincipal,
  resolveEffectiveIdentity,
  selectEventDisplayName,
  validateCalibrationGroup,
  type YingxiangEvent
} from "../app/core/yingxiang-event";

function event(overrides: Partial<YingxiangEvent> = {}): YingxiangEvent {
  return {
    schemaVersion: "yingxiang-event/0.1",
    eventId: "evt-1",
    eventRevision: 1,
    hostUserId: "host-user-1",
    title: "迎香测试杯测",
    status: "published",
    policy: defaultYingxiangEventPolicy(),
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
    ...overrides
  };
}

test("host account is mandatory while guests remain supported", () => {
  assert.throws(() => bindEventPrincipal(event({ hostUserId: "" }), {
    participantId: "p1", requestedName: "A"
  }, "principal-1", "2026-09-06T00:01:00.000Z"), /YINGXIANG_HOST_ACCOUNT_REQUIRED/);

  const principal = bindEventPrincipal(event(), {
    participantId: "guest-1", requestedName: "访客甲"
  }, "principal-guest", "2026-09-06T00:01:00.000Z");
  assert.equal(principal.identityKind, "guest");
  assert.equal(principal.accountUserId, undefined);
});

test("event principal overrides personal identity only for the active event scope", () => {
  const principal = bindEventPrincipal(event(), {
    participantId: "p1",
    accountUserId: "user-1",
    accountDisplayName: "个人账户名",
    requestedName: "盲测07"
  }, "principal-1", "2026-09-06T00:01:00.000Z");

  assert.deepEqual(resolveEffectiveIdentity({
    eventPrincipal: principal,
    personalAccount: { userId: "user-1", displayName: "个人账户名" }
  }), {
    scope: "event",
    displayName: "盲测07",
    accountUserId: "user-1",
    eventId: "evt-1",
    participantId: "p1"
  });
  assert.equal(principal.accountDisplayNameHidden, true);

  const released = releaseEventPrincipal(principal, "2026-09-06T03:00:00.000Z");
  assert.deepEqual(resolveEffectiveIdentity({
    eventPrincipal: released,
    personalAccount: { userId: "user-1", displayName: "个人账户名" }
  }), { scope: "personal", displayName: "个人账户名", accountUserId: "user-1" });
});

test("personal account name is never exposed implicitly", () => {
  const policy = defaultYingxiangEventPolicy().participantName;
  assert.throws(() => selectEventDisplayName({
    participantId: "p1",
    accountUserId: "user-1",
    accountDisplayName: "真实姓名"
  }, policy), /YINGXIANG_PARTICIPANT_NAME_REQUIRED/);

  assert.equal(selectEventDisplayName({
    participantId: "p1",
    accountUserId: "user-1",
    accountDisplayName: "真实姓名",
    useAccountDisplayName: true
  }, policy), "真实姓名");
});

test("organizer assigned naming policy cannot be bypassed by a logged-in account", () => {
  const policy = {
    ...defaultYingxiangEventPolicy().participantName,
    mode: "organizer_assigned" as const,
    allowAccountDisplayName: false
  };
  assert.equal(selectEventDisplayName({ participantId: "p1", organizerAssignedName: "P-08", requestedName: "改名" }, policy), "P-08");
  assert.throws(() => selectEventDisplayName({ participantId: "p1", requestedName: "改名" }, policy), /YINGXIANG_ORGANIZER_ASSIGNED_NAME_REQUIRED/);
});

test("calibration repeat maps multiple blind sample identities to one canonical coffee", () => {
  const policy = defaultYingxiangEventPolicy();
  const group = validateCalibrationGroup({
    schemaVersion: "yingxiang-calibration-group/0.1",
    groupId: "cal-1",
    eventId: "evt-1",
    canonicalSampleId: "coffee-42",
    eventSampleIds: ["slot-02", "slot-11", "slot-19"],
    revealPolicy: "after_event",
    createdAt: "2026-09-06T00:00:00.000Z"
  }, policy);
  assert.equal(group.eventSampleIds.length, 3);
  assert.throws(() => validateCalibrationGroup({ ...group, eventSampleIds: ["slot-02"] }, policy), /YINGXIANG_CALIBRATION_REQUIRES_REPEAT/);
  assert.throws(() => validateCalibrationGroup({ ...group, eventSampleIds: ["slot-02", "slot-02"] }, policy), /YINGXIANG_CALIBRATION_SAMPLE_DUPLICATE/);
});
