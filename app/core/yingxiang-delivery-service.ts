import { revealBlindSessionMetadata } from "./blind-session";
import { YingxiangClient, YingxiangClientError, type YingxiangParticipantStatus, type YingxiangRemoteEvent } from "./yingxiang-client";
import type { YingxiangEventSampleSlot } from "./yingxiang-event";
import { LocalCuppingRepository, type SQLiteDriver } from "../storage/local-cupping-repository";
import { SessionRecordService } from "./session-record-service";
import { SubmissionBundleStore } from "../storage/submission-bundle-store";
import { YingxiangEventStore, type YingxiangEventContext } from "../storage/yingxiang-event-store";
import { YingxiangParticipantEventRefresher } from "../storage/yingxiang-participant-event-refresh";

export interface DeliveryRow { session_id: string; participant_id: string; access_token: string; progress_sequence: number; ack_revision: number | null; ack_hash: string | null; last_error: string | null; updated_at: string; }

type FinalAck = { revision: number; contentHash: string };

const COFFEE_METADATA_FIELDS = [
  "productName", "country", "region", "farm", "station", "variety", "roast", "process", "roaster", "altitude", "roastDate", "notes"
] as const;

function eventContext(event: YingxiangRemoteEvent): YingxiangEventContext {
  return {
    eventId: event.eventId,
    eventRevision: event.eventRevision,
    title: event.title,
    status: event.status,
    policy: event.policy,
    manifest: event.manifest,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  };
}

function revealedLabel(sample: YingxiangEventSampleSlot): string {
  return sample.label?.trim() || sample.coffee?.productName?.trim() || sample.sampleCode;
}

function revealedMetadata(local: Record<string, unknown>, sample: YingxiangEventSampleSlot, eventRevision: number): Record<string, unknown> {
  const result: Record<string, unknown> = { ...local };
  for (const key of COFFEE_METADATA_FIELDS) delete result[key];
  result.eventSampleId = sample.eventSampleId;
  result.sampleCode = sample.sampleCode;
  result.eventRevision = eventRevision;
  if (sample.coffee) {
    for (const key of COFFEE_METADATA_FIELDS) {
      const value = sample.coffee[key]?.trim();
      if (value) result[key] = value;
    }
  }
  return result;
}

export class YingxiangDeliveryService {
  private running?: Promise<void>;
  private readonly submissions: SubmissionBundleStore;
  constructor(private readonly db: SQLiteDriver, private readonly client: Pick<YingxiangClient,"participantStatus"|"sendProgress"|"submit"|"leave">, private readonly now: () => string) { this.submissions = new SubmissionBundleStore(db); }

  async list(): Promise<readonly DeliveryRow[]> { return this.db.all<DeliveryRow>("SELECT * FROM yingxiang_delivery ORDER BY updated_at DESC"); }

  sync(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.syncAll().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async reconcileFinalAck(row: DeliveryRow, status: YingxiangParticipantStatus): Promise<FinalAck | undefined> {
    if (status.ack) {
      const local = await this.db.get<{ content_hash: string }>(
        "SELECT content_hash FROM submission_revisions WHERE session_id=? AND revision=?",
        [row.session_id, status.ack.revision]
      );
      if (!local || local.content_hash !== status.ack.contentHash) throw new Error("YINGXIANG_ACK_LOCAL_MISMATCH");
      if (row.ack_revision !== status.ack.revision || row.ack_hash !== status.ack.contentHash) {
        await this.db.run(
          "UPDATE yingxiang_delivery SET ack_revision=?,ack_hash=?,last_error=NULL,updated_at=? WHERE session_id=?",
          [status.ack.revision,status.ack.contentHash,this.now(),row.session_id]
        );
      }
      return { revision: status.ack.revision, contentHash: status.ack.contentHash };
    }
    if (row.ack_revision !== null && row.ack_hash) return { revision: row.ack_revision, contentHash: row.ack_hash };
    if (row.ack_revision !== null || row.ack_hash !== null) throw new Error("YINGXIANG_ACK_LOCAL_MISMATCH");
    return undefined;
  }

  private async syncRemoteLifecycle(
    repository: LocalCuppingRepository,
    row: DeliveryRow,
    status: YingxiangParticipantStatus
  ): Promise<void> {
    const cachedAt = this.now();
    const events = new YingxiangEventStore(this.db);
    const participantEvents = new YingxiangParticipantEventRefresher(this.db);
    await this.db.transaction(async () => {
      await participantEvents.refresh(eventContext(status.event), cachedAt);
      if (status.event.status === "completed"
        && status.event.policy.revealSampleIdentity === "on_event_complete"
        && status.event.manifest.cuppingMode !== "open") {
        const localSamples = await repository.listSamples(row.session_id);
        const remoteById = new Map(status.event.manifest.samples.map((sample) => [sample.eventSampleId, sample] as const));
        if (remoteById.size !== status.event.manifest.samples.length || localSamples.length !== status.event.manifest.samples.length) {
          throw new Error("YINGXIANG_REVEAL_SAMPLE_SET_MISMATCH");
        }
        const localIds = new Set<string>();
        const plans = localSamples.map((local) => {
          const eventSampleId = String(local.metadata.eventSampleId ?? "").trim();
          if (!eventSampleId || localIds.has(eventSampleId)) throw new Error("YINGXIANG_REVEAL_LOCAL_BINDING_INVALID");
          localIds.add(eventSampleId);
          const remote = remoteById.get(eventSampleId);
          if (!remote) throw new Error("YINGXIANG_REVEAL_SAMPLE_SET_MISMATCH");
          return {
            sampleId: local.sampleId,
            label: revealedLabel(remote),
            metadata: revealedMetadata(local.metadata, remote, status.event.eventRevision)
          };
        });
        if (localIds.size !== remoteById.size) throw new Error("YINGXIANG_REVEAL_SAMPLE_SET_MISMATCH");
        for (const plan of plans) {
          await repository.saveSampleIdentity(row.session_id, plan.sampleId, plan.label, plan.metadata, cachedAt);
        }
        const session = await repository.getSession(row.session_id);
        const metadata = revealBlindSessionMetadata(session.metadata, cachedAt);
        await repository.saveSession({ ...session, metadata, updatedAt: cachedAt });
      }
      if (status.participant.status === "released") {
        await events.releasePrincipal(status.event.eventId,row.participant_id,status.participant.releasedAt ?? cachedAt);
      }
    });
  }

  private async syncAll(): Promise<void> {
    const rows = await this.list();
    const repository = new LocalCuppingRepository(this.db);
    for (const row of rows) {
      try {
        const session = await repository.getSession(row.session_id);
        const status = await this.client.participantStatus(row.participant_id,row.access_token);
        const finalAck = await this.reconcileFinalAck(row, status);
        await this.syncRemoteLifecycle(repository, row, status);
        const remoteClosed = status.participant.status === "released" || status.event.status === "completed" || status.event.status === "cancelled";
        if (session.status === "completed" || session.status === "archived") {
          if (remoteClosed) {
            if (finalAck) {
              await this.db.run("UPDATE yingxiang_delivery SET last_error=NULL,updated_at=? WHERE session_id=?",[this.now(),row.session_id]);
            } else {
              await this.db.run("UPDATE yingxiang_delivery SET last_error=?,updated_at=? WHERE session_id=?",["YINGXIANG_EVENT_CLOSED_BEFORE_SUBMISSION",this.now(),row.session_id]);
            }
            continue;
          }
          const bundle = await this.submissions.create(await new SessionRecordService(repository,this.now).snapshot(row.session_id));
          if (finalAck?.revision === bundle.revision && finalAck.contentHash === bundle.contentHash) continue;
          const ack = await this.client.submit(row.participant_id,row.access_token,bundle);
          await this.db.run("UPDATE yingxiang_delivery SET ack_revision=?,ack_hash=?,last_error=NULL,updated_at=? WHERE session_id=?",[ack.revision,ack.contentHash,this.now(),row.session_id]);
        } else if (status.participant.status === "active" && (status.event.status === "published" || status.event.status === "active")) {
          // Progress reads only confirmed sample ids, never all sensory observations into the editor.
          const count = await this.db.get<{ completed: number; total: number }>(`SELECT
            (SELECT COUNT(DISTINCT sample_id) FROM observations WHERE session_id=? AND stage_id='scoring' AND field_key='score_confirmed' AND value_json='true') AS completed,
            (SELECT COUNT(*) FROM samples WHERE session_id=?) AS total`,[row.session_id,row.session_id]);
          if (!count?.total) continue;
          const sequence = row.progress_sequence+1;
          await this.db.run("UPDATE yingxiang_delivery SET progress_sequence=? WHERE session_id=?",[sequence,row.session_id]);
          await this.client.sendProgress(row.participant_id,row.access_token,{sessionId:row.session_id,sequence,completedSamples:count.completed,totalSamples:count.total});
          await this.db.run("UPDATE yingxiang_delivery SET last_error=NULL,updated_at=? WHERE session_id=?",[this.now(),row.session_id]);
        } else {
          await this.db.run("UPDATE yingxiang_delivery SET last_error=NULL,updated_at=? WHERE session_id=?",[this.now(),row.session_id]);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "迎香提交失败";
        await this.db.run("UPDATE yingxiang_delivery SET last_error=?,updated_at=? WHERE session_id=?",[message,this.now(),row.session_id]);
        if (e instanceof YingxiangClientError && e.code === "NETWORK_ERROR") break;
      }
    }
  }

  async leave(row: DeliveryRow): Promise<void> {
    await this.client.leave(row.participant_id,row.access_token);
    const binding = await this.db.get<{event_id:string}>("SELECT event_id FROM yingxiang_session_bindings WHERE session_id=?",[row.session_id]);
    if (binding) await new YingxiangEventStore(this.db).releasePrincipal(binding.event_id,row.participant_id,this.now());
  }
}
