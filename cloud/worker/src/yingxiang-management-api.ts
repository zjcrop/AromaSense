import { aggregateYingxiangResults, validateYingxiangSubmission, type CalibrationMapping, type CollectedResult } from "../../../shared/yingxiang-results";
import { eventById, eventContracts, json, normalizeName, parseJsonObject, parseManifest, parsePolicy, publicEvent, sha256Hex, type YingxiangAuthenticatedUser } from "./yingxiang-api";

type AccessRow = { participant_id: string; event_id: string; event_revision: number; display_name: string; status: string; released_at: string | null };
type SubmissionRow = { revision: number; session_id: string; content_hash: string; bundle_json: string; received_at: string };

async function groupsFor(db: D1Database, eventId: string): Promise<CalibrationMapping[]> {
  const rows = await db.prepare("SELECT group_id, canonical_sample_id, event_sample_ids_json, reveal_policy FROM yingxiang_calibration_groups WHERE event_id = ?1 ORDER BY created_at, group_id").bind(eventId).all<{ group_id: string; canonical_sample_id: string; event_sample_ids_json: string; reveal_policy: CalibrationMapping["revealPolicy"] }>();
  return rows.results.map(r => ({ groupId:r.group_id,canonicalSampleId:r.canonical_sample_id,eventSampleIds:JSON.parse(r.event_sample_ids_json),revealPolicy:r.reveal_policy }));
}
async function latestSubmission(db: D1Database, participantId: string): Promise<SubmissionRow | null> {
  return db.prepare("SELECT revision, session_id, content_hash, bundle_json, received_at FROM yingxiang_submissions WHERE participant_id = ?1 ORDER BY revision DESC LIMIT 1").bind(participantId).first<SubmissionRow>();
}

export async function handleYingxiangParticipantRoute(request: Request, url: URL, db: D1Database): Promise<Response | undefined> {
  const match = url.pathname.match(/^\/api\/v1\/yingxiang\/participants\/([^/]+)\/(status|progress|submissions|leave)$/);
  if (!match) return undefined;
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return json({ok:false,error:"UNAUTHORIZED"},401);
  const p = await db.prepare(`SELECT p.participant_id, p.event_id, a.event_revision, p.display_name, p.status, p.released_at
    FROM yingxiang_participants p JOIN yingxiang_participant_access a ON a.participant_id = p.participant_id
    WHERE p.participant_id = ?1 AND a.token_hash = ?2`).bind(decodeURIComponent(match[1]),await sha256Hex(token)).first<AccessRow>();
  if (!p) return json({ok:false,error:"UNAUTHORIZED"},401);
  const event = await eventById(db,p.event_id); const contracts = event && eventContracts(event);
  if (!event || !contracts) return json({ok:false,error:"YINGXIANG_EVENT_NOT_FOUND"},404);
  if (match[2] === "status" && request.method === "GET") {
    const latest = await latestSubmission(db,p.participant_id);
    return json({ok:true,event:publicEvent({...event,event_revision:p.event_revision},contracts.policy,contracts.manifest),participant:{participantId:p.participant_id,displayName:p.display_name,status:p.status,releasedAt:p.released_at},ack:latest ? {revision:latest.revision,contentHash:latest.content_hash,receivedAt:latest.received_at} : null});
  }
  if (request.method !== "POST") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  if (match[2] === "leave") {
    const now = new Date().toISOString();
    await db.prepare("UPDATE yingxiang_participants SET status = 'released', released_at = COALESCE(released_at, ?1) WHERE participant_id = ?2").bind(now,p.participant_id).run();
    return json({ok:true,status:"released",releasedAt:p.released_at ?? now});
  }
  const body = await parseJsonObject(request); if (!body) return json({ok:false,error:"INVALID_JSON"},400);
  if (match[2] === "submissions") {
    let bundle;
    try { bundle = await validateYingxiangSubmission(body.bundle,p.event_id,p.event_revision,contracts.manifest.samples); }
    catch (e) { return json({ok:false,error:e instanceof Error && e.message.startsWith("YINGXIANG_") ? e.message : "YINGXIANG_SUBMISSION_INVALID"},400); }
    const existing = await db.prepare("SELECT content_hash FROM yingxiang_submissions WHERE participant_id = ?1 AND revision = ?2").bind(p.participant_id,bundle.revision).first<{content_hash:string}>();
    if (existing) return existing.content_hash === bundle.contentHash ? json({ok:true,revision:bundle.revision,contentHash:bundle.contentHash,status:"already_present"}) : json({ok:false,error:"YINGXIANG_SUBMISSION_CONFLICT"},409);
    if (p.status !== "active" || !["published","active"].includes(event.status)) return json({ok:false,error:"YINGXIANG_PARTICIPANT_RELEASED"},410);
    try {
      await db.prepare(`INSERT INTO yingxiang_submissions (participant_id,revision,event_revision,session_id,content_hash,bundle_json,received_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(participant_id,revision) DO NOTHING`)
        .bind(p.participant_id,bundle.revision,p.event_revision,bundle.record.session.sessionId,bundle.contentHash,JSON.stringify(bundle),new Date().toISOString()).run();
      const saved = await db.prepare("SELECT content_hash FROM yingxiang_submissions WHERE participant_id = ?1 AND revision = ?2").bind(p.participant_id,bundle.revision).first<{content_hash:string}>();
      if (saved?.content_hash !== bundle.contentHash) return json({ok:false,error:"YINGXIANG_SUBMISSION_CONFLICT"},409);
      return json({ok:true,revision:bundle.revision,contentHash:bundle.contentHash,status:"created"},201);
    } catch (e) { return json({ok:false,error:e instanceof Error ? e.message.match(/YINGXIANG_[A-Z_]+/)?.[0] ?? "YINGXIANG_SUBMISSION_FAILED" : "YINGXIANG_SUBMISSION_FAILED"},409); }
  }
  if (p.status !== "active" || !["published","active"].includes(event.status)) return json({ok:false,error:"YINGXIANG_PARTICIPANT_RELEASED"},410);
  const { sessionId, sequence, completedSamples, totalSamples } = body;
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 128 || !Number.isSafeInteger(sequence) || Number(sequence) < 1
    || !Number.isSafeInteger(completedSamples) || Number(completedSamples) < 0 || Number(completedSamples) > contracts.manifest.samples.length
    || totalSamples !== contracts.manifest.samples.length) return json({ok:false,error:"YINGXIANG_PROGRESS_INVALID"},400);
  const prior = await db.prepare("SELECT session_id FROM yingxiang_progress WHERE participant_id = ?1 UNION SELECT session_id FROM yingxiang_submissions WHERE participant_id = ?1 LIMIT 1").bind(p.participant_id).first<{session_id:string}>();
  if (prior && prior.session_id !== sessionId) return json({ok:false,error:"YINGXIANG_SESSION_CONFLICT"},409);
  await db.prepare(`INSERT INTO yingxiang_progress (participant_id,session_id,sequence,completed_samples,total_samples,updated_at)
    SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS (SELECT 1 FROM yingxiang_participants p JOIN yingxiang_events e ON e.event_id = p.event_id WHERE p.participant_id = ?1 AND p.status = 'active' AND e.status IN ('published','active'))
    ON CONFLICT(participant_id) DO UPDATE SET sequence=excluded.sequence,completed_samples=excluded.completed_samples,total_samples=excluded.total_samples,updated_at=excluded.updated_at
    WHERE excluded.sequence > yingxiang_progress.sequence AND excluded.session_id = yingxiang_progress.session_id`)
    .bind(p.participant_id,sessionId,sequence,completedSamples,totalSamples,new Date().toISOString()).run();
  return json({ok:true});
}

async function cancelEvent(db: D1Database, eventId: string, userId: string, status: string): Promise<Response> {
  if (status === "completed") return json({ok:false,error:"YINGXIANG_EVENT_ALREADY_COMPLETED"},409);
  if (status === "cancelled") return json({ok:true,eventId,status:"cancelled"});
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE yingxiang_events SET status='cancelled',event_revision=event_revision+1,updated_at=?1 WHERE event_id=?2 AND owner_user_id=?3 AND status IN ('draft','published','active')").bind(now,eventId,userId),
    db.prepare("UPDATE yingxiang_participants SET status='released',released_at=COALESCE(released_at,?1) WHERE event_id=?2 AND status='active'").bind(now,eventId),
    db.prepare("UPDATE yingxiang_invites SET revoked_at=COALESCE(revoked_at,?1) WHERE event_id=?2").bind(now,eventId)
  ]);
  return json({ok:true,eventId,status:"cancelled",cancelledAt:now});
}

async function deleteEvent(db: D1Database, eventId: string, userId: string, status: string): Promise<Response> {
  if (!['draft','cancelled'].includes(status)) return json({ok:false,error:"YINGXIANG_EVENT_DELETE_REQUIRES_CANCEL"},409);
  await db.batch([
    db.prepare("DELETE FROM yingxiang_submissions WHERE participant_id IN (SELECT participant_id FROM yingxiang_participants WHERE event_id=?1)").bind(eventId),
    db.prepare("DELETE FROM yingxiang_progress WHERE participant_id IN (SELECT participant_id FROM yingxiang_participants WHERE event_id=?1)").bind(eventId),
    db.prepare("DELETE FROM yingxiang_participant_access WHERE participant_id IN (SELECT participant_id FROM yingxiang_participants WHERE event_id=?1)").bind(eventId),
    db.prepare("DELETE FROM yingxiang_participants WHERE event_id=?1").bind(eventId),
    db.prepare("DELETE FROM yingxiang_calibration_groups WHERE event_id=?1").bind(eventId),
    db.prepare("DELETE FROM yingxiang_invites WHERE event_id=?1").bind(eventId),
    db.prepare("DELETE FROM yingxiang_events WHERE event_id=?1 AND owner_user_id=?2").bind(eventId,userId)
  ]);
  return json({ok:true,eventId,deleted:true});
}

export async function handleYingxiangManagementRoute(request: Request, url: URL, db: D1Database, user: YingxiangAuthenticatedUser): Promise<Response | undefined> {
  if (url.pathname === "/api/v1/yingxiang/events" && request.method === "GET") {
    const rows = await db.prepare("SELECT * FROM yingxiang_events WHERE owner_user_id = ?1 ORDER BY updated_at DESC, event_id LIMIT 200").bind(user.userId).all<NonNullable<Awaited<ReturnType<typeof eventById>>>>();
    return json({ok:true,events:rows.results.map(e => { const c = eventContracts(e); return c ? publicEvent(e,c.policy,c.manifest,true) : null; }).filter(Boolean)});
  }
  const match = url.pathname.match(/^\/api\/v1\/yingxiang\/events\/([^/]+)\/(dashboard|republish|cancel|delete|participants\/([^/]+)\/release|invites\/([^/]+)\/revoke)$/);
  if (!match) return undefined;
  const eventId = decodeURIComponent(match[1]); const event = await eventById(db,eventId);
  if (!event || event.owner_user_id !== user.userId) return json({ok:false,error:"YINGXIANG_EVENT_NOT_FOUND"},404);
  const c = eventContracts(event); if (!c) return json({ok:false,error:"YINGXIANG_EVENT_CONTRACT_CORRUPT"},500);
  if (match[2] === "dashboard" && request.method === "GET") {
    const participants = await db.prepare(`SELECT p.participant_id AS participantId,p.display_name AS displayName,p.status,p.joined_at AS joinedAt,p.released_at AS releasedAt,
      g.completed_samples AS completedSamples,g.total_samples AS totalSamples,g.updated_at AS progressAt,
      s.revision AS submissionRevision,s.received_at AS receivedAt FROM yingxiang_participants p
      LEFT JOIN yingxiang_progress g ON g.participant_id = p.participant_id
      LEFT JOIN yingxiang_submissions s ON s.participant_id = p.participant_id AND s.revision = (SELECT MAX(s2.revision) FROM yingxiang_submissions s2 WHERE s2.participant_id = p.participant_id)
      WHERE p.event_id = ?1 ORDER BY p.joined_at,p.participant_id`).bind(eventId).all();
    const invites = await db.prepare("SELECT invite_id AS inviteId, assigned_name AS assignedName, expires_at AS expiresAt, max_uses AS maxUses, use_count AS useCount, revoked_at AS revokedAt, event_revision AS eventRevision FROM yingxiang_invites WHERE event_id = ?1 ORDER BY created_at DESC LIMIT 200").bind(eventId).all();
    const rows = await db.prepare(`SELECT s.participant_id,p.display_name,s.bundle_json FROM yingxiang_submissions s JOIN yingxiang_participants p ON p.participant_id = s.participant_id
      WHERE p.event_id = ?1 AND s.revision = (SELECT MAX(s2.revision) FROM yingxiang_submissions s2 WHERE s2.participant_id = p.participant_id)`)
      .bind(eventId).all<{participant_id:string;display_name:string;bundle_json:string}>();
    const groups = await groupsFor(db,eventId);
    const collected: CollectedResult[] = rows.results.map(r => ({participantId:r.participant_id,displayName:r.display_name,bundle:JSON.parse(r.bundle_json)}));
    return json({ok:true,event:publicEvent(event,c.policy,c.manifest,true),participants:participants.results,invites:invites.results,groups,results:aggregateYingxiangResults(collected,c.manifest.samples,groups),submissions:collected});
  }
  if (request.method !== "POST") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  const now = new Date().toISOString();
  if (match[2] === "cancel") return cancelEvent(db,eventId,user.userId,event.status);
  if (match[2] === "delete") return deleteEvent(db,eventId,user.userId,event.status);
  if (match[3]) {
    await db.prepare("UPDATE yingxiang_participants SET status = 'released',released_at = COALESCE(released_at,?1) WHERE event_id = ?2 AND participant_id = ?3").bind(now,eventId,decodeURIComponent(match[3])).run();
    return json({ok:true,status:"released"});
  }
  if (match[4]) {
    await db.prepare("UPDATE yingxiang_invites SET revoked_at = COALESCE(revoked_at,?1) WHERE event_id = ?2 AND invite_id = ?3").bind(now,eventId,decodeURIComponent(match[4])).run();
    return json({ok:true});
  }
  if (!["draft","published","active"].includes(event.status)) return json({ok:false,error:"YINGXIANG_EVENT_NOT_SHAREABLE"},409);
  const body = await parseJsonObject(request); const title = normalizeName(body?.title); const policy = parsePolicy(body?.policy); const manifest = parseManifest(body?.manifest);
  if (!title || Array.from(title).length > 120 || !policy || !manifest || body?.expectedRevision !== event.event_revision) return json({ok:false,error:"YINGXIANG_EVENT_REVISION_CONFLICT"},409);
  const groups = await groupsFor(db,eventId); const allowed = new Set(manifest.samples.map(s => s.eventSampleId));
  if (groups.some(g => g.eventSampleIds.some(id => !allowed.has(id)))) return json({ok:false,error:"YINGXIANG_CALIBRATION_INVALID"},400);
  try {
    const result = await db.prepare(`UPDATE yingxiang_events SET title=?1,policy_json=?2,manifest_json=?3,event_revision=event_revision+1,status='published',updated_at=?4
      WHERE event_id=?5 AND event_revision=?6 AND status IN ('draft','published','active')`)
      .bind(title,JSON.stringify(policy),JSON.stringify(manifest),now,eventId,body.expectedRevision).run();
    if (!result.meta.changes) return json({ok:false,error:"YINGXIANG_EVENT_REVISION_CONFLICT"},409);
  } catch (e) { return json({ok:false,error:e instanceof Error ? e.message.match(/YINGXIANG_[A-Z_]+/)?.[0] ?? "YINGXIANG_EVENT_UPDATE_FAILED" : "YINGXIANG_EVENT_UPDATE_FAILED"},409); }
  await db.prepare("UPDATE yingxiang_invites SET revoked_at = COALESCE(revoked_at,?1) WHERE event_id=?2 AND event_revision < (SELECT event_revision FROM yingxiang_events WHERE event_id=?2)").bind(now,eventId).run();
  const updated = (await eventById(db,eventId))!;
  return json({ok:true,event:publicEvent(updated,policy,manifest,true)});
}
