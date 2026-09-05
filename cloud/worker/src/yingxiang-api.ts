export interface YingxiangAuthenticatedUser {
  userId: string;
  email: string;
}

type JsonValue = Record<string, unknown> | unknown[];

type ParticipantNamePolicy = {
  mode: "organizer_assigned" | "participant_choice";
  allowAccountDisplayName: boolean;
  uniqueWithinEvent: boolean;
  minLength: number;
  maxLength: number;
  requiredPrefix?: string;
};

type EventPolicy = {
  schemaVersion: "yingxiang-event-policy/0.1";
  allowGuestParticipants: true;
  participantName: ParticipantNamePolicy;
  revealSampleIdentity: "on_event_complete" | "organizer_only";
  calibrationRepeatEnabled: boolean;
};

interface EventRow {
  event_id: string;
  owner_user_id: string;
  event_revision: number;
  title: string;
  status: "draft" | "published" | "active" | "completed" | "cancelled";
  policy_json: string;
  created_at: string;
  updated_at: string;
}

interface InviteRow {
  invite_id: string;
  event_id: string;
  event_revision: number;
  assigned_name: string | null;
  expires_at: string;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
}

function json(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS"
    }
  });
}

function isNonEmptyString(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.normalize("NFKC").trim().length > 0 && value.length <= max;
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function parsePolicy(value: unknown): EventPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const naming = source.participantName;
  if (!naming || typeof naming !== "object" || Array.isArray(naming)) return undefined;
  const n = naming as Record<string, unknown>;
  const minLength = Number(n.minLength);
  const maxLength = Number(n.maxLength);
  const requiredPrefix = n.requiredPrefix === undefined ? undefined : normalizeName(n.requiredPrefix);
  if (source.schemaVersion !== "yingxiang-event-policy/0.1" || source.allowGuestParticipants !== true
    || (source.revealSampleIdentity !== "on_event_complete" && source.revealSampleIdentity !== "organizer_only")
    || typeof source.calibrationRepeatEnabled !== "boolean"
    || (n.mode !== "organizer_assigned" && n.mode !== "participant_choice")
    || typeof n.allowAccountDisplayName !== "boolean" || typeof n.uniqueWithinEvent !== "boolean"
    || !Number.isSafeInteger(minLength) || !Number.isSafeInteger(maxLength) || minLength < 1 || maxLength < minLength || maxLength > 64
    || (n.requiredPrefix !== undefined && !requiredPrefix)) return undefined;
  if (requiredPrefix && Array.from(requiredPrefix).length > maxLength) return undefined;
  return {
    schemaVersion: "yingxiang-event-policy/0.1",
    allowGuestParticipants: true,
    participantName: {
      mode: n.mode,
      allowAccountDisplayName: n.allowAccountDisplayName,
      uniqueWithinEvent: n.uniqueWithinEvent,
      minLength,
      maxLength,
      ...(requiredPrefix ? { requiredPrefix } : {})
    },
    revealSampleIdentity: source.revealSampleIdentity,
    calibrationRepeatEnabled: source.calibrationRepeatEnabled
  };
}

function validateDisplayName(value: unknown, policy: ParticipantNamePolicy): string | undefined {
  const name = normalizeName(value);
  const length = Array.from(name).length;
  if (!name || length < policy.minLength || length > policy.maxLength) return undefined;
  if (policy.requiredPrefix && !name.startsWith(policy.requiredPrefix)) return undefined;
  return name;
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

async function eventById(db: D1Database, eventId: string): Promise<EventRow | null> {
  return db.prepare(`SELECT event_id, owner_user_id, event_revision, title, status, policy_json, created_at, updated_at
    FROM yingxiang_events WHERE event_id = ?1`).bind(eventId).first<EventRow>();
}

async function accountDisplayName(db: D1Database, userId: string): Promise<string | undefined> {
  const row = await db.prepare("SELECT display_name FROM users WHERE user_id = ?1")
    .bind(userId).first<{ display_name: string | null }>();
  return normalizeName(row?.display_name) || undefined;
}

function publicEvent(row: EventRow, policy: EventPolicy): Record<string, unknown> {
  return {
    schemaVersion: "yingxiang-event/0.1",
    eventId: row.event_id,
    eventRevision: row.event_revision,
    title: row.title,
    status: row.status,
    policy,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function inviteFromToken(db: D1Database, token: string): Promise<{ invite: InviteRow; event: EventRow; policy: EventPolicy } | undefined> {
  if (!/^[a-f0-9]{48}$/iu.test(token)) return undefined;
  const hash = await sha256Hex(token.toLowerCase());
  const row = await db.prepare(`SELECT
      i.invite_id, i.event_id, i.event_revision, i.assigned_name, i.expires_at, i.max_uses, i.use_count, i.revoked_at,
      e.owner_user_id, e.event_revision AS current_event_revision, e.title, e.status, e.policy_json, e.created_at, e.updated_at
    FROM yingxiang_invites i JOIN yingxiang_events e ON e.event_id = i.event_id
    WHERE i.token_hash = ?1`).bind(hash).first<Record<string, unknown>>();
  if (!row) return undefined;
  const policy = parsePolicy(JSON.parse(String(row.policy_json ?? "null")));
  if (!policy) throw new Error("YINGXIANG_EVENT_POLICY_CORRUPT");
  const invite: InviteRow = {
    invite_id: String(row.invite_id), event_id: String(row.event_id), event_revision: Number(row.event_revision),
    assigned_name: row.assigned_name === null ? null : String(row.assigned_name), expires_at: String(row.expires_at),
    max_uses: row.max_uses === null ? null : Number(row.max_uses), use_count: Number(row.use_count),
    revoked_at: row.revoked_at === null ? null : String(row.revoked_at)
  };
  const event: EventRow = {
    event_id: String(row.event_id), owner_user_id: String(row.owner_user_id), event_revision: Number(row.current_event_revision),
    title: String(row.title), status: String(row.status) as EventRow["status"], policy_json: String(row.policy_json),
    created_at: String(row.created_at), updated_at: String(row.updated_at)
  };
  return { invite, event, policy };
}

function inviteUnavailableReason(invite: InviteRow, event: EventRow, now: string): string | undefined {
  if (invite.revoked_at) return "YINGXIANG_INVITE_REVOKED";
  if (invite.expires_at <= now) return "YINGXIANG_INVITE_EXPIRED";
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) return "YINGXIANG_INVITE_EXHAUSTED";
  if (invite.event_revision !== event.event_revision) return "YINGXIANG_INVITE_STALE_REVISION";
  if (event.status === "draft" || event.status === "completed" || event.status === "cancelled") return "YINGXIANG_EVENT_NOT_JOINABLE";
  return undefined;
}

async function handleInviteGet(token: string, db: D1Database): Promise<Response> {
  const resolved = await inviteFromToken(db, token);
  if (!resolved) return json({ ok: false, error: "YINGXIANG_INVITE_NOT_FOUND" }, 404);
  const reason = inviteUnavailableReason(resolved.invite, resolved.event, new Date().toISOString());
  if (reason) return json({ ok: false, error: reason }, 410);
  return json({
    ok: true,
    event: publicEvent(resolved.event, resolved.policy),
    invite: {
      inviteId: resolved.invite.invite_id,
      assignedName: resolved.policy.participantName.mode === "organizer_assigned" ? resolved.invite.assigned_name : undefined,
      expiresAt: resolved.invite.expires_at,
      remainingUses: resolved.invite.max_uses === null ? null : Math.max(0, resolved.invite.max_uses - resolved.invite.use_count)
    }
  });
}

async function handleInviteJoin(token: string, request: Request, db: D1Database, user?: YingxiangAuthenticatedUser): Promise<Response> {
  const resolved = await inviteFromToken(db, token);
  if (!resolved) return json({ ok: false, error: "YINGXIANG_INVITE_NOT_FOUND" }, 404);
  const now = new Date().toISOString();
  const reason = inviteUnavailableReason(resolved.invite, resolved.event, now);
  if (reason) return json({ ok: false, error: reason }, 410);
  const body = await parseJsonObject(request);
  if (!body) return json({ ok: false, error: "INVALID_JSON" }, 400);

  const naming = resolved.policy.participantName;
  let displayName: string | undefined;
  if (naming.mode === "organizer_assigned") {
    displayName = validateDisplayName(resolved.invite.assigned_name, naming);
    if (!displayName) return json({ ok: false, error: "YINGXIANG_ASSIGNED_NAME_MISSING" }, 409);
  } else if (body.nameSource === "account") {
    if (!user) return json({ ok: false, error: "YINGXIANG_ACCOUNT_REQUIRED_FOR_ACCOUNT_NAME" }, 401);
    if (!naming.allowAccountDisplayName) return json({ ok: false, error: "YINGXIANG_ACCOUNT_NAME_NOT_ALLOWED" }, 403);
    const verifiedAccountName = await accountDisplayName(db, user.userId);
    if (!verifiedAccountName) return json({ ok: false, error: "YINGXIANG_ACCOUNT_NAME_UNAVAILABLE" }, 409);
    displayName = validateDisplayName(verifiedAccountName, naming);
    if (!displayName) return json({ ok: false, error: "YINGXIANG_ACCOUNT_NAME_POLICY_MISMATCH" }, 409);
  } else {
    displayName = validateDisplayName(body.displayName, naming);
    if (!displayName) return json({ ok: false, error: "YINGXIANG_PARTICIPANT_NAME_INVALID" }, 400);
  }

  const participantId = crypto.randomUUID();
  const identityKind = user ? "account" : "guest";
  try {
    await db.prepare(`INSERT INTO yingxiang_participants
      (participant_id, event_id, invite_id, account_user_id, identity_kind, display_name, status, joined_at, released_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, NULL)`)
      .bind(participantId, resolved.event.event_id, resolved.invite.invite_id, user?.userId ?? null, identityKind, displayName, now).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("YINGXIANG_INVITE_")) return json({ ok: false, error: message.match(/YINGXIANG_INVITE_[A-Z_]+/u)?.[0] ?? "YINGXIANG_INVITE_UNAVAILABLE" }, 410);
    if (message.includes("YINGXIANG_PARTICIPANT_NAME_CONFLICT")) return json({ ok: false, error: "YINGXIANG_PARTICIPANT_NAME_CONFLICT" }, 409);
    if (message.toLowerCase().includes("unique")) return json({ ok: false, error: "YINGXIANG_PARTICIPANT_CONFLICT" }, 409);
    return json({ ok: false, error: "YINGXIANG_JOIN_FAILED" }, 409);
  }

  return json({
    ok: true,
    principal: {
      schemaVersion: "yingxiang-principal/0.1",
      participantId,
      eventId: resolved.event.event_id,
      identityKind,
      accountUserId: user?.userId,
      displayName,
      accountDisplayNameHidden: true,
      status: "active",
      boundAt: now
    },
    event: publicEvent(resolved.event, resolved.policy)
  }, 201);
}

async function handleEventCreate(request: Request, db: D1Database, user: YingxiangAuthenticatedUser): Promise<Response> {
  const body = await parseJsonObject(request);
  if (!body) return json({ ok: false, error: "INVALID_JSON" }, 400);
  const title = normalizeName(body.title);
  const policy = parsePolicy(body.policy);
  if (!title || Array.from(title).length > 120 || !policy) return json({ ok: false, error: "YINGXIANG_EVENT_PAYLOAD_INVALID" }, 400);
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const status = body.publish === false ? "draft" : "published";
  await db.prepare(`INSERT INTO yingxiang_events
    (event_id, owner_user_id, event_revision, title, status, policy_json, created_at, updated_at)
    VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?6)`)
    .bind(eventId, user.userId, title, status, JSON.stringify(policy), now).run();
  const row = await eventById(db, eventId);
  return json({ ok: true, event: publicEvent(row!, policy) }, 201);
}

async function handleInviteCreate(eventId: string, request: Request, db: D1Database, user: YingxiangAuthenticatedUser, publicAppUrl?: string): Promise<Response> {
  const event = await eventById(db, eventId);
  if (!event || event.owner_user_id !== user.userId) return json({ ok: false, error: "YINGXIANG_EVENT_NOT_FOUND" }, 404);
  if (event.status !== "published" && event.status !== "active") return json({ ok: false, error: "YINGXIANG_EVENT_NOT_SHAREABLE" }, 409);
  const policy = parsePolicy(JSON.parse(event.policy_json));
  if (!policy) return json({ ok: false, error: "YINGXIANG_EVENT_POLICY_CORRUPT" }, 500);
  const body = await parseJsonObject(request) ?? {};
  const assignedName = normalizeName(body.assignedName) || null;
  if (policy.participantName.mode === "organizer_assigned" && !validateDisplayName(assignedName, policy.participantName)) {
    return json({ ok: false, error: "YINGXIANG_ASSIGNED_NAME_REQUIRED" }, 400);
  }
  const maxUsesValue = body.maxUses === undefined || body.maxUses === null ? null : Number(body.maxUses);
  if (maxUsesValue !== null && (!Number.isSafeInteger(maxUsesValue) || maxUsesValue < 1 || maxUsesValue > 10000)) {
    return json({ ok: false, error: "YINGXIANG_INVITE_MAX_USES_INVALID" }, 400);
  }
  const rawExpiry = isNonEmptyString(body.expiresAt, 64) ? String(body.expiresAt) : undefined;
  const expiryMs = rawExpiry ? Date.parse(rawExpiry) : Date.now() + 24 * 60 * 60 * 1000;
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) return json({ ok: false, error: "YINGXIANG_INVITE_EXPIRY_INVALID" }, 400);
  const expiresAt = new Date(expiryMs).toISOString();

  const inviteId = crypto.randomUUID();
  const token = randomHex(24);
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO yingxiang_invites
    (invite_id, event_id, event_revision, token_hash, assigned_name, expires_at, max_uses, use_count, created_at, revoked_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, NULL)`)
    .bind(inviteId, eventId, event.event_revision, tokenHash, assignedName, expiresAt, maxUsesValue, now).run();

  const appBase = publicAppUrl?.trim().replace(/\/$/u, "");
  return json({
    ok: true,
    inviteId,
    eventId,
    eventRevision: event.event_revision,
    token,
    expiresAt,
    maxUses: maxUsesValue,
    share: {
      deepLink: `aromasense://yingxiang/invite/${token}`,
      webUrl: appBase ? `${appBase}/?yingxiangInvite=${encodeURIComponent(token)}` : undefined
    }
  }, 201);
}

async function handleAccountDisplayName(request: Request, db: D1Database, user: YingxiangAuthenticatedUser): Promise<Response> {
  const body = await parseJsonObject(request);
  if (!body) return json({ ok: false, error: "INVALID_JSON" }, 400);
  const displayName = normalizeName(body.displayName);
  const length = Array.from(displayName).length;
  if (!displayName || length < 1 || length > 64) return json({ ok: false, error: "YINGXIANG_ACCOUNT_NAME_INVALID" }, 400);
  await db.prepare("UPDATE users SET display_name = ?1 WHERE user_id = ?2").bind(displayName, user.userId).run();
  return json({ ok: true, displayName });
}

async function handleCalibrationCreate(eventId: string, request: Request, db: D1Database, user: YingxiangAuthenticatedUser): Promise<Response> {
  const event = await eventById(db, eventId);
  if (!event || event.owner_user_id !== user.userId) return json({ ok: false, error: "YINGXIANG_EVENT_NOT_FOUND" }, 404);
  const policy = parsePolicy(JSON.parse(event.policy_json));
  if (!policy?.calibrationRepeatEnabled) return json({ ok: false, error: "YINGXIANG_CALIBRATION_DISABLED" }, 409);
  const body = await parseJsonObject(request);
  const canonicalSampleId = normalizeName(body?.canonicalSampleId);
  const rawIds = body?.eventSampleIds;
  if (!canonicalSampleId || !Array.isArray(rawIds)) return json({ ok: false, error: "YINGXIANG_CALIBRATION_INVALID" }, 400);
  const eventSampleIds = rawIds.map(normalizeName);
  if (eventSampleIds.length < 2 || eventSampleIds.some((id) => !id) || new Set(eventSampleIds).size !== eventSampleIds.length) {
    return json({ ok: false, error: "YINGXIANG_CALIBRATION_INVALID" }, 400);
  }
  const revealPolicy = body?.revealPolicy === "organizer_only" ? "organizer_only" : "after_event";
  const groupId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO yingxiang_calibration_groups
    (group_id, event_id, canonical_sample_id, event_sample_ids_json, reveal_policy, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(groupId, eventId, canonicalSampleId, JSON.stringify(eventSampleIds), revealPolicy, now).run();
  return json({ ok: true, groupId, eventId, eventSampleIds, revealPolicy }, 201);
}

async function handleEventComplete(eventId: string, db: D1Database, user: YingxiangAuthenticatedUser): Promise<Response> {
  const event = await eventById(db, eventId);
  if (!event || event.owner_user_id !== user.userId) return json({ ok: false, error: "YINGXIANG_EVENT_NOT_FOUND" }, 404);
  if (event.status === "cancelled") return json({ ok: false, error: "YINGXIANG_EVENT_CANCELLED" }, 409);
  if (event.status === "completed") return json({ ok: true, eventId, status: "completed", eventRevision: event.event_revision });
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE yingxiang_events SET status = 'completed', event_revision = event_revision + 1, updated_at = ?1 WHERE event_id = ?2 AND owner_user_id = ?3`).bind(now, eventId, user.userId),
    db.prepare(`UPDATE yingxiang_participants SET status = 'released', released_at = ?1 WHERE event_id = ?2 AND status = 'active'`).bind(now, eventId),
    db.prepare(`UPDATE yingxiang_invites SET revoked_at = COALESCE(revoked_at, ?1) WHERE event_id = ?2`).bind(now, eventId)
  ]);
  const updated = await eventById(db, eventId);
  return json({ ok: true, eventId, status: "completed", eventRevision: updated?.event_revision, releasedAt: now });
}

export async function handleYingxiangPublicRoute(
  request: Request,
  url: URL,
  db: D1Database,
  user?: YingxiangAuthenticatedUser
): Promise<Response | undefined> {
  const match = url.pathname.match(/^\/api\/v1\/yingxiang\/invites\/([a-f0-9]{48})(?:\/(join))?$/iu);
  if (!match) return undefined;
  const token = match[1];
  if (request.method === "GET" && !match[2]) return handleInviteGet(token, db);
  if (request.method === "POST" && match[2] === "join") return handleInviteJoin(token, request, db, user);
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}

export async function handleYingxiangAuthenticatedRoute(
  request: Request,
  url: URL,
  db: D1Database,
  user: YingxiangAuthenticatedUser,
  publicAppUrl?: string
): Promise<Response | undefined> {
  if (url.pathname === "/api/v1/yingxiang/events" && request.method === "POST") return handleEventCreate(request, db, user);
  if (url.pathname === "/api/v1/yingxiang/account-display-name" && request.method === "POST") return handleAccountDisplayName(request, db, user);

  const inviteMatch = url.pathname.match(/^\/api\/v1\/yingxiang\/events\/([^/]+)\/invites$/u);
  if (inviteMatch && request.method === "POST") return handleInviteCreate(decodeURIComponent(inviteMatch[1]), request, db, user, publicAppUrl);

  const calibrationMatch = url.pathname.match(/^\/api\/v1\/yingxiang\/events\/([^/]+)\/calibration-groups$/u);
  if (calibrationMatch && request.method === "POST") return handleCalibrationCreate(decodeURIComponent(calibrationMatch[1]), request, db, user);

  const completeMatch = url.pathname.match(/^\/api\/v1\/yingxiang\/events\/([^/]+)\/complete$/u);
  if (completeMatch && request.method === "POST") return handleEventComplete(decodeURIComponent(completeMatch[1]), db, user);

  return undefined;
}
