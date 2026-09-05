export const YINGXIANG_EVENT_SCHEMA_VERSION = "yingxiang-event/0.1" as const;
export const YINGXIANG_PRINCIPAL_SCHEMA_VERSION = "yingxiang-principal/0.1" as const;
export const YINGXIANG_MANIFEST_SCHEMA_VERSION = "yingxiang-event-manifest/0.1" as const;

export type YingxiangEventStatus = "draft" | "published" | "active" | "completed" | "cancelled";
export type YingxiangPrincipalStatus = "active" | "released";
export type YingxiangIdentityKind = "guest" | "account";
export type YingxiangCuppingMode = "open" | "blind" | "semi_blind";

export interface YingxiangParticipantNamePolicy {
  mode: "organizer_assigned" | "participant_choice";
  allowAccountDisplayName: boolean;
  uniqueWithinEvent: boolean;
  minLength: number;
  maxLength: number;
  requiredPrefix?: string;
}

export interface YingxiangEventPolicy {
  schemaVersion: "yingxiang-event-policy/0.1";
  /** Participants may join without registering. Host registration remains mandatory. */
  allowGuestParticipants: true;
  participantName: YingxiangParticipantNamePolicy;
  revealSampleIdentity: "on_event_complete" | "organizer_only";
  calibrationRepeatEnabled: boolean;
}

export interface YingxiangEventSampleSlot {
  /** Stable inside one event. It does not expose the canonical coffee identity. */
  eventSampleId: string;
  sampleCode: string;
  order: number;
  /** Optional participant-safe label only; never place hidden coffee identity here for blind events. */
  label?: string;
}

export interface YingxiangEventManifest {
  schemaVersion: typeof YINGXIANG_MANIFEST_SCHEMA_VERSION;
  organizerName: string;
  cuppingMode: YingxiangCuppingMode;
  samples: readonly YingxiangEventSampleSlot[];
}

export interface YingxiangEvent {
  schemaVersion: typeof YINGXIANG_EVENT_SCHEMA_VERSION;
  eventId: string;
  eventRevision: number;
  hostUserId: string;
  title: string;
  status: YingxiangEventStatus;
  policy: YingxiangEventPolicy;
  manifest: YingxiangEventManifest;
  createdAt: string;
  updatedAt: string;
}

export interface YingxiangJoinIdentityInput {
  participantId: string;
  accountUserId?: string;
  accountDisplayName?: string;
  organizerAssignedName?: string;
  requestedName?: string;
  useAccountDisplayName?: boolean;
  participantOrdinal?: number;
}

export interface YingxiangEventPrincipal {
  schemaVersion: typeof YINGXIANG_PRINCIPAL_SCHEMA_VERSION;
  principalId: string;
  eventId: string;
  participantId: string;
  identityKind: YingxiangIdentityKind;
  accountUserId?: string;
  /** Event-scoped name. This is the only name exposed while the event principal is active. */
  displayName: string;
  accountDisplayNameHidden: true;
  status: YingxiangPrincipalStatus;
  boundAt: string;
  releasedAt?: string;
}

export interface YingxiangCalibrationGroup {
  schemaVersion: "yingxiang-calibration-group/0.1";
  groupId: string;
  eventId: string;
  canonicalSampleId: string;
  /** Event sample identities that secretly point to the same physical coffee. */
  eventSampleIds: readonly string[];
  revealPolicy: "after_event" | "organizer_only";
  createdAt: string;
}

export interface EffectiveIdentity {
  scope: "event" | "personal" | "guest";
  displayName: string;
  accountUserId?: string;
  eventId?: string;
  participantId?: string;
}

function normalizedRequired(value: string, code: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

export function defaultYingxiangEventPolicy(): YingxiangEventPolicy {
  return {
    schemaVersion: "yingxiang-event-policy/0.1",
    allowGuestParticipants: true,
    participantName: {
      mode: "participant_choice",
      allowAccountDisplayName: true,
      uniqueWithinEvent: true,
      minLength: 1,
      maxLength: 24
    },
    revealSampleIdentity: "on_event_complete",
    calibrationRepeatEnabled: true
  };
}

export function buildYingxiangManifest(input: {
  organizerName: string;
  cuppingMode: YingxiangCuppingMode;
  sampleCodes: readonly string[];
}): YingxiangEventManifest {
  const organizerName = normalizedRequired(input.organizerName, "YINGXIANG_ORGANIZER_NAME_REQUIRED");
  if (!(["open", "blind", "semi_blind"] as const).includes(input.cuppingMode)) throw new Error("YINGXIANG_CUPPING_MODE_INVALID");
  const codes = input.sampleCodes.map((code) => normalizedRequired(code, "YINGXIANG_SAMPLE_CODE_REQUIRED"));
  if (codes.length === 0) throw new Error("YINGXIANG_SAMPLE_REQUIRED");
  if (new Set(codes).size !== codes.length) throw new Error("YINGXIANG_SAMPLE_CODE_DUPLICATE");
  return {
    schemaVersion: YINGXIANG_MANIFEST_SCHEMA_VERSION,
    organizerName,
    cuppingMode: input.cuppingMode,
    samples: codes.map((sampleCode, index) => ({
      eventSampleId: `slot-${String(index + 1).padStart(3, "0")}`,
      sampleCode,
      order: index + 1
    }))
  };
}

export function validateYingxiangManifest(manifest: YingxiangEventManifest, requireSamples = true): YingxiangEventManifest {
  if (manifest.schemaVersion !== YINGXIANG_MANIFEST_SCHEMA_VERSION) throw new Error("YINGXIANG_MANIFEST_VERSION_INVALID");
  normalizedRequired(manifest.organizerName, "YINGXIANG_ORGANIZER_NAME_REQUIRED");
  if (!(["open", "blind", "semi_blind"] as const).includes(manifest.cuppingMode)) throw new Error("YINGXIANG_CUPPING_MODE_INVALID");
  if (requireSamples && manifest.samples.length === 0) throw new Error("YINGXIANG_SAMPLE_REQUIRED");
  const ids = new Set<string>();
  const codes = new Set<string>();
  const orders = new Set<number>();
  for (const sample of manifest.samples) {
    const id = normalizedRequired(sample.eventSampleId, "YINGXIANG_EVENT_SAMPLE_ID_REQUIRED");
    const code = normalizedRequired(sample.sampleCode, "YINGXIANG_SAMPLE_CODE_REQUIRED");
    if (!Number.isSafeInteger(sample.order) || sample.order < 1) throw new Error("YINGXIANG_SAMPLE_ORDER_INVALID");
    if (ids.has(id)) throw new Error("YINGXIANG_EVENT_SAMPLE_ID_DUPLICATE");
    if (codes.has(code)) throw new Error("YINGXIANG_SAMPLE_CODE_DUPLICATE");
    if (orders.has(sample.order)) throw new Error("YINGXIANG_SAMPLE_ORDER_DUPLICATE");
    ids.add(id); codes.add(code); orders.add(sample.order);
    // Older local signatures encoded an absent optional label as JSON null.
    // Treat null like undefined when validating persisted participant-safe manifests.
    if (sample.label != null) normalizedRequired(sample.label, "YINGXIANG_SAMPLE_LABEL_INVALID");
  }
  const sortedOrders = [...orders].sort((a, b) => a - b);
  if (sortedOrders.some((value, index) => value !== index + 1)) throw new Error("YINGXIANG_SAMPLE_ORDER_NOT_CONTIGUOUS");
  return manifest;
}

export function validateYingxiangEvent(event: YingxiangEvent): YingxiangEvent {
  normalizedRequired(event.eventId, "YINGXIANG_EVENT_ID_REQUIRED");
  normalizedRequired(event.hostUserId, "YINGXIANG_HOST_ACCOUNT_REQUIRED");
  normalizedRequired(event.title, "YINGXIANG_EVENT_TITLE_REQUIRED");
  if (!Number.isSafeInteger(event.eventRevision) || event.eventRevision < 1) throw new Error("YINGXIANG_EVENT_REVISION_INVALID");
  validateYingxiangManifest(event.manifest, event.status !== "draft");
  const naming = event.policy.participantName;
  if (event.policy.allowGuestParticipants !== true) throw new Error("YINGXIANG_GUEST_SUPPORT_REQUIRED");
  if (!Number.isSafeInteger(naming.minLength) || !Number.isSafeInteger(naming.maxLength)
    || naming.minLength < 1 || naming.maxLength < naming.minLength || naming.maxLength > 64) {
    throw new Error("YINGXIANG_NAME_LENGTH_POLICY_INVALID");
  }
  if (naming.requiredPrefix !== undefined && naming.requiredPrefix.normalize("NFKC").trim().length > naming.maxLength) {
    throw new Error("YINGXIANG_NAME_PREFIX_INVALID");
  }
  return event;
}

export function validateParticipantName(name: string, policy: YingxiangParticipantNamePolicy): string {
  const normalized = normalizedRequired(name, "YINGXIANG_PARTICIPANT_NAME_REQUIRED");
  const length = Array.from(normalized).length;
  if (length < policy.minLength || length > policy.maxLength) throw new Error("YINGXIANG_PARTICIPANT_NAME_LENGTH_INVALID");
  const prefix = policy.requiredPrefix?.normalize("NFKC").trim();
  if (prefix && !normalized.startsWith(prefix)) throw new Error("YINGXIANG_PARTICIPANT_NAME_PREFIX_REQUIRED");
  return normalized;
}

export function selectEventDisplayName(input: YingxiangJoinIdentityInput, policy: YingxiangParticipantNamePolicy): string {
  const assigned = input.organizerAssignedName?.normalize("NFKC").trim();
  if (policy.mode === "organizer_assigned") {
    if (!assigned) throw new Error("YINGXIANG_ORGANIZER_ASSIGNED_NAME_REQUIRED");
    return validateParticipantName(assigned, policy);
  }

  const requested = input.requestedName?.normalize("NFKC").trim();
  if (requested) return validateParticipantName(requested, policy);

  if (input.useAccountDisplayName === true) {
    if (!policy.allowAccountDisplayName) throw new Error("YINGXIANG_ACCOUNT_NAME_NOT_ALLOWED");
    if (!input.accountUserId) throw new Error("YINGXIANG_ACCOUNT_REQUIRED_FOR_ACCOUNT_NAME");
    return validateParticipantName(input.accountDisplayName ?? "", policy);
  }

  if (assigned) return validateParticipantName(assigned, policy);
  const ordinal = input.participantOrdinal;
  if (Number.isSafeInteger(ordinal) && Number(ordinal) > 0) {
    return validateParticipantName(`参与者${String(ordinal).padStart(2, "0")}`, policy);
  }
  throw new Error("YINGXIANG_PARTICIPANT_NAME_REQUIRED");
}

export function bindEventPrincipal(
  event: YingxiangEvent,
  input: YingxiangJoinIdentityInput,
  principalId: string,
  now: string
): YingxiangEventPrincipal {
  validateYingxiangEvent(event);
  if (event.status === "draft" || event.status === "completed" || event.status === "cancelled") throw new Error("YINGXIANG_EVENT_NOT_JOINABLE");
  const participantId = normalizedRequired(input.participantId, "YINGXIANG_PARTICIPANT_ID_REQUIRED");
  const accountUserId = input.accountUserId?.normalize("NFKC").trim() || undefined;
  const displayName = selectEventDisplayName({ ...input, accountUserId }, event.policy.participantName);
  return {
    schemaVersion: YINGXIANG_PRINCIPAL_SCHEMA_VERSION,
    principalId: normalizedRequired(principalId, "YINGXIANG_PRINCIPAL_ID_REQUIRED"),
    eventId: event.eventId,
    participantId,
    identityKind: accountUserId ? "account" : "guest",
    accountUserId,
    displayName,
    accountDisplayNameHidden: true,
    status: "active",
    boundAt: normalizedRequired(now, "YINGXIANG_BOUND_AT_REQUIRED")
  };
}

export function releaseEventPrincipal(principal: YingxiangEventPrincipal, now: string): YingxiangEventPrincipal {
  if (principal.status === "released") return principal;
  return { ...principal, status: "released", releasedAt: normalizedRequired(now, "YINGXIANG_RELEASED_AT_REQUIRED") };
}

export function resolveEffectiveIdentity(input: {
  eventPrincipal?: YingxiangEventPrincipal;
  personalAccount?: { userId: string; displayName: string };
}): EffectiveIdentity {
  if (input.eventPrincipal?.status === "active") {
    return {
      scope: "event",
      displayName: input.eventPrincipal.displayName,
      accountUserId: input.eventPrincipal.accountUserId,
      eventId: input.eventPrincipal.eventId,
      participantId: input.eventPrincipal.participantId
    };
  }
  if (input.personalAccount) {
    return { scope: "personal", displayName: input.personalAccount.displayName, accountUserId: input.personalAccount.userId };
  }
  return { scope: "guest", displayName: "访客" };
}

export function validateCalibrationGroup(group: YingxiangCalibrationGroup, policy: YingxiangEventPolicy): YingxiangCalibrationGroup {
  if (!policy.calibrationRepeatEnabled) throw new Error("YINGXIANG_CALIBRATION_DISABLED");
  normalizedRequired(group.groupId, "YINGXIANG_CALIBRATION_GROUP_ID_REQUIRED");
  normalizedRequired(group.eventId, "YINGXIANG_EVENT_ID_REQUIRED");
  normalizedRequired(group.canonicalSampleId, "YINGXIANG_CANONICAL_SAMPLE_ID_REQUIRED");
  const ids = group.eventSampleIds.map((id) => normalizedRequired(id, "YINGXIANG_EVENT_SAMPLE_ID_REQUIRED"));
  if (ids.length < 2) throw new Error("YINGXIANG_CALIBRATION_REQUIRES_REPEAT");
  if (new Set(ids).size !== ids.length) throw new Error("YINGXIANG_CALIBRATION_SAMPLE_DUPLICATE");
  return group;
}
