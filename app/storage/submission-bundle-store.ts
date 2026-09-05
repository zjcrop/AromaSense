import type { CuppingRecordSnapshot } from "../core/session-record-service";
import { buildSubmissionBundle, type SubmissionBundle } from "../core/submission-bundle";
import type { SQLiteDriver } from "./local-cupping-repository";

interface RevisionRow { revision: number; content_hash: string; }

export class SubmissionBundleStore {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly db: SQLiteDriver) {}

  create(snapshot: CuppingRecordSnapshot): Promise<SubmissionBundle> {
    const task = this.tail.then(async () => {
      const bundle = await buildSubmissionBundle(snapshot);
      return this.db.transaction(async () => {
        const latest = await this.db.get<RevisionRow>(
          "SELECT revision, content_hash FROM submission_revisions WHERE session_id = ? ORDER BY revision DESC LIMIT 1",
          [snapshot.session.sessionId]
        );
        if (latest?.content_hash === bundle.contentHash) return { ...bundle, revision: latest.revision };
        const revision = (latest?.revision ?? 0) + 1;
        await this.db.run(
          "INSERT INTO submission_revisions (session_id, revision, content_hash, created_at) VALUES (?, ?, ?, ?)",
          [snapshot.session.sessionId, revision, bundle.contentHash, snapshot.exportedAt]
        );
        return { ...bundle, revision };
      });
    });
    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }
}
