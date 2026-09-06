import type { SensoryObservation, StageId } from "../../shared/protocol/aromasense-v1";
import type { SQLiteDriver } from "./local-cupping-repository";

/** Lightweight projection accepted by summary-only models and tests. */
export interface SummaryObservation {
  stageId: StageId;
  fieldKey: string;
  value: unknown;
}

interface SummaryRow {
  observation_id: string;
  session_id: string;
  sample_id: string;
  stage_id: StageId;
  field_key: string;
  value_json: string;
  dictionary_version: string;
  updated_at: string;
}

export class SampleSummaryReader {
  constructor(private readonly db: SQLiteDriver) {}

  /**
   * Reads the canonical persisted observation shape. A SensoryObservation is
   * structurally compatible with SummaryObservation, while retaining the real
   * identifiers/version/timestamp needed by richer conclusion renderers.
   */
  async listObservations(sampleId: string): Promise<readonly SensoryObservation[]> {
    const rows = await this.db.all<SummaryRow>(
      `SELECT observation_id, session_id, sample_id, stage_id, field_key, value_json, dictionary_version, updated_at
       FROM observations
       WHERE sample_id = ?
       ORDER BY stage_id, field_key`,
      [sampleId]
    );
    return rows.map((row) => ({
      observationId: row.observation_id,
      sessionId: row.session_id,
      sampleId: row.sample_id,
      stageId: row.stage_id,
      fieldKey: row.field_key,
      value: JSON.parse(row.value_json) as unknown,
      dictionaryVersion: row.dictionary_version,
      updatedAt: row.updated_at
    }));
  }
}
