import type { SampleRecord } from "../core/sample-batch-service";
import {
  LocalCuppingRepository as BaseLocalCuppingRepository,
  type SQLiteDriver
} from "./local-cupping-repository-base";

export type {
  SqlValue,
  SQLiteDriver,
  EditingSlice,
  PersistedStageState
} from "./local-cupping-repository-base";

/**
 * Extends the stable repository with the two roster mutations required by free
 * cupping. Existing persistence behavior remains in the untouched base class.
 */
export class LocalCuppingRepository extends BaseLocalCuppingRepository {
  constructor(private readonly rosterDb: SQLiteDriver) {
    super(rosterDb);
  }

  async addSample(sample: SampleRecord): Promise<readonly SampleRecord[]> {
    if (!sample.sampleId.trim()) throw new Error("SAMPLE_ID_REQUIRED");
    await this.rosterDb.run(
      `INSERT INTO samples (sample_id, session_id, display_number, sort_order, label, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sample.sampleId, sample.sessionId, sample.displayNumber, sample.sortOrder,
        sample.label ?? null, JSON.stringify(sample.metadata), sample.createdAt, sample.updatedAt]
    );
    return this.listSamples(sample.sessionId);
  }

  async deleteSample(sessionId: string, sampleId: string, now: string): Promise<readonly SampleRecord[]> {
    return this.rosterDb.transaction(async () => {
      const existing = await this.rosterDb.get<{ sample_id: string }>(
        `SELECT sample_id FROM samples WHERE session_id = ? AND sample_id = ?`,
        [sessionId, sampleId]
      );
      if (!existing) throw new Error(`SAMPLE_NOT_FOUND:${sampleId}`);

      const count = await this.rosterDb.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM samples WHERE session_id = ?`,
        [sessionId]
      );
      if (Number(count?.count ?? 0) <= 1) throw new Error("AT_LEAST_ONE_SAMPLE_REQUIRED");

      // stage_state / observations use ON DELETE CASCADE from samples.
      await this.rosterDb.run(`DELETE FROM samples WHERE session_id = ? AND sample_id = ?`, [sessionId, sampleId]);
      const remaining = await this.rosterDb.all<{ sample_id: string }>(
        `SELECT sample_id FROM samples WHERE session_id = ? ORDER BY sort_order ASC`,
        [sessionId]
      );

      // Two-phase renumber avoids transient UNIQUE(session_id, display_number/sort_order) collisions.
      await this.rosterDb.run(
        `UPDATE samples SET display_number = -display_number, sort_order = -sort_order WHERE session_id = ?`,
        [sessionId]
      );
      for (let index = 0; index < remaining.length; index += 1) {
        await this.rosterDb.run(
          `UPDATE samples SET display_number = ?, sort_order = ?, updated_at = ? WHERE session_id = ? AND sample_id = ?`,
          [index + 1, index + 1, now, sessionId, remaining[index]!.sample_id]
        );
      }
      return this.listSamples(sessionId);
    });
  }
}
