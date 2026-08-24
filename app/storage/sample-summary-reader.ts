import type { StageId } from "../../shared/protocol/aromasense-v1";
import type { SQLiteDriver } from "./local-cupping-repository";

export interface SummaryObservation {
  stageId: StageId;
  fieldKey: string;
  value: unknown;
}

interface SummaryRow {
  stage_id: StageId;
  field_key: string;
  value_json: string;
}

export class SampleSummaryReader {
  constructor(private readonly db: SQLiteDriver) {}

  async listObservations(sampleId: string): Promise<readonly SummaryObservation[]> {
    const rows = await this.db.all<SummaryRow>(
      `SELECT stage_id, field_key, value_json
       FROM observations
       WHERE sample_id = ?
       ORDER BY stage_id, field_key`,
      [sampleId]
    );
    return rows.map((row) => ({
      stageId: row.stage_id,
      fieldKey: row.field_key,
      value: JSON.parse(row.value_json) as unknown
    }));
  }
}
