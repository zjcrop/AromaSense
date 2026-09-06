import { YingxiangClient, YingxiangClientError } from "./yingxiang-client";
import { LocalCuppingRepository, type SQLiteDriver } from "../storage/local-cupping-repository";
import { SessionRecordService } from "./session-record-service";
import { SubmissionBundleStore } from "../storage/submission-bundle-store";
import { YingxiangEventStore } from "../storage/yingxiang-event-store";

export interface DeliveryRow { session_id: string; participant_id: string; access_token: string; progress_sequence: number; ack_revision: number | null; ack_hash: string | null; last_error: string | null; updated_at: string; }
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

  private async syncAll(): Promise<void> {
    const rows = await this.list();
    const repository = new LocalCuppingRepository(this.db);
    for (const row of rows) {
      try {
        const session = await repository.getSession(row.session_id);
        const status = await this.client.participantStatus(row.participant_id,row.access_token);
        const events = new YingxiangEventStore(this.db);
        if (status.participant.status === "released") await events.releasePrincipal(status.event.eventId,row.participant_id,status.participant.releasedAt ?? this.now());
        if (session.status === "completed" || session.status === "archived") {
          const bundle = await this.submissions.create(await new SessionRecordService(repository,this.now).snapshot(row.session_id));
          if (row.ack_revision === bundle.revision && row.ack_hash === bundle.contentHash) continue;
          const ack = await this.client.submit(row.participant_id,row.access_token,bundle);
          await this.db.run("UPDATE yingxiang_delivery SET ack_revision=?,ack_hash=?,last_error=NULL,updated_at=? WHERE session_id=?",[ack.revision,ack.contentHash,this.now(),row.session_id]);
        } else if (status.participant.status === "active") {
          // Progress reads only confirmed sample ids, never all sensory observations into the editor.
          const count = await this.db.get<{ completed: number; total: number }>(`SELECT
            (SELECT COUNT(DISTINCT sample_id) FROM observations WHERE session_id=? AND stage_id='scoring' AND field_key='score_confirmed' AND value_json='true') AS completed,
            (SELECT COUNT(*) FROM samples WHERE session_id=?) AS total`,[row.session_id,row.session_id]);
          if (!count?.total) continue;
          const sequence = row.progress_sequence+1;
          await this.db.run("UPDATE yingxiang_delivery SET progress_sequence=? WHERE session_id=?",[sequence,row.session_id]);
          await this.client.sendProgress(row.participant_id,row.access_token,{sessionId:row.session_id,sequence,completedSamples:count.completed,totalSamples:count.total});
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
