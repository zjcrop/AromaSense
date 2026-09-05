import {
  validateCalibrationGroup,
  validateYingxiangEvent,
  type YingxiangCalibrationGroup,
  type YingxiangEvent,
  type YingxiangEventPrincipal
} from "../core/yingxiang-event";
import type { SQLiteDriver } from "./local-cupping-repository";

interface EventRow {
  event_id: string;
  event_revision: number;
  host_user_id: string;
  title: string;
  status: YingxiangEvent["status"];
  policy_json: string;
  created_at: string;
  updated_at: string;
}

interface PrincipalRow {
  principal_id: string;
  event_id: string;
  participant_id: string;
  identity_kind: YingxiangEventPrincipal["identityKind"];
  account_user_id: string | null;
  display_name: string;
  status: YingxiangEventPrincipal["status"];
  bound_at: string;
  released_at: string | null;
}

interface CalibrationRow {
  group_id: string;
  event_id: string;
  canonical_sample_id: string;
  event_sample_ids_json: string;
  reveal_policy: YingxiangCalibrationGroup["revealPolicy"];
  created_at: string;
}

function eventFromRow(row: EventRow): YingxiangEvent {
  return validateYingxiangEvent({
    schemaVersion: "yingxiang-event/0.1",
    eventId: row.event_id,
    eventRevision: row.event_revision,
    hostUserId: row.host_user_id,
    title: row.title,
    status: row.status,
    policy: JSON.parse(row.policy_json) as YingxiangEvent["policy"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function principalFromRow(row: PrincipalRow): YingxiangEventPrincipal {
  return {
    schemaVersion: "yingxiang-principal/0.1",
    principalId: row.principal_id,
    eventId: row.event_id,
    participantId: row.participant_id,
    identityKind: row.identity_kind,
    accountUserId: row.account_user_id ?? undefined,
    displayName: row.display_name,
    accountDisplayNameHidden: true,
    status: row.status,
    boundAt: row.bound_at,
    releasedAt: row.released_at ?? undefined
  };
}

function calibrationFromRow(row: CalibrationRow): YingxiangCalibrationGroup {
  const ids = JSON.parse(row.event_sample_ids_json) as unknown;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("YINGXIANG_CALIBRATION_DB_CORRUPT");
  return {
    schemaVersion: "yingxiang-calibration-group/0.1",
    groupId: row.group_id,
    eventId: row.event_id,
    canonicalSampleId: row.canonical_sample_id,
    eventSampleIds: ids,
    revealPolicy: row.reveal_policy,
    createdAt: row.created_at
  };
}

export class YingxiangEventStore {
  constructor(private readonly db: SQLiteDriver) {}

  async putEvent(event: YingxiangEvent): Promise<"created" | "updated" | "already_present"> {
    validateYingxiangEvent(event);
    const existing = await this.getEvent(event.eventId);
    if (existing) {
      if (event.eventRevision < existing.eventRevision) throw new Error("YINGXIANG_STALE_EVENT_REVISION");
      const same = event.eventRevision === existing.eventRevision
        && JSON.stringify(event) === JSON.stringify(existing);
      if (same) return "already_present";
      if (event.eventRevision === existing.eventRevision) throw new Error("YINGXIANG_EVENT_REVISION_CONFLICT");
    }
    await this.db.run(
      `INSERT INTO yingxiang_events (event_id, event_revision, host_user_id, title, status, policy_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         event_revision=excluded.event_revision,
         host_user_id=excluded.host_user_id,
         title=excluded.title,
         status=excluded.status,
         policy_json=excluded.policy_json,
         updated_at=excluded.updated_at`,
      [event.eventId, event.eventRevision, event.hostUserId, event.title, event.status, JSON.stringify(event.policy), event.createdAt, event.updatedAt]
    );
    return existing ? "updated" : "created";
  }

  async getEvent(eventId: string): Promise<YingxiangEvent | undefined> {
    const row = await this.db.get<EventRow>(
      `SELECT event_id, event_revision, host_user_id, title, status, policy_json, created_at, updated_at
       FROM yingxiang_events WHERE event_id = ?`,
      [eventId]
    );
    return row ? eventFromRow(row) : undefined;
  }

  async putPrincipal(principal: YingxiangEventPrincipal): Promise<void> {
    const event = await this.getEvent(principal.eventId);
    if (!event) throw new Error("YINGXIANG_EVENT_NOT_FOUND");
    if (principal.status !== "active" || principal.releasedAt) throw new Error("YINGXIANG_NEW_PRINCIPAL_MUST_BE_ACTIVE");
    if (event.policy.participantName.uniqueWithinEvent) {
      const nameOwner = await this.db.get<{ participant_id: string }>(
        `SELECT participant_id FROM yingxiang_event_principals
         WHERE event_id = ? AND status = 'active' AND display_name = ? AND participant_id <> ?`,
        [principal.eventId, principal.displayName, principal.participantId]
      );
      if (nameOwner) throw new Error("YINGXIANG_PARTICIPANT_NAME_CONFLICT");
    }
    const existing = await this.db.get<{ principal_id: string; status: string }>(
      "SELECT principal_id, status FROM yingxiang_event_principals WHERE event_id = ? AND participant_id = ?",
      [principal.eventId, principal.participantId]
    );
    if (existing && existing.principal_id !== principal.principalId) throw new Error("YINGXIANG_PARTICIPANT_ALREADY_BOUND");
    await this.db.run(
      `INSERT INTO yingxiang_event_principals
       (principal_id, event_id, participant_id, identity_kind, account_user_id, display_name, status, bound_at, released_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL)
       ON CONFLICT(event_id, participant_id) DO UPDATE SET
         identity_kind=excluded.identity_kind,
         account_user_id=excluded.account_user_id,
         display_name=excluded.display_name,
         status='active',
         bound_at=excluded.bound_at,
         released_at=NULL`,
      [principal.principalId, principal.eventId, principal.participantId, principal.identityKind, principal.accountUserId ?? null, principal.displayName, principal.boundAt]
    );
  }

  async getActivePrincipal(eventId: string, participantId: string): Promise<YingxiangEventPrincipal | undefined> {
    const row = await this.db.get<PrincipalRow>(
      `SELECT principal_id, event_id, participant_id, identity_kind, account_user_id, display_name, status, bound_at, released_at
       FROM yingxiang_event_principals WHERE event_id = ? AND participant_id = ? AND status = 'active'`,
      [eventId, participantId]
    );
    return row ? principalFromRow(row) : undefined;
  }

  async releasePrincipal(eventId: string, participantId: string, releasedAt: string): Promise<void> {
    await this.db.run(
      `UPDATE yingxiang_event_principals SET status = 'released', released_at = ?
       WHERE event_id = ? AND participant_id = ? AND status = 'active'`,
      [releasedAt, eventId, participantId]
    );
  }

  async releaseAllEventPrincipals(eventId: string, releasedAt: string): Promise<void> {
    await this.db.run(
      `UPDATE yingxiang_event_principals SET status = 'released', released_at = ?
       WHERE event_id = ? AND status = 'active'`,
      [releasedAt, eventId]
    );
  }

  async putCalibrationGroup(group: YingxiangCalibrationGroup): Promise<void> {
    const event = await this.getEvent(group.eventId);
    if (!event) throw new Error("YINGXIANG_EVENT_NOT_FOUND");
    validateCalibrationGroup(group, event.policy);
    await this.db.run(
      `INSERT INTO yingxiang_calibration_groups
       (group_id, event_id, canonical_sample_id, event_sample_ids_json, reveal_policy, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(group_id) DO UPDATE SET
         canonical_sample_id=excluded.canonical_sample_id,
         event_sample_ids_json=excluded.event_sample_ids_json,
         reveal_policy=excluded.reveal_policy`,
      [group.groupId, group.eventId, group.canonicalSampleId, JSON.stringify(group.eventSampleIds), group.revealPolicy, group.createdAt]
    );
  }

  async listCalibrationGroups(eventId: string): Promise<readonly YingxiangCalibrationGroup[]> {
    const event = await this.getEvent(eventId);
    if (!event) return [];
    const rows = await this.db.all<CalibrationRow>(
      `SELECT group_id, event_id, canonical_sample_id, event_sample_ids_json, reveal_policy, created_at
       FROM yingxiang_calibration_groups WHERE event_id = ? ORDER BY created_at, group_id`,
      [eventId]
    );
    return rows.map((row) => validateCalibrationGroup(calibrationFromRow(row), event.policy));
  }
}
