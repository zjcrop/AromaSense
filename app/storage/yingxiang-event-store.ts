import {
  validateCalibrationGroup,
  validateYingxiangEvent,
  validateYingxiangManifest,
  type YingxiangCalibrationGroup,
  type YingxiangEvent,
  type YingxiangEventManifest,
  type YingxiangEventPolicy,
  type YingxiangEventPrincipal,
  type YingxiangEventStatus
} from "../core/yingxiang-event";
import type { SQLiteDriver } from "./local-cupping-repository";

export interface YingxiangEventContext {
  eventId: string;
  eventRevision: number;
  title: string;
  status: YingxiangEventStatus;
  policy: YingxiangEventPolicy;
  manifest: YingxiangEventManifest;
  createdAt: string;
  updatedAt: string;
}

interface EventRow {
  event_id: string; event_revision: number; host_user_id: string; title: string; status: YingxiangEventStatus;
  policy_json: string; manifest_json: string; created_at: string; updated_at: string;
}
interface EventContextRow {
  event_id: string; event_revision: number; title: string; status: YingxiangEventStatus;
  policy_json: string; manifest_json: string; created_at: string; updated_at: string; cached_at: string;
}
interface PrincipalRow {
  principal_id: string; event_id: string; participant_id: string; identity_kind: YingxiangEventPrincipal["identityKind"];
  account_user_id: string | null; display_name: string; status: YingxiangEventPrincipal["status"];
  bound_at: string; released_at: string | null;
}
interface CalibrationRow {
  group_id: string; event_id: string; canonical_sample_id: string; event_sample_ids_json: string;
  reveal_policy: YingxiangCalibrationGroup["revealPolicy"]; created_at: string;
}

function policySignature(policy: YingxiangEventPolicy): string {
  return JSON.stringify({
    schemaVersion: policy.schemaVersion,
    allowGuestParticipants: policy.allowGuestParticipants,
    participantName: {
      mode: policy.participantName.mode,
      allowAccountDisplayName: policy.participantName.allowAccountDisplayName,
      uniqueWithinEvent: policy.participantName.uniqueWithinEvent,
      minLength: policy.participantName.minLength,
      maxLength: policy.participantName.maxLength,
      requiredPrefix: policy.participantName.requiredPrefix ?? null
    },
    revealSampleIdentity: policy.revealSampleIdentity,
    calibrationRepeatEnabled: policy.calibrationRepeatEnabled
  });
}

function manifestSignature(manifest: YingxiangEventManifest): string {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    organizerName: manifest.organizerName,
    cuppingMode: manifest.cuppingMode,
    samples: [...manifest.samples]
      .sort((a, b) => a.order - b.order)
      .map((sample) => ({ eventSampleId: sample.eventSampleId, sampleCode: sample.sampleCode, order: sample.order, label: sample.label ?? null }))
  });
}

function eventContextFromEvent(event: YingxiangEvent): YingxiangEventContext {
  return {
    eventId: event.eventId, eventRevision: event.eventRevision, title: event.title, status: event.status,
    policy: event.policy, manifest: event.manifest, createdAt: event.createdAt, updatedAt: event.updatedAt
  };
}

function eventFromRow(row: EventRow): YingxiangEvent {
  return validateYingxiangEvent({
    schemaVersion: "yingxiang-event/0.1", eventId: row.event_id, eventRevision: row.event_revision,
    hostUserId: row.host_user_id, title: row.title, status: row.status,
    policy: JSON.parse(row.policy_json) as YingxiangEventPolicy,
    manifest: JSON.parse(row.manifest_json) as YingxiangEventManifest,
    createdAt: row.created_at, updatedAt: row.updated_at
  });
}

function eventContextFromRow(row: EventContextRow): YingxiangEventContext {
  return validateEventContext({
    eventId: row.event_id, eventRevision: row.event_revision, title: row.title, status: row.status,
    policy: JSON.parse(row.policy_json) as YingxiangEventPolicy,
    manifest: JSON.parse(row.manifest_json) as YingxiangEventManifest,
    createdAt: row.created_at, updatedAt: row.updated_at
  });
}

function principalFromRow(row: PrincipalRow): YingxiangEventPrincipal {
  return {
    schemaVersion: "yingxiang-principal/0.1", principalId: row.principal_id, eventId: row.event_id,
    participantId: row.participant_id, identityKind: row.identity_kind, accountUserId: row.account_user_id ?? undefined,
    displayName: row.display_name, accountDisplayNameHidden: true, status: row.status,
    boundAt: row.bound_at, releasedAt: row.released_at ?? undefined
  };
}

function calibrationFromRow(row: CalibrationRow): YingxiangCalibrationGroup {
  const ids = JSON.parse(row.event_sample_ids_json) as unknown;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("YINGXIANG_CALIBRATION_DB_CORRUPT");
  return {
    schemaVersion: "yingxiang-calibration-group/0.1", groupId: row.group_id, eventId: row.event_id,
    canonicalSampleId: row.canonical_sample_id, eventSampleIds: ids,
    revealPolicy: row.reveal_policy, createdAt: row.created_at
  };
}

function validateEventContext(context: YingxiangEventContext): YingxiangEventContext {
  if (!context.eventId.normalize("NFKC").trim()) throw new Error("YINGXIANG_EVENT_ID_REQUIRED");
  if (!context.title.normalize("NFKC").trim()) throw new Error("YINGXIANG_EVENT_TITLE_REQUIRED");
  if (!Number.isSafeInteger(context.eventRevision) || context.eventRevision < 1) throw new Error("YINGXIANG_EVENT_REVISION_INVALID");
  validateYingxiangManifest(context.manifest, context.status !== "draft");
  const naming = context.policy.participantName;
  if (context.policy.schemaVersion !== "yingxiang-event-policy/0.1" || context.policy.allowGuestParticipants !== true) throw new Error("YINGXIANG_EVENT_POLICY_INVALID");
  if (!Number.isSafeInteger(naming.minLength) || !Number.isSafeInteger(naming.maxLength)
    || naming.minLength < 1 || naming.maxLength < naming.minLength || naming.maxLength > 64) throw new Error("YINGXIANG_NAME_LENGTH_POLICY_INVALID");
  if (!context.createdAt.trim() || !context.updatedAt.trim()) throw new Error("YINGXIANG_EVENT_TIMESTAMP_REQUIRED");
  return context;
}

function sameEvent(a: YingxiangEvent, b: YingxiangEvent): boolean {
  return a.eventId === b.eventId && a.eventRevision === b.eventRevision && a.hostUserId === b.hostUserId
    && a.title === b.title && a.status === b.status && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt
    && policySignature(a.policy) === policySignature(b.policy) && manifestSignature(a.manifest) === manifestSignature(b.manifest);
}
function sameContext(a: YingxiangEventContext, b: YingxiangEventContext): boolean {
  return a.eventId === b.eventId && a.eventRevision === b.eventRevision && a.title === b.title && a.status === b.status
    && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt
    && policySignature(a.policy) === policySignature(b.policy) && manifestSignature(a.manifest) === manifestSignature(b.manifest);
}

export class YingxiangEventStore {
  constructor(private readonly db: SQLiteDriver) {}

  async putEvent(event: YingxiangEvent, cachedAt = event.updatedAt): Promise<"created" | "updated" | "already_present"> {
    validateYingxiangEvent(event);
    const existing = await this.getEvent(event.eventId);
    if (existing) {
      if (event.eventRevision < existing.eventRevision) throw new Error("YINGXIANG_STALE_EVENT_REVISION");
      if (event.eventRevision === existing.eventRevision && sameEvent(event, existing)) {
        await this.putEventContext(eventContextFromEvent(event), cachedAt);
        return "already_present";
      }
      if (event.eventRevision === existing.eventRevision) throw new Error("YINGXIANG_EVENT_REVISION_CONFLICT");
    }
    await this.db.transaction(async () => {
      await this.db.run(
        `INSERT INTO yingxiang_events
         (event_id, event_revision, host_user_id, title, status, policy_json, manifest_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO UPDATE SET
           event_revision=excluded.event_revision, host_user_id=excluded.host_user_id, title=excluded.title,
           status=excluded.status, policy_json=excluded.policy_json, manifest_json=excluded.manifest_json, updated_at=excluded.updated_at`,
        [event.eventId, event.eventRevision, event.hostUserId, event.title, event.status, policySignature(event.policy), manifestSignature(event.manifest), event.createdAt, event.updatedAt]
      );
      await this.putEventContext(eventContextFromEvent(event), cachedAt);
    });
    return existing ? "updated" : "created";
  }

  async getEvent(eventId: string): Promise<YingxiangEvent | undefined> {
    const row = await this.db.get<EventRow>(
      `SELECT event_id, event_revision, host_user_id, title, status, policy_json, manifest_json, created_at, updated_at
       FROM yingxiang_events WHERE event_id = ?`, [eventId]
    );
    return row ? eventFromRow(row) : undefined;
  }

  async putEventContext(context: YingxiangEventContext, cachedAt: string): Promise<"created" | "updated" | "already_present"> {
    validateEventContext(context);
    if (!cachedAt.trim()) throw new Error("YINGXIANG_EVENT_CACHE_TIMESTAMP_REQUIRED");
    const existing = await this.getEventContext(context.eventId);
    if (existing) {
      if (context.eventRevision < existing.eventRevision) throw new Error("YINGXIANG_STALE_EVENT_REVISION");
      if (context.eventRevision === existing.eventRevision && sameContext(context, existing)) {
        await this.db.run("UPDATE yingxiang_event_contexts SET cached_at = ? WHERE event_id = ?", [cachedAt, context.eventId]);
        return "already_present";
      }
      if (context.eventRevision === existing.eventRevision) throw new Error("YINGXIANG_EVENT_REVISION_CONFLICT");
    }
    await this.db.run(
      `INSERT INTO yingxiang_event_contexts
       (event_id, event_revision, title, status, policy_json, manifest_json, created_at, updated_at, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         event_revision=excluded.event_revision, title=excluded.title, status=excluded.status,
         policy_json=excluded.policy_json, manifest_json=excluded.manifest_json,
         updated_at=excluded.updated_at, cached_at=excluded.cached_at`,
      [context.eventId, context.eventRevision, context.title, context.status, policySignature(context.policy), manifestSignature(context.manifest), context.createdAt, context.updatedAt, cachedAt]
    );
    return existing ? "updated" : "created";
  }

  async getEventContext(eventId: string): Promise<YingxiangEventContext | undefined> {
    const row = await this.db.get<EventContextRow>(
      `SELECT event_id, event_revision, title, status, policy_json, manifest_json, created_at, updated_at, cached_at
       FROM yingxiang_event_contexts WHERE event_id = ?`, [eventId]
    );
    return row ? eventContextFromRow(row) : undefined;
  }

  async putPrincipal(principal: YingxiangEventPrincipal): Promise<void> {
    const context = await this.getEventContext(principal.eventId);
    if (!context) throw new Error("YINGXIANG_EVENT_CONTEXT_NOT_FOUND");
    if (context.status === "draft" || context.status === "completed" || context.status === "cancelled") throw new Error("YINGXIANG_EVENT_NOT_JOINABLE");
    if (principal.status !== "active" || principal.releasedAt) throw new Error("YINGXIANG_NEW_PRINCIPAL_MUST_BE_ACTIVE");
    if (context.policy.participantName.uniqueWithinEvent) {
      const nameOwner = await this.db.get<{ participant_id: string }>(
        `SELECT participant_id FROM yingxiang_event_principals
         WHERE event_id = ? AND status = 'active' AND display_name = ? AND participant_id <> ?`,
        [principal.eventId, principal.displayName, principal.participantId]
      );
      if (nameOwner) throw new Error("YINGXIANG_PARTICIPANT_NAME_CONFLICT");
    }
    const existing = await this.db.get<{ principal_id: string }>(
      "SELECT principal_id FROM yingxiang_event_principals WHERE event_id = ? AND participant_id = ?",
      [principal.eventId, principal.participantId]
    );
    if (existing && existing.principal_id !== principal.principalId) throw new Error("YINGXIANG_PARTICIPANT_ALREADY_BOUND");
    await this.db.run(
      `INSERT INTO yingxiang_event_principals
       (principal_id, event_id, participant_id, identity_kind, account_user_id, display_name, status, bound_at, released_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL)
       ON CONFLICT(event_id, participant_id) DO UPDATE SET
         identity_kind=excluded.identity_kind, account_user_id=excluded.account_user_id, display_name=excluded.display_name,
         status='active', bound_at=excluded.bound_at, released_at=NULL`,
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
       WHERE event_id = ? AND participant_id = ? AND status = 'active'`, [releasedAt, eventId, participantId]
    );
  }
  async releaseAllEventPrincipals(eventId: string, releasedAt: string): Promise<void> {
    await this.db.run(
      `UPDATE yingxiang_event_principals SET status = 'released', released_at = ?
       WHERE event_id = ? AND status = 'active'`, [releasedAt, eventId]
    );
  }

  async putCalibrationGroup(group: YingxiangCalibrationGroup): Promise<void> {
    const context = await this.getEventContext(group.eventId);
    if (!context) throw new Error("YINGXIANG_EVENT_CONTEXT_NOT_FOUND");
    validateCalibrationGroup(group, context.policy);
    const allowed = new Set(context.manifest.samples.map((sample) => sample.eventSampleId));
    if (group.eventSampleIds.some((id) => !allowed.has(id))) throw new Error("YINGXIANG_CALIBRATION_UNKNOWN_EVENT_SAMPLE");
    await this.db.run(
      `INSERT INTO yingxiang_calibration_groups
       (group_id, event_id, canonical_sample_id, event_sample_ids_json, reveal_policy, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(group_id) DO UPDATE SET
         canonical_sample_id=excluded.canonical_sample_id, event_sample_ids_json=excluded.event_sample_ids_json,
         reveal_policy=excluded.reveal_policy`,
      [group.groupId, group.eventId, group.canonicalSampleId, JSON.stringify(group.eventSampleIds), group.revealPolicy, group.createdAt]
    );
  }

  async listCalibrationGroups(eventId: string): Promise<readonly YingxiangCalibrationGroup[]> {
    const context = await this.getEventContext(eventId);
    if (!context) return [];
    const rows = await this.db.all<CalibrationRow>(
      `SELECT group_id, event_id, canonical_sample_id, event_sample_ids_json, reveal_policy, created_at
       FROM yingxiang_calibration_groups WHERE event_id = ? ORDER BY created_at, group_id`, [eventId]
    );
    return rows.map((row) => validateCalibrationGroup(calibrationFromRow(row), context.policy));
  }
}
